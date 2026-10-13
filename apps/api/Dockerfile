# ============================================
# Nilo API - Production Dockerfile
# ============================================
# Multi-stage build on one pinned Bun image: installs, the bundle and the
# runtime all use oven/bun:1.4.3-slim (Debian/glibc), so the runtime is the
# exact Bun and libc the dependency tree was installed against.
#
# The API ran on Node until 2026-10. Bun serves the same esbuild bundle (ESM,
# platform=node) unchanged; measured on the built dist against a local
# Postgres 17: both migrator phases apply, /health/ready answers 200, the
# socket.io WebSocket upgrade reaches the auth middleware, the 65 s keep-alive
# (kept above the ALB's 60 s idle timeout) closes an idle socket at 66 s exactly
# as on Node, and SIGTERM runs the graceful shutdown to exit 0. Idle RSS was
# 129 MB under Bun against 278 MB under Node.
#
# Rolling back to Node is reverting the PR that made this change: it restores
# the node:22-bookworm-slim runtime stage AND the `node` migrator command in
# .github/scripts/deploy-ecs.sh, which must always name the runtime this image
# ships.
#
# Every stage pins the base image by digest: the tag is for readers and for
# scripts/check-bun-pin.ts, the digest (the multi-arch index, which lists
# linux/arm64) is what the build pulls, so a re-pushed tag cannot change the
# image. A bump needs a new digest and an owner re-review of the reviewed pin
# (.github/scripts/reviewed-images.json).

# --- Stage 1: Builder ---
FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS builder

WORKDIR /build

# Copy root workspace files
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/

# Install all dependencies (including devDependencies for build). Lifecycle
# scripts are skipped here too: the only ones are the optional WebSocket
# accelerators' node-gyp builds (bufferutil, utf-8-validate), which have
# JavaScript fallbacks, need a toolchain, and fail when node-gyp@latest does.
RUN bun install --frozen-lockfile --ignore-scripts

# Copy API source
COPY apps/api/ ./apps/api/

# Build the API
RUN bun run --filter @nilo/api build

# --- Stage 2: Production dependencies ---
FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS production-deps

WORKDIR /app

# Copy root workspace files
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/

# Optional native accelerators have JavaScript fallbacks and are not part of
# Nilo's runtime contract. Skipping lifecycle scripts keeps the production
# dependency layer deterministic across clean ARM64 builders.
# Some tarballs ship world-writable files (pino/bin.js, tldts/bin/cli.js are
# 0777), which would let the app user rewrite them even when root owns them in
# the runtime stage, so group and other write bits are cleared here.
RUN bun install --frozen-lockfile --production --ignore-scripts && \
    chmod -R go-w node_modules

# --- Stage 3: Production runtime ---
FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS runtime

# ca-certificates only: the API's outbound TLS (Oxy, S3, push services) needs
# the CA bundle (#23). No curl or other network tool: the HEALTHCHECK below
# probes with the runtime itself.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The code is root-owned and read-only to the app user, so a compromised
# process cannot rewrite its own bundle or dependencies. The one directory the
# API writes is `uploads/` under its working directory (the local-disk upload
# fallback in src/routes/uploads.ts, used only when no S3 bucket is set), so
# that directory alone belongs to `bun`, the image's own unprivileged user
# (uid/gid 1000). CI's image smoke (.github/scripts/smoke-api-image.sh) asserts
# both, and boots the image as ECS runs it.
RUN install -d -o bun -g bun -m 0755 /app/uploads

COPY --from=production-deps /app/node_modules ./node_modules
COPY package.json ./
COPY apps/api/package.json ./apps/api/

# Copy built output from builder
COPY --from=builder /build/apps/api/dist ./apps/api/dist

# Security hardening: Run as non-root user
USER bun

ENV NODE_ENV=production
EXPOSE 4001

# For `docker run` and Compose. ECS ignores an image HEALTHCHECK (the task
# definition declares none for this container; the ALB probes /health/ready).
# Bun's own fetch, so the image needs no curl; it gives up after 4 s, inside
# Docker's 5 s timeout. The smoke runs this exact command against the booted
# API and against nothing.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4001)+'/health/live',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# The image's entrypoint execs this command, so Bun is PID 1 and receives
# SIGTERM itself; src/index.ts registers the graceful-shutdown handler. Every
# one-shot that overrides this command (the migrator in deploy-ecs.sh) names
# `bun` too. The base image puts a `node` on PATH, but it is a symlink to bun
# (/usr/local/bun-node-fallback-bin/node): there is no Node in this image, so
# `node <file>` would run Bun while claiming otherwise.
CMD ["bun", "apps/api/dist/index.js"]
