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
- The frontend export preflight requires an explicit HTTPS
  `EXPO_PUBLIC_API_URL`. The Cloudflare workflow reads it from the
  `NILO_API_URL` repository variable and fails before export when it is
  missing or is not a valid HTTPS origin; it never falls back to an invented
  production host.
- Nilo deployment configuration contains no provider credentials, provider
  runtime, inference route, or MongoDB binding.

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
