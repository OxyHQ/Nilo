# Deployment status

Last verified: 2026-09-13.

## Verified state

- The product was renamed from Oxy Station to Nilo, and the repository from
  `OxyHQ/Station` to `OxyHQ/Nilo`.
- `nilo.so` is registered and **delegated to Cloudflare**: `dig NS nilo.so`
  answers `alec.ns.cloudflare.com` / `deb.ns.cloudflare.com`, and the zone
  serves its own SOA. Delegation landed the same day it was bought; an earlier
  check that morning still returned NXDOMAIN with no NS.
- The September 13 live audit found two running Nilo API ECS tasks.
  `api.nilo.so` resolves and its HTTPS `/health` endpoint returned 200.
- `nilo.so` now resolves through Cloudflare. The HTTPS `/health` probe returned
  403; that is not evidence of a working authenticated frontend flow. Verify
  deployment IDs and actual application routes before claiming readiness.
- Historical frontend artifacts used `oxystation.pages.dev`; the current
  repository deploys the `nilo` Worker. Immutable deployment URLs remain in
  the corresponding GitHub Actions runs.
- The obsolete hosting specifications were removed because they
  described a retired database/runtime and were not an apply-ready source of
  truth.

## Runtime contract

- The API requires `DATABASE_URL`, executes a real PostgreSQL query before
  listening, and uses only the Drizzle schema and migrations in this repo.
- PostgreSQL 16 or later, built with ICU (production: RDS PostgreSQL 17), with
  the `unaccent` and `pg_trgm` extensions available: migrations
  `0018_unaccent_search` and `0036_fuzzy_titles` create them (trusted
  extensions, so the database owner can), the `nilo_search` text search
  configuration and the `nilo_fold` function search uses;
  `0038_view_rows_keyset` creates the ICU collation views sort text by
  (`nilo_sort`), and view filters read dates with `pg_input_is_valid` (16+).
  What the schema cannot express lives in `src/db/prerequisites.ts`.
- The frontend export preflight requires an explicit HTTPS
  `EXPO_PUBLIC_API_URL`. The Cloudflare workflow reads it from the
  `NILO_API_URL` repository variable and fails before export when it is
  missing or is not a valid HTTPS origin; it never falls back to an invented
  production host.
- The web Worker reads the same origin as `API_URL` (passed by the deploy):
  for `/pub/...` it asks the API for the published page and fills in its
  title, summary, link-preview tags and text for readers without script,
  `noindex` unless its owner allowed search engines. Without it, or when the
  API does not answer within 3 s, it serves the app's page unchanged.
- `REDIS_URL` is the shared Oxy Valkey (`/oxy/_shared/REDIS_URL`, read only,
  as every multi-task Oxy backend does). The API runs two tasks: Redis is what
  makes a page's room reach members on both and what makes rate limits count
  one window for both. Without it each task does both on its own, and the API
  says so at boot.
- `IP_HASH_SALT` (`/oxy/nilo/IP_HASH_SALT`) keys anonymous rate limits by a
  salted hash of the client address; no raw address is stored.
- `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (`/oxy/nilo/`, SecureString) and
  `VAPID_SUBJECT` sign browser push. Without them
  `GET /notifications/vapid-public-key` answers 503.
- Attachments live in Oxy's file manager (`docs/files.md`): no bucket, no
  storage credential, and the image is read-only. The API mints file URLs
  with its workload identity. The owner's live file-to-application reference
  determines which attachments Oxy can serve to Nilo.
- Nilo tells Oxy when it stops using a file (Oxy ADR 0043, `docs/files.md`)
  with the same identity. Failed deliveries remain in `file_reference_removals`
  and retry after the service recovers. The daily
  reconciliation commits; its counts are `file_reference_runs.report`.
- File events: set Nilo's endpoint to `https://<api origin>/webhooks/oxy/files`
  (Oxy console → Webhooks → File events, or `oxy.apps.setFilesWebhook`). Oxy
  verifies it with a challenge the API answers without a secret, and shows the
  secret once: store it as `OXY_FILES_WEBHOOK_SECRET` (`/oxy/nilo/`,
  SecureString) in the task definition. Until it is set the API answers events
  503 and Oxy keeps retrying them.
- Invitation email (`apps/api/src/lib/invite-email.ts`): someone invited who
  has no Oxy account is emailed the invitation's link by Oxy
  (`POST /apps/invitations/email` on `OXY_API_URL`) with the same
  workload identity (`oxy-nilo-task`). The operational mail switch is off until
  `INVITE_EMAILS_ENABLED=true` is set in the task definition (a plain
  environment value, no secret). Own products need no scope grant.
  The link is on `OXYNILO_PUBLIC_URL`, which must be an origin registered for
  Nilo's application (`https://nilo.so`), or Oxy refuses it. Without the
  email the invitation is still made, and admins copy its link from Settings ›
  Members.
