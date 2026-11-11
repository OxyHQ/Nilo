# Nilo

Oxy's document and database workspace: Expo app (`apps/app`), Express API
(`apps/api`), shared `packages/contracts` and `packages/sdk`, Bun monorepo.

## Commands

```bash
bun install
bun run dev                     # api + app; or dev:api / dev:app
bun run lint                    # Biome; fix with bun run lint:fix
bun run --filter @nilo/api typecheck
bun run --filter @nilo/api test
bun run --filter @nilo/api test:bun    # same suite under Bun, the production runtime
NILO_TEST_DATABASE_URL=postgres://nilo:nilo@127.0.0.1:5439/postgres \
  bun run --filter @nilo/api test:pgdb
bun run --filter @nilo/app test
bun run test:worker
bun run check:ci-wiring && bun run check:bun-pin
bun run build:api
EXPO_PUBLIC_API_URL=https://api.example.test bun run build:app
```

`apps/api/docker-compose.postgres.yml` starts the test Postgres.

## Map

- `docs/index.mdx`: product and architecture docs (access, search, files, deployment).
- `docs/agent-rules/`: rules for agents ([inference boundary](docs/agent-rules/inference-boundary.md), [build and CI](docs/agent-rules/build-and-ci.md)).
- `apps/api/src/db/triggers.ts`: hand-written triggers drizzle-kit does not know.

## Conventions

- Use page, block, database, view, workspace, member, collaboration; never legacy chat vocabulary. Why: the product vocabulary is the contract with users and the SDK.
- UI composes Bloom components and its compositor; Nilo supplies data, permissions and actions. Missing shared behaviour goes into Bloom. Normal sizing is `md`. Read [Bloom UI architecture](https://github.com/OxyHQ/Bloom/blob/main/docs/ui-architecture.mdx), [Bloom app conventions](https://github.com/OxyHQ/Bloom/blob/main/docs/app-conventions.mdx) and `docs/onboarding.md` first.
- Lists use the shared `{ items, nextCursor }` shape: [API conventions](https://github.com/OxyHQ/oxy/blob/main/docs/engineering/api-conventions.md).
- Id shapes and migrations follow [Postgres and Drizzle](https://github.com/OxyHQ/oxy/blob/main/docs/postgres-and-drizzle.md).
- Biome is the only formatter and linter (no ESLint, no Prettier); CI runs `biome ci .`.

## Boundaries

Never:
- Add a database other than PostgreSQL/Drizzle, or an in-memory fallback. Why: one persistence path.
- Put provider credentials in Nilo source, env, tables, logs, bundles or deploy config; they live only in Kaana.
- Call Kaana directly or add chat-completion, provider-execution or provider-key routes. Why: Nilo -> Oxy -> Kaana (one-shot) or Nilo -> Alia -> Oxy -> Kaana. Canonical origin is `https://kaana.ai`.
- Make `page_files.page_id` a foreign key, or rebuild `page_files`/`pages` without recreating their triggers. Why: Oxy file references depend on them.
- Publish to npm from a laptop. Merging a version bump to main publishes it ([npm releases](https://github.com/OxyHQ/oxy/blob/main/docs/npm-releases.md)).

Ask first: a new workspace feature touching inference, uploads or file references.
Details: [inference boundary](docs/agent-rules/inference-boundary.md).

## Testing

- API change: `typecheck`, `test`, and `test:pgdb` when SQL or migrations changed.
- App change: `bun run --filter @nilo/app test` and `bun run lint`.
- Scripts, workflows or boot code: `check:ci-wiring`, `check:api-entrypoints` (needs `NILO_TEST_DATABASE_URL`).
- Done means lint and the relevant tests pass and the inference boundary tests are untouched. Rules for CI wiring: [build and CI](docs/agent-rules/build-and-ci.md).

## Pull requests

- Commit manifest and `bun.lock` together; keep formatting-only commits separate (`.git-blame-ignore-revs`).
- Deploy and migration commands: `docs/deployment.md`. CI is the gate: `bun run check:ci-wiring` ensures every test script runs there.

## Secrets

`DATABASE_URL` and `NILO_TEST_DATABASE_URL` come from the environment; never print or commit them. The web export needs an explicit HTTPS `EXPO_PUBLIC_API_URL`.

## Links

[Oxy engineering standards](https://github.com/OxyHQ/oxy/blob/main/docs/engineering/standards.md) · [gate writing](https://github.com/OxyHQ/oxy/blob/main/docs/engineering/gate-writing.md) · [build and runtime traps](https://github.com/OxyHQ/oxy/blob/main/docs/engineering/build-and-runtime-traps.md) · [agent team workflow](https://github.com/OxyHQ/oxy/blob/main/docs/engineering/agent-team-workflow.md)

Owner: @NateIsern (CODEOWNERS). Last reviewed: 2026-11-11.
