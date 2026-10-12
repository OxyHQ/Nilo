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

# --- Stage 1: Builder ---
FROM oven/bun:1.4.3-slim AS builder

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
FROM oven/bun:1.4.3-slim AS production-deps

WORKDIR /app

# Copy root workspace files
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/

# Optional native accelerators have JavaScript fallbacks and are not part of
# Nilo's runtime contract. Skipping lifecycle scripts keeps the production
# dependency layer deterministic across clean ARM64 builders.
RUN bun install --frozen-lockfile --production --ignore-scripts

# --- Stage 3: Production runtime ---
FROM oven/bun:1.4.3-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The non-root user owns /app (it writes temp files there) and everything
# copied into it. Each COPY sets the owner itself: a trailing `chown -R`
# rewrote every file into a second layer and shipped node_modules twice.
# `bun` is the image's own unprivileged user, uid/gid 1000 like Node's `node`.
RUN chown bun:bun /app

COPY --from=production-deps --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun package.json ./
COPY --chown=bun:bun apps/api/package.json ./apps/api/

# Copy built output from builder
COPY --from=builder --chown=bun:bun /build/apps/api/dist ./apps/api/dist

# Security hardening: Run as non-root user
USER bun

ENV NODE_ENV=production
EXPOSE 4001

# Health check for orchestrators (k8s, DO App Platform)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4001/health/live || exit 1

# The image's entrypoint execs this command, so Bun is PID 1 and receives
# SIGTERM itself; src/index.ts registers the graceful-shutdown handler. Every
# one-shot that overrides this command (the migrator in deploy-ecs.sh) names
# `bun` too. The base image puts a `node` on PATH, but it is a symlink to bun
# (/usr/local/bun-node-fallback-bin/node): there is no Node in this image, so
# `node <file>` would run Bun while claiming otherwise.
CMD ["bun", "apps/api/dist/index.js"]
