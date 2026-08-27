# SKILL: Python module refactor

> ID: GNOSI-PYTHON-MODULE-REFACTOR-20260827
> Status: ACTIVE

## Purpose

Split large Python modules safely by first producing a deterministic top-level
symbol dependency graph and then replacing selected top-level functions with
AST-validated compatibility adapters. The tools support mechanical movement;
they do not decide domain ownership or change runtime contracts.

## Tools

- `scripts/analyze_symbol_graph.py` reads one Python module and writes a JSON
  graph in `gnosi-python-symbol-graph-v1` format.
- `scripts/replace_top_level_function.py` replaces exactly one named top-level
  sync or async function, including all its decorators.

Both tools require explicit source and output or replacement paths. Generated
reports and temporary replacement snippets belong under `.tmp/` and must not be
committed.

## Commands

Run from the Gnosi repository root:

```bash
uv run python pipeline/skills/python_module_refactor/scripts/analyze_symbol_graph.py \
  backend/api/vault_routes.py --output .tmp/vault-symbol-graph.json

uv run python pipeline/skills/python_module_refactor/scripts/replace_top_level_function.py \
  backend/api/vault_routes.py save_page .tmp/save-page-wrapper.py
```

## Procedure

1. Parse the original source successfully and create the symbol graph.
2. Validate the report format and inspect `symbols`, dependency edges, route
   decorators, and cyclic components before choosing a boundary.
3. Move state behind a single explicit owner and inject narrow ports for legacy
   collaborators before moving handlers.
4. Prepare a replacement file that defines exactly the original function name.
5. Run the replacer. It validates both the replacement and final module with
   Python's AST before writing.
6. Run the tool a second time when useful; an identical replacement must be a
   no-op.
7. Validate Ruff, strict mypy, focused tests, source guardrails, and the exact
   OpenAPI artifact. Mechanical equivalence is not sufficient without runtime
   contract tests.

## Restrictions and edge cases

- The graph contains top-level definitions only. Dynamic imports, attribute
  calls, closures, runtime registration, and cross-module dependencies need
  separate inspection.
- The report key is `symbols`, not `components`. Cycles are reported only in
  `cyclic_components`; an empty list is valid.
- The replacement must contain exactly one top-level function with the requested
  name. Helper definitions belong in their destination module.
- Decorators are part of the replacement extent. Preserve their order because
  repeated FastAPI decorators are applied bottom-up and can affect route order.
- Never infer safety from `__globals__` identity tests. Verify public exports,
  route registrations, signatures, callbacks, and observable behavior instead.
- Preserve lazy callback resolution when tests or integrations monkeypatch a
  legacy facade symbol after import.
- Pydantic response annotations and docstrings can change OpenAPI. Compare the
  complete generated artifact, not only route counts.
- Do not move mutable module state by copying aliases. Introduce one canonical
  owner and keep compatibility accessors thin.
- Keep cleanup recoverable. Remove temporary worktrees and files only after all
  reports and contract tests pass.

## Verification

- `uv run ruff check pipeline/skills/python_module_refactor`
- `uv run mypy --strict pipeline/skills/python_module_refactor/scripts`
- `uv run pytest -q pipeline/skills/python_module_refactor/tests`
- Run the project-specific tests, architecture guardrails, and deterministic
  OpenAPI comparison documented by the active refactor directive.
