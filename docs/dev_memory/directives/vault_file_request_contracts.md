# DIRECTIVE: VAULT FILE REQUEST CONTRACTS

> ID: 2026-09-03-vault-file-request-contracts
> Associated Tests: `backend/tests/test_vault_file_request_contracts.py`
> Last Update: 2026-09-03
> Status: ACTIVE

---

## 1. Objectives and Scope

- Replace the free-form request bodies of `/api/vault/local-file/register`,
  `/api/vault/link-existing-file` and `/api/vault/delete-physical-file` with
  named Pydantic models.
- Preserve the final 2.x runtime contract exactly, including endpoint-owned
  string conversion, whitespace handling, errors and unknown properties.
- Do not alter adjacent file routes, response contracts or generated artifacts.

## 2. Input/Output Specifications

- Local registration declares `file_path`.
- Existing-file linking declares `file_path` and `target_name`.
- Physical deletion declares `target`.
- Every declared value remains raw until the existing service handles it.
- Unknown object properties remain present at the service boundary.

## 3. Logical Flow

1. FastAPI validates only that the JSON root is an object.
2. Pydantic records known fields without coercing or rejecting malformed values.
3. Pydantic retains unknown fields for forward and legacy compatibility.
4. The route reconstructs a plain mapping without serialization-time coercion.
5. Existing services perform all historical conversions and raise the same HTTP
   errors as before.

## 4. Restrictions and Edge Cases

- Do not type known values narrowly at the HTTP boundary: 2.x accepted JSON
  scalars, arrays and objects and converted them with `str(...)` in the service.
- Do not discard or forbid unknown fields.
- Preserve the distinction between omitted fields and explicit `null`, even
  though the current services treat both through their historical defaults.
- Do not call `model_dump()` for this compatibility handoff when malformed raw
  values are intentionally accepted; iterate the model into a plain mapping so
  Pydantic does not serialize or warn about values it was asked to skip.
- Do not generate the global OpenAPI document or TypeScript client.

## 5. Error Protocol and Learning

- If a focused compatibility test differs from 2.x, repair the boundary and
  update this directive before rerunning verification.
- Note: explicit Pydantic models are documentation boundaries, not permission to
  normalize legacy payloads. Keep conversion in the existing domain service.
- Note: do not use `pytest.mark.asyncio`; the repository fails closed on unknown
  markers and does not register it. Execute focused coroutine handlers with
  `asyncio.run(...)`, matching the established backend test pattern.
- Note: invoking the guardrail script by absolute virtual-environment Python is
  insufficient when that environment's `bin` directory is absent from `PATH`;
  its Ruff subprocess then reports Ruff as unavailable. Prefix `PATH` with the
  canonical virtual-environment `bin` directory before running the guardrail.

## 6. Verification

- Focused pytest proves route ownership, named OpenAPI schemas, exact handoff of
  known/unknown/malformed values and unchanged representative HTTP errors.
- Ruff, strict focal mypy and backend source guardrails pass.
