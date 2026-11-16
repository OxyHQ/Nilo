# Changelog

All notable changes to Nilo (formerly Clarity) are documented here.

## [2026-11-16]

### Compatibility

- `@oxy.so/nilo-contracts` 0.4.1 accepts Bloom Editor 0.8 and 0.9 through its optional editor peer. The app, API and contract development dependency use Editor 0.9, whose document model and Yjs format are unchanged.

## [2026-03-07]

### Added

- Unified autonomy runtime for all chat surfaces (`/clarity/search` and `/v1/chat/completions`).
- Context graph persistence with new models:
  - `ContextNode`
  - `ContextEdge`
  - `ContextSource`
  - `RetrievalStrategy`
  - `LearningRule`
  - `RollbackRecord`
- Intent-oriented recall and planning (`meeting_prep`, `inbox_digest`, `project_status`, `task_followup`, `monitoring`, `research`, `general`).
- Governance engine with risk levels `R0` to `R3`.
- Real approval lifecycle (`threat -> approval request -> decision -> execution`).
- Standardized named SSE events with `eventVersion`.
- Oxy event idempotency log (`OxyServiceEventLog`) and autonomous session bootstrap.

### Changed

- Trigger engine is now the single scheduled execution path.
- App trigger UI now uses `/triggers` endpoints directly.
- Chat runtime now emits plan preview, approval, and agent-session events consistently.

### Removed

- Legacy `automations` routes, model, and scheduler.
- Public direct model-resolution and usage-report routes:
  - `/v1/resolve-model`
  - `/v1/report-usage`
  - `/codea/resolve-model`
  - `/codea/report-usage`
- Legacy chat compatibility route under `/v1/codea/chat/completions`.

## [2026-02-11]

### Initial

- Initial public release of Clarity app + API + multi-surface clients.
