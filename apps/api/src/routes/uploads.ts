import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticateToken } from '../middleware/auth.js';
import { log } from '../lib/logger.js';

/**
 * Two sub-routers — authenticated presign endpoint plus an UNauthenticated
 * local-upload endpoint that proves identity via a single-use token embedded
 * in the URL. Splitting prevents the auth middleware from rejecting browser
 * PUTs (which carry no Authorization header).
 */
const router = Router();
const authedRouter = Router();
authedRouter.use(authenticateToken);

/**
 * Maximum upload size (in bytes): 25 MB unless `UPLOAD_MAX_BYTES` says
 * otherwise, the figure `.env.example` documents. Spaces / S3 allow far more;
 * this caps runaway uploads.
 */
const MAX_UPLOAD_BYTES = parseInt(process.env.UPLOAD_MAX_BYTES || `${25 * 1024 * 1024}`, 10);

/**
 * Uploads are public objects on the storage domain, so what a browser does
 * with them matters: a file served as `text/html` or `image/svg+xml` runs its
 * scripts there. Only these types keep their own; everything else is stored
 * as `application/octet-stream`. Media and PDFs display inline; any other
 * file downloads (`Content-Disposition: attachment`).
 */
const INLINE_TYPES =
  /^(image\/(png|jpeg|gif|webp|avif|heic|heif|bmp)|video\/(mp4|webm|quicktime|ogg)|audio\/(mpeg|mp4|ogg|wav|webm|aac|flac|x-m4a)|application\/pdf)$/;
const DOWNLOAD_TYPES =
  /^(text\/(plain|csv|markdown)|application\/(zip|json|msword|vnd\.openxmlformats-officedocument\.[\w.-]+|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.oasis\.opendocument\.[\w.-]+|octet-stream))$/;

export function storedType(mimeType: string): { contentType: string; inline: boolean } {
  const type = mimeType.trim().toLowerCase().split(';')[0] ?? '';
  if (INLINE_TYPES.test(type)) return { contentType: type, inline: true };
  if (DOWNLOAD_TYPES.test(type)) return { contentType: type, inline: false };
  return { contentType: 'application/octet-stream', inline: false };
}

/**
 * Single source of truth for Spaces / S3 configuration. Accepts both the
 * documented `SPACES_*` names and the existing `AWS_*` names already in use
 * by `lib/s3.ts`, so either set of env vars works.
 */
interface SpacesConfig {
  region: string;
  bucket: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
}

function getSpacesConfig(): SpacesConfig | null {
  const accessKeyId = process.env.SPACES_KEY || process.env.AWS_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.SPACES_SECRET || process.env.AWS_SECRET_ACCESS_KEY || '';
  const bucket = process.env.SPACES_BUCKET || process.env.AWS_S3_BUCKET || '';
  const region = process.env.SPACES_REGION || process.env.AWS_REGION || 'us-east-1';
  const endpoint =
    process.env.SPACES_ENDPOINT ||
    process.env.AWS_ENDPOINT_URL ||
    (process.env.SPACES_REGION
      ? `https://${process.env.SPACES_REGION}.digitaloceanspaces.com`
      : undefined);

  if (!accessKeyId || !secretAccessKey || !bucket) return null;

  let publicBaseUrl: string;
  if (process.env.SPACES_CDN_URL || process.env.AWS_CDN_URL) {
    publicBaseUrl = (process.env.SPACES_CDN_URL || process.env.AWS_CDN_URL || '').replace(
      /\/$/,
      '',
    );
  } else if (endpoint) {
    const host = new URL(endpoint).host;
    publicBaseUrl = `https://${bucket}.${host}`;
  } else {
    publicBaseUrl = `https://${bucket}.s3.${region}.amazonaws.com`;
  }

  return {
    region,
    bucket,
    endpoint,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
  };
}

let cachedClient: { config: SpacesConfig; client: S3Client } | null = null;
function getSpacesClient(config: SpacesConfig): S3Client {
  if (cachedClient && cachedClient.config === config) return cachedClient.client;
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: false,
  });
  cachedClient = { config, client };
  return client;
}

const SAFE_FILENAME = /[^a-zA-Z0-9._-]/g;
function sanitizeFilename(name: string): string {
  const trimmed = name.trim().slice(-200);
  const cleaned = trimmed.replace(SAFE_FILENAME, '_');
  return cleaned || 'file';
}

function buildObjectKey(filename: string): string {
  const env = process.env.NODE_ENV || 'development';
  const safe = sanitizeFilename(filename);
  const ext = safe.includes('.') ? safe.split('.').pop() : '';
  const base = ext ? safe.slice(0, safe.length - ext.length - 1) : safe;
  const id = crypto.randomUUID();
  return ext ? `${env}/uploads/${base}-${id}.${ext}` : `${env}/uploads/${base}-${id}`;
}

const presignSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES),
});

