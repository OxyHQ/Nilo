# AI actions

One-shot operations on the member's own text — improve the writing, fix
spelling and grammar, make it shorter or longer, simplify, summarize,
translate — on a block (its menu's "Ask AI") or the whole page ("Summarize
with AI"). They have no conversation, memory or tools, so they take the
one-shot path (`~/Oxy/docs/kaana-inference.md`):

```text
Nilo app -> Oxy inference edge (api.oxy.so/v1) -> Kaana -> provider
```

- The app calls the edge with the signed-in member's own Oxy session
  (`createInferenceClient(oxyServices)` from `@oxy.so/core/inference`). Oxy
  decides whether this member and this app may spend, and which routes run.
  Nilo's API is not involved and holds no inference credential.
- Nilo names a power level (`instant`) and nothing else: no model, provider or
  route. It never retries: the edge and Kaana already have, and say so in the
  error (`code`, `retryable`, `requestId`).
- The actions are offered when Oxy's current account catalogue lists the needed
  power level. Own products do not request `inference:invoke` or app consent.
  Availability is cached by account, session and core session epoch, and refreshed
  when the shared supervision state changes. Oxy still enforces account policy,
  supervision, routing availability and billing on every inference request.
- An unavailable or refused route stays unavailable; removing app scopes does not
  manufacture a model route or substitute a different account's catalogue.

- The answer is Markdown, shown first; nothing changes until the member
  replaces the block, inserts below it, or (for the page) inserts at the top —
  one undo step, synced like any edit.

Code: `apps/app/lib/ai/`, `apps/app/components/page-editor/ai-dialog.tsx`,
`apps/app/lib/editor/markdown-blocks.ts`. Conversations with Alia ("Ask
Alia") are separate: `Nilo -> Alia -> Oxy -> Kaana`.
