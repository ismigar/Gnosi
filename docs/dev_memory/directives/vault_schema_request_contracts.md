# DIRECTIVE: VAULT_SCHEMA_REQUEST_CONTRACTS

> ID: 2026-09-03-vault-schema-request-contracts
> Associated Code: `backend/domains/vault/`
> Last Update: 2026-09-03
> Status: ACTIVE

---

## 1. Objectives and Scope

- Replace the free-form JSON request bodies of the vault metadata, option-catalog,
  reference-table and folder-schema endpoints with named Pydantic models.
- Preserve the exact observable Gnosi 2.x behavior for accepted bodies, omitted
  fields, explicit nulls, unknown fields and malformed field values.
- Add focused request, handler and OpenAPI contract tests without regenerating the
  committed global OpenAPI document or TypeScript client.

## 2. Logical Flow

1. Recover each route's historical field-by-field reads from the immutable 2.x
   implementation and current extracted service.
2. Define a model at the domain boundary using JSON-safe but deliberately loose
   field value types wherever 2.x deferred validation to handler code.
3. Convert the model back to the same dictionary shape the historical handler
   consumed, preserving whether a field was omitted and any supported extensions.
4. Assert the route references the named model in a focused FastAPI OpenAPI build.
5. Exercise valid, omitted, null, unknown and malformed payloads through the
   handler or TestClient and compare status/payload behavior with 2.x.

## 3. Restrictions and Edge Cases

- Do not narrow historically loose values merely to produce a prettier schema;
  doing so changes handler errors into new FastAPI 422 responses.
- Do not preserve unknown keys when the 2.x handler ignored them field by field.
- Do preserve unknown keys when the complete input document was written or passed
  onward unchanged as an extensible schema/catalog document.
- Do not use truthiness-based model defaults to erase the distinction between an
  omitted body, an explicit null body and an empty object unless 2.x erased that
  distinction first.
- Do not regenerate `openapi/openapi.json` or generated frontend clients in this
  isolated change.

## 4. Validation

- Ruff and formatting on all changed Python files.
- Strict mypy on the changed production modules and focused contract tests.
- Focused pytest contract and behavior suites.
- Backend guardrails, including request-model pruning checks.

## 5. Error Protocol and Learning

- If validation fails, record the exact cause and corrective rule here before
  changing production code, then rerun the complete focused matrix.
- Note: do not assume schema-module import lines from a sibling branch, because
  concurrent contract work may already have added shared Pydantic imports. Inspect
  the exact worktree first and patch against its current import set.
- Note: do not invoke `uv run` from an isolated macOS worktree when the shared uv
  cache contains sandbox-protected Git metadata; it fails before validation with
  `Operation not permitted`. Use the already provisioned canonical `.venv`
  executables directly, without synchronizing or creating another environment.
- Note: create the absolute `GNOSI_VALIDATION_ROOT` and its synthetic data, vault
  and host children before importing the backend; validation mode intentionally
  aborts at collection time when the probe root does not already exist.
- Note: do not share mypy's default cache across concurrent isolated worktrees;
  a focal strict run can remain silent for minutes under contention. Give each
  worker a private temporary cache directory and retain the same strict targets.
- Note: annotate heterogeneous request-model lookup tables as
  `dict[tuple[str, str], type[BaseModel]]`; otherwise strict mypy infers Pydantic's
  implementation metaclass and rejects it at a helper expecting model classes.
- Note: do not assume every compatibility caller enters through FastAPI. Legacy
  tests and internal adapters can invoke route functions directly with dictionaries;
  keep the public annotation as the named model, but accept the historical mapping
  at runtime before delegating so OpenAPI stays precise without breaking 2.x calls.
- Note: do not combine route-order ownership suites with modules that deliberately
  register the shared façade during import. Run those suites in isolated pytest
  processes, otherwise import order contaminates their inventory assertion.
- Note: the backend guardrail launches Ruff by executable name. When reusing the
  canonical runtime from an isolated worktree, prepend that `.venv/bin` directory
  to `PATH`; invoking the guardrail with Python alone reports Ruff unavailable.
- Note: do not place a dictionary fallback directly in a route parameter narrowed
  to `Model | None`; strict mypy correctly infers the fallback mapping with `Never`
  keys. Use a small `object` boundary that recognizes the named models and legacy
  mappings explicitly, preserving runtime compatibility without casts or ignores.