/**
 * Local-disk fallback used when no Spaces creds are configured. Files are
 * written under `<api>/uploads/` and served at `/uploads/...` (configured
 * in index.ts as static middleware).
 */
const LOCAL_UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const LOCAL_TOKEN_TTL_MS = 60 * 60 * 1000;
interface LocalUploadToken {
  key: string;
  mimeType: string;
  size: number;
  expiresAt: number;
}
const localTokens = new Map<string, LocalUploadToken>();

function pruneLocalTokens() {
  const now = Date.now();
  for (const [token, entry] of localTokens) {
    if (entry.expiresAt < now) localTokens.delete(token);
  }
}

function localPublicBaseUrl(req: Request): string {
  const explicit = process.env.PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const host = req.headers.host || `localhost:${process.env.PORT || '4001'}`;
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
  return `${proto}://${host}`;
}

/**
 * POST /uploads/presign
 * Returns either a presigned Spaces PUT URL or a local-disk upload token.
 *
 * Response:
 *   { uploadUrl, fileUrl, headers?, mode: 'spaces' | 'local' }
 *
 * Clients PUT the file bytes to `uploadUrl` with the returned `headers`, then
 * persist `fileUrl` as the block's `content.url`.
 */
authedRouter.post('/presign', async (req: Request, res: Response) => {
  try {
    const body = presignSchema.parse(req.body);
    const config = getSpacesConfig();
    const key = buildObjectKey(body.filename);
    const stored = storedType(body.mimeType);
    const disposition = stored.inline
      ? undefined
      : `attachment; filename="${sanitizeFilename(body.filename)}"`;

    if (config) {
      const client = getSpacesClient(config);
      // The type and disposition are signed: the upload cannot change them.
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: stored.contentType,
        ...(disposition && { ContentDisposition: disposition }),
        ContentLength: body.size,
        ACL: 'public-read',
      });
      const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 });
      res.json({
        mode: 'spaces',
        uploadUrl,
        fileUrl: `${config.publicBaseUrl}/${key}`,
        headers: {
          'Content-Type': stored.contentType,
          ...(disposition && { 'Content-Disposition': disposition }),
          'x-amz-acl': 'public-read',
        },
      });
      return;
    }

    // Local fallback — issue a one-time token usable against /uploads/local/:token.
    pruneLocalTokens();
    const token = crypto.randomBytes(24).toString('hex');
    localTokens.set(token, {
      key,
      mimeType: stored.contentType,
      size: body.size,
      expiresAt: Date.now() + LOCAL_TOKEN_TTL_MS,
    });
    const base = localPublicBaseUrl(req);
    res.json({
      mode: 'local',
      uploadUrl: `${base}/uploads/local/${token}`,
      fileUrl: `${base}/uploads/${key}`,
      headers: { 'Content-Type': stored.contentType },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    log.general.error({ err: error }, 'Failed to presign upload');
    res.status(500).json({ error: 'Failed to presign upload' });
  }
});

/**
 * PUT /uploads/local/:token
 * Local-only fallback for environments without DigitalOcean Spaces.
 * Accepts raw bytes (`application/octet-stream` or original mime type) and
 * writes them under `<api>/uploads/<key>`.
 */
router.put(
  '/local/:token',
  // raw body parser scoped to this route only
  (req, res, next) => {
    const chunks: Buffer[] = [];
    let length = 0;
    req.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > MAX_UPLOAD_BYTES) {
        res.status(413).json({ error: 'Upload too large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      // store as Buffer on req for the handler
      Object.defineProperty(req, 'rawBody', {
        value: Buffer.concat(chunks),
        configurable: true,
      });
      next();
    });
    req.on('error', (err) => next(err));
  },
  async (req: Request, res: Response) => {
    try {
      const token = req.params.token;
      if (typeof token !== 'string') {
        res.status(400).json({ error: 'Invalid token' });
        return;
      }
      pruneLocalTokens();
      const entry = localTokens.get(token);
      if (!entry) {
        res.status(404).json({ error: 'Upload token not found or expired' });
        return;
      }
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!rawBody) {
        res.status(400).json({ error: 'Missing body' });
        return;
      }
      if (rawBody.length > entry.size) {
        res.status(413).json({ error: 'Body larger than declared size' });
        return;
      }
      const targetPath = path.join(LOCAL_UPLOAD_ROOT, entry.key);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, rawBody);
      localTokens.delete(token);
      const base = localPublicBaseUrl(req);
      res.json({
        success: true,
        fileUrl: `${base}/uploads/${entry.key}`,
        bytes: rawBody.length,
      });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to write local upload');
      res.status(500).json({ error: 'Failed to write upload' });
    }
  },
);

// Mount the authed presign endpoint on the public router. The local-PUT
// endpoint stays mounted directly on `router` (no auth middleware) — its
// token-in-URL is the credential.
router.use('/', authedRouter);

export default router;
export { LOCAL_UPLOAD_ROOT };
