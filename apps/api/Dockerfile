# ============================================
# Nilo API - Production Dockerfile
# ============================================
# Multi-stage build: pinned Bun for installs, minimal Node for runtime.

# --- Stage 1: Builder ---
FROM oven/bun:1.4.2-slim AS builder

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
FROM oven/bun:1.4.2-slim AS production-deps

WORKDIR /app

# Copy root workspace files
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/

# Optional native accelerators have JavaScript fallbacks and are not part of
# Nilo's runtime contract. Skipping lifecycle scripts keeps the production
# dependency layer deterministic across clean ARM64 builders.
RUN bun install --frozen-lockfile --production --ignore-scripts

# --- Stage 3: Production runtime ---
FROM node:22-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The non-root user owns /app (it writes temp files there) and everything
# copied into it. Each COPY sets the owner itself: a trailing `chown -R`
# rewrote every file into a second layer and shipped node_modules twice.
RUN chown node:node /app

COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node apps/api/package.json ./apps/api/

# Copy built output from builder
COPY --from=builder --chown=node:node /build/apps/api/dist ./apps/api/dist

# Security hardening: Run as non-root user
USER node

ENV NODE_ENV=production
EXPOSE 4001

# Health check for orchestrators (k8s, DO App Platform)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4001/health/live || exit 1

CMD ["node", "apps/api/dist/index.js"]
