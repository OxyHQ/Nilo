import type { Response } from 'express';

/**
 * The headers of a file a browser saves, named for every OS and, exactly, for
 * RFC 5987 readers. The ASCII name is `ascii` (the title by default) with
 * everything else dashed, or `fallback` when nothing is left.
 */
export function attachment(
  res: Response,
  title: string,
  extension: string,
  type: string,
  {
    ascii = title.normalize('NFKD'),
    fallback = 'page',
  }: { ascii?: string; fallback?: string } = {},
): void {
  const name = ascii.replace(/[^a-zA-Z0-9-_]+/gu, '-').replace(/^-+|-+$/g, '') || fallback;
  res.setHeader('Content-Type', type);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${name}.${extension}"; filename*=UTF-8''${encodeURIComponent(`${title}.${extension}`)}`,
  );
}
