# DIRECTIVE: VAULT_CITATION_REQUEST_CONTRACTS

> ID: 2026-09-03-vault-citation-request-contracts
> Associated Tests: `backend/tests/test_vault_citation_request_contracts.py`
> Last Update: 2026-09-03
> Status: ACTIVE

---

## 1. Objectives and Scope

- Replace the free-form OpenAPI request bodies for the five public citation and
  metadata operations with named Pydantic models.
- Preserve the final 2.x runtime contract exactly: defaults, string conversion,
  malformed-field errors, unknown-field tolerance, status codes and payloads.
- Limit changes to `/format-bibliography`, `/format-citations`,
  `/generate-citation-key`, `/lookup-metadata` and `/promote-zotero-extra`.

## 2. Input/Output Specifications

- Formatting requests declare `keys`, `style` and `locale`.
- Citation-key requests declare `authors`, `year` and `title`.
- Metadata lookup requests declare `doi`, `isbn`, `arxiv`, `pmid` and `url`.
- Zotero-extra promotion requests declare `table_id`, `zotero_field`,
  `column_name`, `column_type`, `page_ids` and `expected_etags`.
- All fields remain optional and retain their raw JSON value until the existing
  domain logic handles them.

## 3. Logical Flow

1. Parse a JSON object into the route-specific Pydantic model.
2. Preserve unknown properties for 2.x forward compatibility.
3. Convert the model back to a mapping without normalizing field values.
4. Run the existing endpoint logic unchanged.
5. Verify each request body references a named schema and that no selected
   schema exposes an unrestricted object root.

## 4. Restrictions and Edge Cases

- Do not narrow raw fields to `str`, `list[str]` or `dict[str, str]` at the HTTP
  boundary: 2.x performed conversions and raised errors inside the endpoint.
- Do not forbid or discard unknown properties; old clients could send them and
  downstream-compatible extensions may depend on preserving them.
- Do not alter response models or generate the global OpenAPI/client artifacts.
- `keys` must still yield the endpoint's exact HTTP 400 when it is present and
  is not a list; Pydantic must not turn that case into HTTP 422.
- Missing fields and explicit null retain the same truthiness-based defaults as
  2.x.

## 5. Error Protocol and Learning

- On any compatibility mismatch, fix both the model boundary and this directive
  before rerunning the focused tests.
- Note: do not use narrow Pydantic field types merely to improve documentation,
  because that changes accepted 2.x inputs and moves endpoint errors to HTTP
  422. Instead, declare every known field explicitly as `object` and document
  its intended shape in descriptions and examples.
- Note: do not invoke `uv run` from an isolated worktree when its shared cache
  contains protected Git metadata, because uv aborts before running the tool
  with `Operation not permitted`. Instead, invoke Ruff, mypy and pytest from the
  already provisioned canonical virtual environment while keeping the working
  directory and every write inside this worktree.
- Note: do not remove a shared FastAPI `Body` import after converting only the
  selected routes, because adjacent legacy routes in the same module may still
  need it. Instead, verify all references before narrowing imports.
- Note: do not place a local test import by matching a repeated neighboring
  import shared by multiple fixtures, because it can land in the wrong scope.
  Instead, anchor the edit to the exact test function that consumes the symbol.
- Note: `SkipValidation` deliberately permits malformed legacy values, but the
  Pydantic serializer warns when such a value differs from the documentation
  schema. Iterate the model into a `dict[str, object]` at this compatibility
  boundary instead of serializing it; the existing endpoint remains responsible
  for the historical error.
- Note: a multi-file strict mypy invocation using the shared default cache can
  stall during thread shutdown without emitting diagnostics. Use an isolated
  cache under `/private/tmp` and validate focal files separately. Do not use
  `--follow-imports=skip`, because that erases Pydantic/FastAPI types and emits
  false `Any` diagnostics.
- Note: FastAPI on Pydantic v2 exposes a body parameter's declared model through
  `field_info.annotation`; the old `ModelField.type_` attribute is absent. Use
  the current annotation when asserting route ownership in focused tests.
- Note: keep multi-file `apply_patch` sections structurally separate; an
  incomplete hunk followed by another file marker is rejected before changing
  any file. Reapply as complete, independently anchored hunks.

## 6. Verification

- Focused pytest covers route bindings, OpenAPI request schemas, valid payloads,
  defaults, unknown fields and representative malformed values.
- Ruff passes for every changed Python file.
- Strict mypy passes for the changed production and test modules.
