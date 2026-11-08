# Agent memories

Every personal workspace can hold the account's long-term memory for AI agents:
the `memories` system database, made on first use. Agents (Alia, or any MCP
client) read and write it through their own MCP server at `https://mcp.memory.nilo.so`,
apart from the one for the workspace's pages (`https://mcp.nilo.so`).
The owner sees it as an ordinary table: filter it, edit a memory, pin one, or
delete it. Nothing an agent remembers is hidden from the person it is about.
Code: `apps/api/src/lib/memories.ts`, `apps/api/src/capabilities/nilo.handlers.ts`,
the schema in `apps/api/src/lib/databases/system.ts`.

## The model

A memory is **one atomic fact**: a single self-contained sentence is the row's
title ("Prefers Postgres over Mongo"). Conversation, summaries and secrets do
not belong here.

| Property | Type | Meaning |
|---|---|---|
| Memory (title) | text | the fact; the same fact, ignoring case and accents, is stored once |
| Detail | text | optional context, up to 8,000 characters |
| Kind | select | preference, fact, episode, procedure, project (the owner may add kinds) |
| Tags | multi-select | made on demand when an agent uses a new one |
| Source | text | which agent or client saved it |
| Importance | number | 1 (trivia) to 5 (essential), default 3 |
| Pinned | checkbox | pinned memories rank higher |
| Last used | date | set when saved or saved again |
| Fingerprint | text | hash of the normalised title, used to deduplicate |

The database is private to the owner (no teamspace), cannot be deleted, and its
app-owned properties cannot be removed or retyped (`systemPropertyChangeError`).
A workspace reset empties it; the next tool call makes it again.

## Tools

Served by their own catalog, `nilo-memories` (`memories.catalog.ts`), MCP only. Nilo has
three MCP lanes, one host each: Noted's notes, the workspace's pages (`nilo`,
read-only, `pages.read`) and these memories. A client connected to one never
sees the tools of another, and asks for memory scopes on its own.

**Alia is the person's memory's first-party client.** The tools are also `internal`
with `actors: ['alia']`: Alia lists them from Oxy's registry with her other app
tools (Inbox, Mention…) and calls them through `/_oxy/capabilities/<tool>` with an
Oxy capability ticket, no consent screen. The route serves the three catalogs of
this API (notes, pages, memories) as lanes, each with its own audience, app id and
executor; a ticket for one never runs a tool of another. Agents other than Alia do
not get these tools. Third-party MCP clients use the MCP server and its OAuth scopes.

| Tool | Scope | Does |
|---|---|---|
| `recallMemories` | `memories.read` | ranked search; no query lists the most important |
| `remember` | `memories.write` | saves a fact; saying it again refreshes it |
| `updateMemory` | `memories.write` | corrects title, detail, kind, tags, importance, pin |
| `forgetMemory` | `memories.write` | archives (restorable); `hard: true` deletes for good |

Every write takes an `idempotencyKey` and runs once per account, tool and key
(`capabilities/idempotency.ts`). A memory the owner archived comes back when an
agent saves the same fact again. Memories never appear in `listPages`,
`searchPages` or `readPage`.

## Recall

Nilo does not embed or summarise anything and calls no model: that belongs to
Alia/Oxy, never to Nilo (`AGENTS.md`). Recall is lexical and cheap:

- Each query word scores in the title (3), tags (2) and detail (1); a memory
  with none of the words is not recalled.
- Relevance is weighted twice the prior, which is importance (0.3), pinned
  (0.2) and recency of last use (0.2, a 90-day decay), so a clearly relevant
  memory outranks a merely important one.
- Filters: `kind`, `tags` (all of them), `minImportance`, `includeArchived`.
- It reads at most the 2,000 most recently edited memories of the account.

What makes a memory findable is how it is written: a good title, tags and
detail from the agent. If this stops being enough, semantic recall comes from
embeddings made by Alia/Oxy and stored as a row property; the model does not
change.

## Dependencies outside this repo

- Oxy must issue the `memories.read` and `memories.write` scopes for the `nilo-memories`
  catalog (the MCP transport demands each tool's `requiredCapabilities` as the
  token's scopes) and the catalog must be registered again
  (`apps/api/src/scripts/register-capability-catalog.ts`), as for any catalog
  change.
