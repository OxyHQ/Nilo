# Nilo API

Express and TypeScript API for the Nilo workspace.

## Runtime

- PostgreSQL/Drizzle is the only database and `DATABASE_URL` is required.
- Socket.IO provides real-time workspace updates.
- Redis/Valkey is optional for Socket.IO scale-out.
- Browser push is optional. Attachments live in Oxy's file manager (`docs/files.md`).
- Oxy session verification comes from `@oxy.so/core/server`.

Nilo has no provider runtime, provider-key storage, model routing, billing
credits, or chat-completion endpoints. Provider credentials belong only to
Kaana's encrypted PostgreSQL database.

## Commands

```bash
bun run dev
bun run lint
bun run test
NILO_TEST_DATABASE_URL=postgres://nilo:nilo@127.0.0.1:5439/postgres \
  bun run test:pgdb
bun run build
```

Start from `.env.example`. The only required secret-bearing runtime binding is
the PostgreSQL `DATABASE_URL`; optional service credentials belong to their
own non-inference integrations.
