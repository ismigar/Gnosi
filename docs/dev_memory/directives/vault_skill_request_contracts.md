# DIRECTIVE: VAULT_SKILL_REQUEST_CONTRACTS

> ID: 2026-09-03-vault-skill-request-contracts
> Associated Code: `backend/domains/vault/translation/routes.py`, `backend/domains/vault/citations/lookup_routes.py`
> Associated Tests: `backend/tests/test_vault_skill_request_contracts.py`
> Last Update: 2026-09-03
> Status: ACTIVE

---

## 1. Objective and Scope

- Replace the free-form request bodies of the eight public
  `/api/vault/skills/*` routes and `/api/vault/translate-url` with named
  Pydantic contracts.
- Preserve the complete 2.x runtime boundary: accepted JSON objects, raw field
  values, unknown extensions, defaults, status codes and error details.
- Do not modify adjacent Vault domains or regenerate repository OpenAPI and
  TypeScript client artifacts in this isolated change.

## 2. Contract

- Each request root remains a JSON object; arrays, scalars and null continue to
  fail FastAPI validation with HTTP 422.
- Every key read by a selected route is declared explicitly and visible in its
  named OpenAPI schema.
- Known values remain uncoerced JSON values until the existing route or domain
  service performs its historical validation and conversion.
- Unknown keys are accepted and forwarded so legacy and future clients retain
  their extension boundary.
- Omitted fields remain omitted and explicit null remains explicit null when a
  request is converted back to the mapping consumed by existing logic.

## 3. Implementation Rules

1. Put the reusable request-model boundary beside the translation routes and
   use one specific subclass for every selected operation.
2. Use Pydantic `SkipValidation` around documented JSON shapes so malformed
   legacy values reach the existing handlers unchanged instead of becoming
   HTTP 422 responses.
3. Reconstruct payload mappings by iterating the validated model, preserving
   known and extra fields without serializer coercion or synthesized defaults.
4. Keep domain service signatures compatible with direct mapping callers.
5. Give `/translate-url` its own named request model while preserving the web
   capture service and all transport behavior.

## 4. Restrictions and Edge Cases

- Do not narrow identifiers, language arrays, booleans, action configuration,
  Drupal matching data, prompts, fields or URLs at the HTTP boundary.
- Do not add guards, normalization or new exceptions to improve malformed-input
  behavior; representative malformed values must retain their 2.x result.
- Do not discard unknown properties even when a current handler ignores them.
- Do not generate or modify `backend/openapi.json`, generated frontend files or
  lockfiles.
- Do not invoke real Drupal, translation, AI or network providers in tests; use
  isolated dependency substitutions.

## 5. Verification

- Focused tests prove every route owns a distinct named Pydantic body model,
  every known property appears in the schema and no selected body remains a
  free-form object.
- Focused behavior tests prove exact payload forwarding, omissions, nulls,
  unknown fields, defaults and representative malformed values.
- Ruff check/format, strict focal mypy, focused pytest and both repository
  guardrails pass.

## 6. Error Protocol and Learning

- On any discrepancy, diagnose the original 2.x behavior, repair the request
  boundary and record the cause and safe pattern here before rerunning checks.
- Note: do not use `model_dump()` at a compatibility boundary when values use
  `SkipValidation`, because serialization can warn or normalize values that the
  old handler received raw. Iterate the model into a new mapping instead.
- Note: do not inherit the existing citation request payload reconstruction
  unchanged for `/translate-url`, because it synthesizes omitted known fields
  with their `None` default. Override this request's reconstruction using
  `model_fields_set` so omission and explicit null remain distinguishable,
  without broadening this isolated change to the other citation routes.
- Note: the outer citation composition regression launches a complete inner
  suite with a fixed 90-second timeout. On a loaded development host the inner
  checks can visibly progress yet exceed that wrapper limit. Do not interpret
  this as a contract failure; run the inner suite directly in both import
  orders with its isolated environment and require both executions to finish
  green.
- Integration note: another branch also edits
  `backend/domains/vault/citations/lookup_routes.py`. Preserve these three exact
  semantic hunks when resolving it: import `UrlTranslationRequest` from
  `citations.request_contracts`; annotate the `translate_url` body as
  `UrlTranslationRequest`; and call
  `citation_web_capture.capture_url(request_payload(payload), dependencies)`.
  These hunks are independent of response-schema work and all three are needed
  to keep the named request contract plus the historical mapping boundary.
- Integration note: preserve the paired expectation update in
  `backend/tests/test_vault_citation_lookup_typed_composition.py`: import
  `UrlTranslationRequest` and add `"/translate-url": UrlTranslationRequest`
  to `request_models`. Without these two lines the old composition test rejects
  the intentionally changed request body before it can compare all remaining
  OpenAPI and response contracts unchanged.
- Note: do not assume a focused `test_agent_translation_tools.py` suite exists;
  it does not. Validate those direct callers through strict mypy (which follows
  `backend/agent/translation_tools.py`) and the translation route/domain suites,
  after first resolving actual test paths with the repository inventory.
- Note: when a route intentionally moves from a free-form body to a named
  request model, the historical OpenAPI parity test must exclude that request
  body from byte-for-byte baseline comparison after independently asserting
  the exact model reference. Leaving the route out of `request_models` makes
  the correct schema change look like a regression.
- Note: strict-checking the touched legacy composition suite also exposes old
  direct-call and imported-alias annotations that its runtime-only subprocess
  previously hid. Use the public request model, import the response owner, type
  the request-model registry explicitly and retain object-key metadata at its
  declared boundary; these are annotation repairs only and do not change the
  exercised behavior.
