# Contributing to Nilo

Nilo is a workspace for documents and databases by Oxy: pages made of blocks, typed databases with views, comments and sharing, on every platform.

**The contribution process lives in the [Oxy organisation CONTRIBUTING guide](https://github.com/OxyHQ/.github/blob/main/CONTRIBUTING.md)**: reporting an issue, filing a feature request, opening a pull request, code review, licensing. It applies here unchanged. This file layers on top of it the same way `AGENTS.md` files layer, so it is short on purpose: it carries only what is different about this repository.

## The default branch is `main`

Branch from `main`, and target `main` with your pull request.

## Prerequisites

- **Bun.** The package manager for every Oxy repository, never npm or yarn. The pinned version is `packageManager` in the root `package.json`.
- **Node.js 22.** The runtime the API is built and deployed on. CI pins it alongside bun.
- **PostgreSQL 17**, local or remote, to run the API and its real-database suite.
- **Redis or Valkey**, optional. Caching falls back gracefully without it.

Nilo contains no inference provider runtime or provider-key store. One-shot
AI operations belong on `Nilo -> Oxy -> Kaana`; conversations, memory,
tools and agents belong on `Nilo -> Alia -> Oxy -> Kaana`.

## Setup

```bash
git clone https://github.com/OxyHQ/Nilo.git && cd Nilo
bun install
cp apps/api/.env.example apps/api/.env   # fill in your values
bun run dev                              # both apps at once
```

Focused commands:

```bash
bun run dev:api    # API only
bun run dev:app    # Expo app only (runs with --clear --tunnel)
```

`apps/app` has its own `.env.example`; copy that too if you are working on the app.

## Layout

A bun workspaces monorepo. **Nilo uses `apps/`, not the `packages/` layout every other Oxy repository uses**, so paths you remember from a sibling repository will not resolve here.

| Workspace | Stack | Purpose |
| --- | --- | --- |
| `apps/api` (`@nilo/api`) | Express + TypeScript | Core API runtime |
| `apps/app` (`@nilo/app`) | Expo (React Native and Web) | Main app: web, iOS, Android |

## Vocabulary

Nilo replaced a legacy AI chat product, and its code and copy carry the vocabulary of the new one. A **page** is a document, made of **blocks**, optionally a row in a **database**, rendered through a **view**, inside a **workspace** that has **members**. Do not reintroduce chat vocabulary (conversation, message, thread, persona, agent, skill, deep research, follow-up) in anything user facing. Do not add provider routing, provider keys or an end-user model picker to Nilo.

## Tests

```bash
bun run --filter @nilo/api test
bun run --filter @nilo/api test:pgdb
```

Vitest. Place test files next to the source as `*.test.ts`. The default suite
does not need a database. The `test:pgdb` suite uses a disposable PostgreSQL
database; `apps/api/docker-compose.postgres.yml` provides the documented local
instance. Note that this is `bun run --filter ... test`, which runs the
package's Vitest script, and not `bun test`, which would start Bun's own
unrelated test runner.

CI runs the following on every pull request, and each line runs locally as written:

```bash
bun run --filter @nilo/api lint
bun run --filter @nilo/api test
bun run build:api
```

## Conventions

Coding standards for this repository are in `AGENTS.md` at the repository root, including the full vocabulary list and the rule that internal AI provider names never appear in UI, API responses, errors, SEO metadata or docs. `AGENTS.md` is read directly by Claude Code, Codex, Cursor and Copilot, and it is the file to update when a convention changes.