- The live task definition is the source of truth: `deploy-ecs.sh` copies it,
  so a secret added to it stays across deploys.
- Nilo deployment configuration contains no provider credentials, provider
  runtime, or inference route.
- The API image runs on Bun: `apps/api/Dockerfile`'s runtime stage is
  `oven/bun:1.4.3-slim`, the image the dependencies are installed with, and the
  migrator one-shot in `.github/scripts/deploy-ecs.sh` runs
  `bun apps/api/dist/db/migrate.js`. CI's `Build Production Image` job boots
  the built image against Postgres (`.github/scripts/smoke-api-image.sh`). To
  return to Node, revert the change that made this switch: it moved the
  Dockerfile and the migrator command together, and they must stay together.

## Offline on iOS and Android

Pages kept offline (their Yjs documents, in SQLite: `docs/collaboration.md`)
open without a connection while the app is running. A cold start without a
connection ends signed out, so they cannot be reached then: `@oxy.so/services`
(11.2 through 11.5) classifies the application against Oxy's registry
(`apps.getPublic(clientId, { cache: false })`, a 5 s deadline) before
restoring any stored session, and fails closed when it cannot
(`resolveApplicationSessionLane`; verified 2026-10-16 on 11.5.0). Nothing kept
on the device is lost: a signed-out boot changes no account, so the pages and
unsent changes are there when the session comes back. Opening offline from a
cold start needs the SDK to remember the last classification of its
`clientId`, an Oxy change.

## Importing Noted

Noted's accounts are copied into Nilo by a one-shot with the API's image
(`apps/api/src/scripts/import-noted.ts`):
`bun apps/api/dist/scripts/import-noted.js [--dry-run] [--user <oxyUserId>]`,
with `DATABASE_URL` (Nilo) and `NOTED_DATABASE_URL` (Noted, read in a
read-only transaction; SSM `/oxy/noted/DATABASE_URL`) as secrets, and the
service's network configuration. It prints one JSON report per account and is
safe to run again: notes keep their ids, and what is already in Nilo is left
alone. Run `--dry-run` first, then the copy, then the cut-over of Noted's
client.

## Notes capability catalog

`.github/scripts/deploy-ecs.sh` registers the notes catalog with Oxy after the
rollout is healthy and the post migrations ran, as a one-shot with the
release image (`bun apps/api/dist/scripts/register-capability-catalog.js`).
It runs as Nilo's service (the live `oxy-nilo-task` workload binding). Oxy
checks the registered catalog namespace and workload environment; own app
scopes are not prerequisites. A failed registration fails the deploy. The event outbox worker runs in every
API task that has that identity; `APP_EVENT_OUTBOX_WORKER_ENABLED=false`
stops it, and events then wait in `app_event_outbox`.

## Shared transport rollout

Nilo uses published Oxy core 7.1 / contracts 6 / services 13 and MCP 1.4. Human
HTTP requests keep the existing session bearer and domain response bodies.
Socket handshakes resolve fresh credentials through the linked client; an account
change cancels pending handshakes before reconnecting under the new session.
Noted's existing Nilo session and workspace-room wire contract is unchanged.

The event outbox uses `@alia.onl/server` 1.2's product transport and the canonical
Alia service audience. Deploy Alia's compatible reader before this producer;
publishing its SDK alone does not prove the reader is live. Invitation delivery
uses the platform transport and preserves its saved invitation, original
idempotency key, mail switch and recipient limits. Temporary AWS credentials
have an explicit provider dependency, with no customer-key fallback.

## Before a new API release

1. Provision or identify the intended PostgreSQL database and secret binding.
2. Choose the API hosting target and verify its release branch and health
   endpoint.
3. Apply migrations from zero and from the last production migration.
4. Set `NILO_API_URL` to the verified API origin.
5. Deploy the frontend and probe an authenticated workspace request through the
   public origin.

Do not create DNS or claim production readiness until those facts are verified.

## Local PostgreSQL verification

```bash
docker compose -f apps/api/docker-compose.postgres.yml up -d
NILO_TEST_DATABASE_URL=postgres://nilo:nilo@127.0.0.1:5439/postgres \
  bun run --filter @nilo/api test:pgdb
docker compose -f apps/api/docker-compose.postgres.yml down
```
