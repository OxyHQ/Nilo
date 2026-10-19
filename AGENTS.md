# Nilo — Project Conventions

Nilo is Oxy's document and database workspace. The monorepo contains
the Expo app in `apps/app/` and the Express API in `apps/api/`.

Universal standards live in `~/AGENTS.md`, and Oxy-wide gotchas live in
`~/Oxy/AGENTS.md`. Documentation belongs in `docs/`, history in git, and status
in issues. This file holds only rules, commands, and pointers. Budget: under
8 KB.

## Runtime boundaries

- PostgreSQL through Drizzle is the only application database. `DATABASE_URL`
  is required and the API verifies it before listening. Never add another
  database, an in-memory database fallback, or a second persistence path.
- Nilo owns workspace documents, databases, collaboration, uploads,
  notifications, and feedback. It does not own inference routing, provider
  adapters, provider health, model catalogues, or provider credentials.
- Provider credentials live only in Kaana's encrypted PostgreSQL store. They
  must never enter Nilo source, environment variables, database tables,
  logs, bundles, or deploy configuration.
- One-shot product operations use `Nilo -> Oxy -> Kaana`. Conversations,
  memory, tools and agents use `Nilo -> Alia -> Oxy -> Kaana`. Nilo never
  calls Kaana directly. Kaana's canonical signed origin is exclusively
  `https://kaana.ai`.
- Do not add local chat-completion, Clarity compatibility, provider execution,
  or developer provider-key routes. Adding a new workspace feature must not
  weaken `inferenceBoundary.test.ts` or `inferenceBoundary.pgdb.test.ts`.

- Oxy's references to Nilo's files are released by triggers on `page_files`
  and `pages` (`apps/api/src/db/triggers.ts`, `docs/files.md`), which
  drizzle-kit does not know: a migration that rebuilds either table recreates
  them. `page_files.page_id` names the Oxy reference and must never become a
  foreign key again. Never let reconciliation commit without reading its
  dry-run report: a removed owner reference cannot be recreated.

## Product vocabulary

Use page, block, database, view, workspace, member, and collaboration. Do not
reuse legacy chat vocabulary for workspace concepts.

## Commands

npm releases: only Actions → Release packages (`release-packages.yml`, Oxy's shared
workflow, OIDC); a package's gates are its `prepublishOnly`. Never publish from a laptop —
`~/Oxy/docs/npm-releases.md`.

```bash
bun install
bun run lint
bun run check:bun-pin   # packageManager is the one bun pin; image and workflows obey it
bun run --filter @nilo/api test
bun run --filter @nilo/api test:bun   # same suite under Bun, the production runtime
NILO_TEST_DATABASE_URL=postgres://nilo:nilo@127.0.0.1:5439/postgres \
  bun run --filter @nilo/api test:pgdb
bun run test:worker
bun run check:ci-wiring
NILO_TEST_DATABASE_URL=postgres://nilo:nilo@127.0.0.1:5439/postgres \
  bun run check:api-entrypoints
bun run build:api
EXPO_PUBLIC_API_URL=https://api.example.test bun run build:app
```

Formatting and linting are Biome only (root `biome.json`, no ESLint or
Prettier): `bun run lint` checks the whole repo, as CI's `biome ci .` does;
`bun run format` rewrites formatting. Formatting-only commits go in
`.git-blame-ignore-revs`.

Every `test*`/`check*`/`typecheck` script must be run by `ci.yml`;
`check:ci-wiring` enforces it. A boot or migration failure must exit non-zero: never defer a
fatal exit to an unref'd timer, and `check:api-entrypoints` executes the built
artefacts under bun, the image's runtime, to hold that.

Commit manifest and `bun.lock` changes together. The web export requires an
explicit HTTPS `EXPO_PUBLIC_API_URL`; there is no implicit production API
hostname. Local development may still use an explicit HTTP origin.
Deployment state and migration commands are documented in `docs/deployment.md`.
