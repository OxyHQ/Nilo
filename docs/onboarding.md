# Nilo developer onboarding

Nilo is a Bun monorepo with an Expo client and an Express API.

```text
apps/app  -> HTTPS and Socket.IO -> apps/api -> PostgreSQL
```

Redis/Valkey is optional and supports Socket.IO scale-out. S3-compatible
storage is optional for uploads. Neither service replaces PostgreSQL.

## Boundaries

Nilo owns workspace data and collaboration. It does not execute providers,
store provider keys, expose chat completions, or maintain a model catalogue.
One-shot product operations use `Nilo -> Oxy -> Kaana`; conversations,
memory, tools and agents use `Nilo -> Alia -> Oxy -> Kaana`. Nilo never
calls Kaana directly, and provider credentials exist only in Kaana's encrypted
PostgreSQL database.

The inference-boundary tests deliberately include positive fixtures. If one of
the forbidden constructs is introduced, the detector must name it rather than
passing because it scanned nothing.

## Important paths

| Path | Purpose |
|---|---|
| `apps/api/src/index.ts` | API boot and route mounts |
| `apps/api/src/db/schema/` | current PostgreSQL schema |
| `apps/api/src/drizzle/` | immutable migration history |
| `apps/app/lib/api/` | authenticated API client and route constants |
| `apps/app/app/` | Expo Router screens |

## Setup

```bash
bun install
cp apps/api/.env.example apps/api/.env
cp apps/app/.env.example apps/app/.env
bun run dev:api
bun run dev:app
```

## Gates

```bash
bun run --filter @nilo/api lint
bun run --filter @nilo/api test
NILO_TEST_DATABASE_URL=postgres://nilo:nilo@127.0.0.1:5439/postgres \
  bun run --filter @nilo/api test:pgdb
bun run build:api
EXPO_PUBLIC_API_URL=https://api.example.test bun run build:app
```

See [deployment status](deployment.md) before changing a release workflow.
