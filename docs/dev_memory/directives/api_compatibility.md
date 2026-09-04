# DIRECTIVE: API_COMPATIBILITY_2X_TO_3X

> ID: 2026-09-03-api-compatibility
> Associated Script: `scripts/check_api_compatibility.py`
> Last Update: 2026-09-03
> Status: ACTIVE

---

## 1. Objectives and Scope

- **Main Objective:** prove deterministically that the public Gnosi 3 HTTP and
  WebSocket surface preserves every operation shipped by the final 2.x release.
- **Canonical baseline:** the Git object named by the committed baseline, initially
  the public `v2.0.6` tag. The tag's commit and tree identities are recorded so a
  moved or substituted ref cannot silently regenerate the contract.
- **Success Criteria:** every historical method/path remains present in the same
  transport category, except entries documented individually in the explicit
  compatibility allowlist.

## 2. Input/Output Specifications

### Inputs

- `openapi/openapi.json`: current deterministic HTTP contract.
- `backend/`: current source used only to inventory WebSocket routes, because
  OpenAPI does not represent them.
- `backend/tests/contracts/api-v2.0.6.json`: reviewed historical baseline.
- `backend/tests/contracts/api-compatibility-allowlist.json`: explicit deliberate
  compatibility changes.
- Local Git objects for baseline regeneration; no network is required.

### Outputs

- Exit zero and a category/count summary when compatibility is preserved.
- A deterministic list of missing or recategorized operations on failure.

## 3. Logical Flow

1. Validate the baseline schema, source ref, commit and tree identities.
2. Read the current HTTP inventory from committed OpenAPI.
3. Classify HTTP operations as JSON, stream, download or redirect from response
   media types and response classes encoded by OpenAPI.
4. Parse current WebSocket decorators separately and resolve router prefixes from
   the application composition module.
5. Compare every baseline operation by method, normalized path and category.
6. Apply only exact allowlist entries containing a reason and replacement or
   removal disposition; reject stale allowlist entries.
7. Fail with an ordered diagnostic when any historical operation is missing,
   recategorized or silently excepted.

## 4. Tools and Libraries

- Python 3.11 standard library only: `ast`, `json`, `subprocess`, `pathlib`.
- Git object database already present in the checkout.

## 5. Restrictions and Edge Cases

- Do not derive the historical baseline from the current application.
- Do not fetch a tag from the network during CI or ordinary checks.
- Do not treat streams, downloads, redirects or WebSockets as ordinary JSON.
- OpenAPI omits WebSockets; inspect the actual decorators and composition graph.
- Regeneration is a reviewed migration, never an automatic side effect of CI.
- An allowlist entry must name one exact operation and explain the deliberate
  compatibility decision. Wildcards are forbidden.
- Do not leave a frontend request adapter broader than its explicit OpenAPI
  request model after replacing a free-form body. That produces generated-client
  failures such as `unknown[]` not being assignable to `string[]`; narrow the
  adapter to the stable historical wire type and verify its callers.

