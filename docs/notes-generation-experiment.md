# Notes generation experiment: disabled

This code is deployed with the experiment **off** by default. Do not enable it
until the cross-client recovery and rollout protocol is reviewed and ready.
There is no production client adoption in this change.

When off, legacy notes requests keep their existing database calls and locks;
there is no generation lookup, transaction or workspace-row lock added to that
path. The router does a small in-process flag/header check. Requests explicitly
using `generationAware=1` on sync or `X-Notes-Generation` return
`503 NOTES_GENERATION_UNAVAILABLE` before home provisioning or a write.

`NILO_NOTES_GENERATION_ENABLED=1` turns on experimental handling. The process
reads and freezes this flag at startup; the enabled setting requires a valid,
explicit `NILO_NOTES_GENERATION_EPOCH`. The epoch is part of every token. Any
future reactivation must use a fresh epoch: reset or erase may have occurred
while the experiment was off, so reusing an epoch can make an old token appear
current. The value is a concurrency identifier, not an authorization secret.

## What the enabled code covers

An opted-in sync returns a generation; opted-in note POST, PATCH and DELETE
compare their supplied generation in the same transaction as the write. Reset
and erase advance the workspace generation in their transactions. Guarded
writes and those maintenance operations use a workspace row lock in a consistent
order. A stale write gets `409 NOTES_GENERATION_CHANGED`. The generation header
is rejected on routes that do not implement this fence. The normal Nilo
permissions and authentication still apply.

This is not a complete erase guarantee:

- Older clients and clients omitting the header remain accepted and are not
  fenced. Other Nilo write paths, Oxy file links, pending recording uploads and
  operations not passing the token are not covered.
- Mixed deployments are unsafe to activate: a disabled replica can accept a
  legacy write or erase without advancing the epoch while an enabled replica
  accepts a prior token. The same issue applies if the feature is turned off
  and on with an old epoch. There is no coordination mechanism in this change.
- Noted currently pushes its outbox before pulling. Existing or offline edits
  without a verified generation cannot safely be assigned the newest token.
  The client needs durable quarantine and explicit recovery of notes and
  recordings before the protocol can be adopted. No client change is included.
- The enabled lock can wait behind another transaction, and the full cost and
  deadlock interactions under production load are unmeasured. Client timeouts
  may occur after the server starts a request. The off-path tests and small
  local latency sample do not establish production performance.
- Migration 0057 creates a new table without a foreign key to `workspaces`, so
  adding it does not take a lock on that hot table. Rows can outlive a deleted
  workspace; an independently reviewed, bounded cleanup strategy is required
  before enabling the experiment. Never infer ownership from this token.

Before any activation, separately verify all replicas' configuration and epoch,
client distribution and recovery, rollback behavior, orphan cleanup, every
writer that needs fencing, and real load/lock behavior. A successful disabled
rollout or the tests in this change do not approve activation.
