# Directive: backend system strict typing

> ID: 2026-09-04-backend-system-strict-typing
> Status: ACTIVE

## Objective and scope

- Remove explicit `Any` from one coherent internal system boundary under
  `backend/api` and `backend/services`.
- Start with filesystem/system HTTP routes and include the data-directory
  migration journal only when its complete contract can be represented without
  casts or suppressions.
- Exclude `llm_wiki`, agent, Notion, literature and notebooks, which have
  separate owners.

## Contract rules

- Preserve every route, payload, status code, exception and filesystem effect.
- Represent forward-compatible JSON objects as `dict[str, object]`; narrow a
  value before indexing or invoking mapping/list operations.
- Prefer existing Pydantic response models at HTTP boundaries and explicit
  protocols or typed records for internal collaborators.
- Do not add `cast`, `# type: ignore`, `# noqa` or configuration exclusions.
- Do not normalize, copy or validate previously accepted runtime data merely to
  satisfy the type checker.

## Verification

- Confirm the selected production files contain no explicit `Any`, casts or new
  suppressions.
- Run focused tests for every selected owner.
- Run Ruff check and format check on changed Python files.
- Run strict mypy on changed production files and typed tests.
- Run relevant API/OpenAPI and backend source guardrails.
- Commit this batch separately and report before/after counts.

## Restrictions and lessons

- A Pydantic response model does not justify annotating a handler as that model
  when the handler deliberately returns a dictionary for FastAPI serialization.
  Use an honest open object return type unless the implementation constructs the
  model itself.
- Do not replace object identity or legacy exceptions with a copied mapping or
  eager recursive validation.
- Note: do not send an un-narrowed `object` from `json.loads` to `enumerate`,
  indexing or numeric conversion. Narrow the cache root, rows and scalar fields
  at the persistence boundary; malformed caches already follow the existing
  unreadable-cache fallback, while valid cache values retain their wire shape.
- Note: a fresh private mypy cache can spend several minutes following the full
  backend import graph on a saturated development machine without emitting a
  diagnostic. Interrupt only after confirming the process remains silent and
  repeat the identical strict invocation with the repository's warm cache; do
  not weaken import following or strictness.
- Note: do not run the 81,000-entry event-loop responsiveness test alongside
  OpenAPI generation or other CPU-heavy checks on a saturated Mac. Resource
  contention inflated its 95th-percentile scheduler gap from the 30 ms limit to
  61 ms while the remaining 31 focused tests passed. Re-run that exact test in
  isolation and keep the production scheduling thresholds unchanged.