## 6. Error Protocol and Learning

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 2026-09-03 | Historical app import was not deterministic | The 2.x import performs legacy initialization and depends on its old runtime | Extract route declarations from the immutable Git tree and freeze the reviewed result instead of importing the old app |
| 2026-09-03 | Initial comparison reported false removals and JSON recategorizations | FastAPI/OpenAPI uses implementation parameter names and several response-producing endpoints expose an empty or generic schema | Canonicalize parameter names while preserving converters, and supplement OpenAPI with deterministic endpoint-source evidence for stream, download and redirect transports |
| 2026-09-03 | Path converters could not be compared directly | FastAPI removes `:path` from generated OpenAPI even though it exists in source | Normalize all parameterized segments for route identity, retain literal segments exactly, and classify transport from both OpenAPI and source evidence |
| 2026-09-03 | Guardrail launcher reported Ruff unavailable in the isolated worktree | The worktree intentionally had no local virtual environment and the command was invoked outside the provisioned runtime | Expose the already provisioned project runtime on `PATH` when validating an isolated worktree; do not create or synchronize a second environment merely to run the guardrail |
| 2026-09-03 | Calendar client stopped type-checking after request models became explicit | The handwritten free/busy adapter still advertised `unknown[]` while the real provider contract and generated client require calendar identifiers as strings | Narrow `CalendarFreeBusyInput.calendarIds` to `string[]` and run the global frontend type-check after every contract regeneration |
| 2026-09-03 | Vault table mutation bodies were exposed as unconstrained dictionaries | The extracted routes retained the 2.x `dict = Body(...)` annotations, so OpenAPI could not name even the historically consumed fields | Use explicit Pydantic request models. Preserve unknown keys only for full database/table upserts because 2.x stored those records verbatim and extensions rely on them; ignore unknown keys for rename and option commands, matching their historical field-by-field reads. Keep historically loose JSON value types at the boundary so malformed values retain downstream 2.x behavior rather than becoming new 422 responses. |
| 2026-09-03 | Strict mypy rejected returning `dict[str, object]` as the open-key registry alias | Mutable dictionaries are invariant in their key type even though every HTTP key is a valid registry key | Build the result under the `RegistryData` contextual type with a comprehension; do not cast, suppress, or narrow the internal open-key contract. |
| 2026-09-03 | An enabled option-catalog E2E run also exercised unrelated translation behavior and failed there | The broad test module combines table mutations with translation error serialization and request-user context, whose current expectations are independent of these request models | Report those baseline failures explicitly and validate this change with the named upsert/default/option mutation tests; do not alter translation code from a vault-table contract change. |
| 2026-09-03 | Extracted option services coerced `field_id` with `str(...)`, unlike 2.x | The modularization had made malformed JSON selectors look like valid identifiers instead of retaining the historical direct `.strip()` failure | Preserve the direct string boundary for `field_id`/`field`; explicit request models must neither introduce a new 422 nor silently normalize malformed legacy values. |
| 2026-09-03 | A selected option mutation E2E reported empty usage counts while the complete module reached that assertion successfully | The legacy module has an unrelated order-dependent page-index warm-up through its preceding translation cases | Keep reporting the full-module translation baseline failures separately, and prove request adaptation with direct handler contract tests plus the independently passing upsert/default cases; do not hide the index dependency or broaden this payload-only change. |
| 2026-09-03 | Strict mypy rejected a contract test that patched route-module import aliases | Imported collaborators are private implementation names unless explicitly re-exported, even though runtime attribute access works | Patch the owning API/lifecycle/options modules directly; do not expose route internals merely to satisfy a test. |
| 2026-09-03 | An internal Brain-table creator no longer type-checked after the HTTP table request became a Pydantic model | The historical route function served both as FastAPI boundary and as an internal registry-data service | Keep the HTTP handler model explicit and delegate to a separately typed `create_table_from_registry` function; internal callers use that function without casts or payload reconstruction. |
| 2026-09-03 | The isolated façade-order test could not resolve `create_table_from_registry` | A type-check-only import was added to the historical façade, but its runtime bridge registers `tables.legacy_composition`, not `tables.routes` | Re-export each compatibility helper from the registered owner module as well as declaring it under `TYPE_CHECKING`; verify both import orders in isolated subprocesses. |

## 7. Rationalizations

| Rationalization | Consequence |
| --- | --- |
| "The current OpenAPI is large, so it probably contains all old routes." | Additions can hide removals; compare operation identities explicitly. |
| "A removed route can be ignored in code." | The exception becomes invisible; require a reviewed allowlist record. |
| "WebSockets are outside OpenAPI, so they are outside compatibility." | Real-time collaboration could regress undetected; inventory them separately. |

## 8. Red Flags

- The recorded baseline Git identity no longer resolves locally.
- Baseline regeneration changes unrelated operations.
- A transport category changes without a reviewed compatibility decision.
- An allowlist entry no longer matches a failing comparison.

## 9. Examples of Use

- Standard check: `pnpm check:api-compatibility`
- Reviewed regeneration: `uv run python scripts/check_api_compatibility.py --regenerate-baseline --source-ref v2.0.6`

## 10. Pre-Execution Checklist

- [ ] The canonical historical tag exists locally.
- [ ] `openapi/openapi.json` is current.
- [ ] The worktree is clean before a baseline regeneration.

## 11. Post-Execution Checklist

- [x] Baseline provenance and counts inspected.
- [x] Baseline regeneration is byte-stable.
- [x] Focused tests pass.
- [x] Static lint and strict type-check pass.
- [x] Compatibility gate passes against the current committed OpenAPI.

## 12. Additional Notes

The baseline records the compatibility surface, not full historical payload
schemas. Payload precision remains governed by current deterministic OpenAPI and
its generated client. This check specifically proves that 3.0 did not silently
drop or change the transport semantics of a public 2.x operation.
