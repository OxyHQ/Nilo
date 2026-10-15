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
- The actions are offered only when Nilo's application holds
  `inference:invoke` in Oxy's registry (its public metadata lists its scopes)
  and the edge lists that power level for the member (`useAiAvailable`). The
  catalogue alone is filtered by the kind of application, not its scopes.

## What Oxy has to enable

Verified on 2026-10-15 against OxyHQServices `main`:

- Nilo is registered as a `first_party` application with no capabilities and
  only public user-read authority (`seedOxyApplicationsSpecs.ts`,
  `NILO_APPLICATION_ID`). It does not hold `inference:invoke`, so the edge
  would refuse with `insufficient_scope`, and no action is offered.
- `inference:invoke` spends the balance of the account that owns the
  application (Nilo's owner), never the member's
  (`applicationScopes.ts`). Granting it is that business decision.
- The edge must also admit first-party applications: `INFERENCE_EDGE_AUDIENCE`
  set to `first_party`, `public`, or an allowlist naming Nilo's application.

Once both hold, the actions appear without a Nilo release.
- The answer is Markdown, shown first; nothing changes until the member
  replaces the block, inserts below it, or (for the page) inserts at the top —
  one undo step, synced like any edit.

Code: `apps/app/lib/ai/`, `apps/app/components/page-editor/ai-dialog.tsx`,
`apps/app/lib/editor/markdown-blocks.ts`. Conversations with Alia ("Ask
Alia") are separate: `Nilo -> Alia -> Oxy -> Kaana`.
