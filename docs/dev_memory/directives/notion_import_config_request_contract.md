# DIRECTIVE: NOTION_IMPORT_CONFIG_REQUEST_CONTRACT

> ID: 2026-09-03-notion-import-config-request-contract
> Associated Code: `backend/api/notion_routes.py`
> Last Update: 2026-09-03
> Status: ACTIVE

---

## 1. Objective and Scope

- Replace the anonymous mapping request body of `PUT /api/notion/import-config`
  with a named Pydantic contract.
- Preserve the complete 2.x wire contract: every JSON object accepted before the
  change must still be accepted and persisted byte-for-value after JSON parsing.
- Keep the known import-panel properties visible to OpenAPI while allowing
  unknown future and legacy properties.

## 2. Contract

- The request root must remain a JSON object. Arrays, scalars and null continue
  to fail FastAPI validation with HTTP 422.
- The known keys are `databases`, `selected`, `schemaOverrides`, `loosePages`,
  `loosePageTypes`, `looseSelected`, `cloneVaultId` and `newVaultName`.
- Values of known and unknown keys remain arbitrary JSON values. The 2.x route
  did not validate field contents, so stricter field types would be a breaking
  change even when the current frontend sends a narrower shape.
- Omitted fields remain omitted. Explicit nulls remain explicit nulls.
- Unknown keys and nested JSON must survive validation and persistence exactly.
- The route keeps last-write-wins replacement, locking, path creation, response,
  authorization and error behavior unchanged.

## 3. Implementation Rules

1. Use a named `BaseModel` with `extra="allow"` and an explicitly typed extra
   mapping so future JSON keys remain supported.
2. Type every value through a recursive JSON-value alias; do not use `Any` or
   silently coerce the legacy payload into the frontend's preferred shape.
3. Dump with `exclude_unset=True` before persistence so absent optional fields
   are not synthesized as null.
4. Do not regenerate the repository OpenAPI artifact or TypeScript client in
   this isolated change.

## 4. Verification

- Contract tests prove named body-model registration and visible known fields.
- Round-trip tests cover the current frontend shape, future keys, malformed
  legacy values, explicit null and omission.
- Focused Ruff check/format, strict mypy and focused pytest must pass.

## 5. Restrictions and Lessons

- Note: Do not type known properties only according to today's frontend because
  that changes accepted 2.x payloads into 422 responses. Describe their intended
  meaning, but retain the arbitrary-JSON value boundary.
- Note: Do not call `model_dump()` without `exclude_unset=True`, because it adds
  missing optional keys with null values and changes the wholesale persisted
  payload. Instead, reconstruct exactly the fields supplied by the caller.
- Note: Do not inspect FastAPI's compatibility `ModelField.type_` in contract
  tests, because that Pydantic-v1 attribute is absent from the current adapter.
  Resolve the endpoint's public type hint instead.

## 6. Error Protocol and Learning

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 2026-09-03 | The first focused contract run failed with `ModelField` missing `type_` | The test used a Pydantic-v1 FastAPI implementation detail | Resolve the endpoint annotation with `typing.get_type_hints` and keep the assertion independent of internal field adapters |
| 2026-09-03 | Strict mypy found two test accesses to `notion_routes.notion_mcp` | The test relied on an imported compatibility alias that the route module does not publicly export | Import and patch the canonical `backend.services.notion_mcp` module directly; both names refer to the same module object at runtime |
