# Deployment status

Last verified: 2026-09-09.

## Verified state

- The product was renamed from Oxy Station to Nilo, and the repository from
  `OxyHQ/Station` to `OxyHQ/Nilo`.
- `nilo.so` is being acquired. Neither it nor `api.nilo.so` resolves, and no
  DNS record has been created for either.
- Frontend artifacts published so far went to the PREVIOUS Cloudflare Pages
  project, `oxystation.pages.dev`. Cloudflare cannot rename a project, so the
  bootstrap step below creates `nilo` on the next deploy and the old project
  keeps serving its last build until someone deletes it. Exact immutable
  deployment URLs are recorded by the corresponding GitHub Actions run.
- There is no public Nilo API deployment. The web artifact therefore is not
  evidence of a working end-to-end production service.
- The obsolete DigitalOcean and SST specifications were removed because they
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

## Before an API deployment

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
