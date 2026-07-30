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
6. Queue slow cleanup outside the HTTP response and report that cleanup state.
7. Record only bounded non-sensitive result metadata; scrub arguments and
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

## User experience

1. Stream pending actions as inline cards and preserve more than one card.
2. The user explicitly opens a card; arrival never opens a modal.
3. Consequential dialogs focus Cancel. Enter never confirms them.
4. Show the complete bounded preview, including recipients, subject, body,
   target IDs, fields, values, effects, and hashes where appropriate.
5. Ignore confirmation responses after the user changes Vault, agent, or
   session.
6. On a network error, query server status before displaying a result.
7. Never persist exact preview details in browser storage; restore pending
   previews only from the scoped server endpoint.
8. Localize stable status/error codes and use locale pluralization.

## Restrictions and edge cases

- Do not use raw text substrings as sufficient write authorization.
- Do not accept a client-side list of pre-confirmed tool IDs.
- Do not stream secret-bearing arguments or retain them in terminal rows.
- Do not retry an unknown external outcome.
- Do not execute newly added trash items from an older count preview.
- Do not overwrite concurrent page, row, schema, contact, or registry changes.
- Do not convert a route's meaningful `404` or `409` into a generic `500`.
- Do not report a batch as complete when any item failed.
- Do not await cloud filesystem cleanup in the confirmation HTTP response.

## Verification

Completion requires tests for negation and quoted/meta requests in all supported
languages, exact skill binding, generic `always` interception, descriptor
revision mismatch, permissions and scrubbing, expiry and retention, concurrent
claim/cancel, stale targets, rollback and partial results, unknown outcomes,
multiple UI cards, focus and Enter safety, session switching, status recovery,
localized errors, backend API execution, frontend build, and a disposable
native browser flow.
