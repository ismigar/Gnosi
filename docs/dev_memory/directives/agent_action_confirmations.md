# Directive: Agent action confirmations

## Objective

Guarantee that irreversible, destructive, externally consequential,
code-executing, and otherwise `always`-confirmed agent tools cannot execute
inside the model loop. The user reviews the exact immutable action, confirms it
with a deliberate UI gesture, and can later distinguish success, partial
success, failure, and an unknown external outcome.

## Preparation

1. Resolve the exact tool from the active assigned-skill runtime.
2. Enforce the authenticated workspace role and integration-account boundary.
3. For first-party tools, validate target identifiers and build a
   domain-specific preview with target revisions or an exact collection
   snapshot.
4. For other governed tools, intercept the model call after arguments are
   available and bind the pending action to the tool ID, descriptor digest,
   active skills, effects, and exact server-side arguments.
5. Serialize the complete public event before enforcing its byte limit.
6. Persist the record with a random opaque ID, exact Vault/workspace/user/
   agent/session scope, ten-minute expiry, and database permissions restricted
   to the service account.
7. Stop the model loop after emitting every pending-action event. A pending
   action is not a completed operation.

## Confirmation and execution

1. Claim a pending record atomically and exactly once.
2. Re-resolve the agent runtime and immutable governed descriptor for generic
   tools.
3. Revalidate role, workspace integration access, account availability, target
   revision, and snapshot membership immediately before execution.
4. Execute only an allowlisted first-party dispatcher or the exact governed
   handler resolved from the assigned active runtime.
5. Make local batches atomic through full prevalidation and rollback. If
   rollback itself cannot restore every item, return an explicit partial result.
6. Register every attempted local write for rollback before the write starts.
   A failure after the file replacement but before index refresh must restore
   that same file and must never be reported as a complete rollback otherwise.
7. Seal slow destructive cleanup through a same-filesystem quarantine before
   returning. Queue deletion of the quarantine outside the HTTP response,
   recover abandoned quarantines after restart, and report that cleanup state.
   Keep an `in-progress` manifest until the registry commit is durable, mark it
   `ready` under the same registry lock, restore it if the target still exists
   after a restart, and purge it only when the deletion commit is visible.
   Maintenance must inspect every registered Vault, not only the default Vault.
   If the registry cannot be read directly, leave every `in-progress`
   quarantine untouched; an empty fallback registry is not deletion proof.
8. Heartbeat an executing record while its handler is alive and enforce a
   finite confirmation-execution deadline. A timed-out consequential action is
   an unknown outcome and is never retried automatically.
9. Run blocking first-party provider and filesystem dispatch outside the server
   event loop so the deadline and heartbeat remain live during slow native I/O.
10. Record only bounded non-sensitive result metadata; scrub arguments and
   detailed previews immediately on every terminal transition, and reject
   replay.

## Recovery and retention

1. A known pre-effect failure becomes `failed`.
2. A lost or exceptional result from an external, destructive, or
   code-executing handler becomes `outcome_unknown`.
3. A stale `executing` lease becomes `outcome_unknown`; it is never retried.
4. Status and list endpoints expose only preview and bounded terminal metadata.
5. Chat-session deletion cancels and scrubs its pending actions.
6. Expired, cancelled, completed, partial, failed, and unknown records keep
   minimal audit metadata for seven days, then are deleted.
7. Run retention and stale-lease maintenance at startup and periodically; it
   must not depend on a future user opening the confirmation list.

## User experience

1. Stream pending actions as inline cards and preserve more than one card.
2. The user explicitly opens a card; arrival never opens a modal.
3. Consequential dialogs focus Cancel. Enter never confirms them.
4. Show the complete bounded preview, including recipients, subject, body,
   target IDs, fields, values, effects, and hashes where appropriate.
   For deterministic mass edits, calculate the complete plan on the server and
   show its total count, a bounded sample, and unresolved candidates. Never ask
   the model to enumerate the full mutation list.
5. Ignore confirmation responses after the user changes Vault, agent, or
   session.
6. On a network error, query server status before displaying a result.
7. Never persist exact preview details in browser storage; restore pending
   previews only from the scoped server endpoint.
8. Localize stable status/error codes and use locale pluralization.
9. Refresh pending/executing cards while the chat remains open so expiry and
   terminal transitions do not remain visually pending.

## Restrictions and edge cases

- Normalize governed handler statuses: `error`/`failed` become `failed`,
  `cancelled` and `partial` are preserved, and only documented success statuses
  become `completed`. Unknown or error-bearing results never become success.
- Every mutation path, including legacy tools, uses the same canonical-path
  lock and revision precondition. Filename selection and creation happen while
  holding the destination lock.
- Inter-process page locks use a fixed striped pool, so lock artifacts stay
  bounded without unsafe unlink races against waiting worker processes.

- Do not use raw text substrings as sufficient write authorization.
- Do not accept a client-side list of pre-confirmed tool IDs.
- Do not stream secret-bearing arguments or retain them in terminal rows.
- Do not retry an unknown external outcome.
- Do not execute newly added trash items from an older count preview.
- Do not hash only a trash sidecar when purging the whole entry. The immutable
  snapshot covers every path and byte that will be deleted.
- Do not delete table views or assets that were added after the preview. Table
  deletion binds the table, views, rows, row disposition, and asset tree.
- Do not quarantine an entire database asset root when a table's flat asset
  name collides with the database name. Seal only that table's structured
  subtree and loose flat files; preserve every sibling table subtree.
- Do not resolve a table-owned asset symlink to its target before hashing or
  quarantine. Preserve and move the link itself, and reject paths whose parent
  resolves outside the active Vault.
- Do not purge unknown or malformed entries from the quarantine root. Only a
  `ready` entry or an `in-progress` manifest whose registry commit state is
  known may be removed.
- Do not delete a table until the user has chosen whether its rows are unlinked
  or moved to trash.
- Do not overwrite concurrent page, row, schema, contact, or registry changes.
- Do not convert a route's meaningful `404` or `409` into a generic `500`.
- Do not classify a provider-side `5xx` after an external/destructive dispatch
  as a known failure merely because it is represented by `HTTPException`.
- Do not report a batch as complete when any item failed.
- Do not await cloud filesystem cleanup in the confirmation HTTP response.
- Do not implement an all-rows transformation through a bounded read tool or a
  model-authored update array. Snapshot every source and reference row on the
  server, store compact snapshot and plan digests, and recompute the exact plan
  after confirmation before writing atomically.
- Do not treat hyphen, middle-dot, en-dash, and em-dash title separators as
  interchangeable by accident. Normalize only the explicitly supported index
  title syntax and preserve the separator shown in the original title.
- Do not let bounded terminal history crowd a newer pending action out of the
  resumable list; pending/executing records have retrieval priority.
- Do not preview or execute a mail target by message ID alone. Bind the account
  and exact local or provider message revision, source folder, and provider
  identity, and show the same resolved metadata in the modal.
- Do not invoke repair-on-read parsers while preparing a confirmation preview;
  preview resolution is read-only.
- Review dialogs for chat actions must include an explicit acknowledgement
  checkbox and keep execution disabled until it is checked.

## Verification

Completion requires tests for negation and quoted/meta requests in all supported
languages, exact skill binding, generic `always` interception, descriptor
revision mismatch, permissions and scrubbing, expiry and retention, concurrent
claim/cancel, stale targets, rollback and partial results, unknown outcomes,
multiple UI cards, focus and Enter safety, session switching, status recovery,
localized errors, backend API execution, frontend build, and a disposable
native browser flow.
