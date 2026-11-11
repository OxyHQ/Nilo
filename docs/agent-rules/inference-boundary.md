# Inference boundary and database rules

Rules moved out of `AGENTS.md`; they apply to every change to Nilo's API,
persistence or AI features.

## Persistence

- PostgreSQL through Drizzle is the only application database. `DATABASE_URL`
  is required and the API verifies it before listening. Never add another
  database, an in-memory database fallback, or a second persistence path.

## Ownership

Nilo owns workspace documents, databases, collaboration, uploads,
notifications, and feedback. It does not own inference routing, provider
adapters, provider health, model catalogues, or provider credentials.

## Inference

- Provider credentials live only in Kaana's encrypted PostgreSQL store. They
  must never enter Nilo source, environment variables, database tables, logs,
  bundles, or deploy configuration.
- One-shot product operations use `Nilo -> Oxy -> Kaana`. Conversations,
  memory, tools and agents use `Nilo -> Alia -> Oxy -> Kaana`. Nilo never calls
  Kaana directly. Kaana's canonical signed origin is exclusively
  `https://kaana.ai`.
- Do not add local chat-completion, Clarity compatibility, provider execution,
  or developer provider-key routes. A new workspace feature must not weaken
  `inferenceBoundary.test.ts` or `inferenceBoundary.pgdb.test.ts`.

See [Kaana inference rules](https://github.com/OxyHQ/Kaana/blob/main/docs/inference-rules.md)
and [Alia requester authority](https://github.com/OxyHQ/Alia/blob/main/docs/requester-authority.md).

## Oxy file references (`page_files`, `pages`)

Oxy's references to Nilo's files are released by triggers on `page_files` and
`pages` (`apps/api/src/db/triggers.ts`, [files](../files.md)), which drizzle-kit
does not know: a migration that rebuilds either table recreates them.
`page_files.page_id` names the Oxy reference and must never become a foreign
key again. The daily reconciliation commits, and a removed owner reference
cannot be recreated: a reference the inventory cannot list must hold the commit
back, as an attachment naming no page does.
