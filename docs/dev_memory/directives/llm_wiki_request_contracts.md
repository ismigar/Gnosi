# DIRECTIVE: LLM_WIKI_REQUEST_CONTRACTS

> ID: 2026-09-03-llm-wiki-request-contracts
> Associated Tests: `backend/tests/test_llm_wiki_request_contracts.py`
> Last Update: 2026-09-03
> Status: ACTIVE

---

## 1. Objectives and Scope

- Replace the free-form request bodies for the LLM Wiki configuration update,
  compatibility Brain creator, retired suggestion acceptor and glossary learner
  with named Pydantic models.
- Preserve the final 2.x behavior for omitted and explicit-null fields, malformed
  JSON values, unknown fields, defaults, response payloads and HTTP errors.
- Do not alter unrelated LLM Wiki operations or regenerate global OpenAPI/client
  artifacts.

## 2. Input/Output Specifications

- `PUT /llm-wiki/config` declares `version`, `ui_locale`, `brain_table_id`,
  `target_table`, `source_tables`, `index_field_ids`, `brain_roles`,
  `source_contract_revision` and `configured`.
- `POST /llm-wiki/brain/create` declares `name`, `ui_locale` and `language`.
- `POST /llm-wiki/suggestions/{suggestion_id}/accept` uses a named empty,
  forward-compatible object because the retired route ignores every body before
  returning its stable HTTP 410 response.
- `POST /llm-wiki/glossary` declares `heard` and `meant`.
- Existing domain code remains responsible for coercion, normalization and
  endpoint-specific errors.

## 3. Logical Flow

1. Parse an object body into the route-specific model.
2. Convert only explicitly supplied model fields into an ordinary mapping.
3. Preserve unknown fields only where accepting them is observable: the retired
   suggestion body. Ignore them where 2.x read only named keys.
4. Delegate to existing route and domain behavior without normalizing values at
   the Pydantic boundary.
5. Verify named schemas, runtime payload transmission and representative legacy
   malformed values.

## 4. Restrictions and Edge Cases

- Do not type historically loose fields as strings, booleans, integers, lists or
  dictionaries at the HTTP boundary; doing so would create new HTTP 422 errors or
  Pydantic coercions before the 2.x logic runs.
- Do not use a root dictionary model: every known public field must be visible in
  OpenAPI.
- A missing optional body for Brain creation and suggestion acceptance must still
  behave like an empty dictionary; explicit JSON null remains accepted there.
- The required config and glossary bodies must remain required JSON objects.
- The accept route must always return HTTP 410 for every accepted object payload,
  without inspecting or transforming its fields.
- Do not generate `openapi/openapi.json` or the TypeScript client in this change.

## 5. Error Protocol and Learning

- On a compatibility mismatch, update both the boundary implementation and this
  directive before rerunning validation.
- Note: do not use `model_dump()` defaults blindly, because omitted fields would
  become explicit nulls. Instead, dump with `exclude_unset=True` so the existing
  truthiness/default logic receives the same mapping as in 2.x.
- Note: do not create a fresh mypy cache for every focal module in this extracted
  route graph, because each invocation re-analyzes the large compatibility facade
  and can appear to hang for minutes. Instead, initialize one isolated cache and
  reuse it for separate full `--strict` invocations; do not weaken import following.
- Note: do not import request models from a route module merely because it imports
  them internally; strict mypy correctly rejects that private alias. Import each
  contract from its owning contracts module in tests.
- Note: do not import the full Vault facade for ad-hoc schema inspection without
  the isolated validation runtime, because application composition attempts to
  refresh the machine-local scheduler mirror. Use the isolated pytest fixture (or
  explicit temporary data directories) even for read-only contract inspection.
- Note: do not type a helper that always materializes a dictionary as the narrow
  `RecordReader` protocol, because that protocol intentionally promises only
  `.get()` and prevents tests or callers from proving omission. Return the honest
  open-key `PageMetadata` dictionary, constructing it under that contextual type
  to avoid mutable-key invariance.
- Note: FastAPI's Pydantic-v2 compatibility `ModelField` does not expose a
  `.required` attribute. Assert body optionality through
  `body_field.field_info.is_required()` in contract tests.
- Note: replacing `Any` with `object` does not make opaque JSON values iterable,
  indexable or numeric. Preserve Python's native runtime behavior through the
  shared `open_values` adapters, and narrow documented records with their owning
  type guards; do not hide cross-module errors by skipping imports in focal mypy.
- Note: focused LLM Wiki and agent tests can otherwise resolve the machine-local
  tool registry and capability-health databases. Set `GNOSI_DATA_DIR` to an
  explicit temporary directory so validation cannot touch personal runtime data.

## 6. Verification

- Focused pytest covers route ownership, named request schemas, required/optional
  bodies, omitted/null/unknown fields and malformed values.
- Ruff and strict focal mypy pass for all changed Python files.
- Backend source guardrails pass with the committed allowlist pruned.
