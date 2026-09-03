---
name: python-module-refactor
description: Analyze top-level Python symbol dependencies and perform explicitly selected, AST-validated extractions or function replacements. Use for mechanical refactors after domain boundaries and compatibility requirements are decided.
---

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
- `scripts/extract_top_level_symbols.py` moves explicitly named top-level
  functions, classes or simple assignments to a new module and inserts an
  explicit compatibility import at the first removed extent.

These tools require explicit source and output or replacement paths. Generated
reports and temporary replacement snippets belong under `.tmp/` and must not be
committed.

## Commands

Run from the Gnosi repository root:

```bash
uv run python pipeline/skills/python_module_refactor/scripts/analyze_symbol_graph.py \
  backend/api/vault_routes.py --output .tmp/vault-symbol-graph.json

uv run python pipeline/skills/python_module_refactor/scripts/replace_top_level_function.py \
  path/to/module.py selected_function .tmp/function-wrapper.py
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

For a multi-symbol extraction, prepare a destination preamble and source-import
snippet under `.tmp/`, then pass both files explicitly to
`extract_top_level_symbols.py`. Run it twice and require the second call to be a
no-op before deleting the temporary snippets.

## Restrictions and edge cases

- The graph contains top-level definitions only. Dynamic imports, attribute
  calls, closures, runtime registration, and cross-module dependencies need
  separate inspection.
- The report key is `symbols`, not `components`. Cycles are reported only in
  `cyclic_components`; an empty list is valid.
- The replacement must contain exactly one top-level function with the requested
  name. Helper definitions belong in their destination module.
- Multi-symbol extraction accepts only a new destination. A mixture of present
  and already-moved symbols is rejected as an unsafe partial state.
- Decorators are part of the replacement extent. Preserve their order because
  repeated FastAPI decorators are applied bottom-up and can affect route order.
- Never infer safety from `__globals__` identity tests. Verify public exports,
  route registrations, signatures, callbacks, and observable behavior instead.
- Preserve lazy callback resolution when tests or integrations monkeypatch a
  legacy facade symbol after import.
- Pydantic response annotations and docstrings can change OpenAPI. Compare the
  complete generated artifact, not only route counts.
- When extracting an existing Pydantic response model, preserve its class
  docstring verbatim. Pydantic publishes that text as the schema description,
  so omitting it creates contract drift even when every field is unchanged.
- Do not move mutable module state by copying aliases. Introduce one canonical
  owner and keep compatibility accessors thin.
- Keep cleanup recoverable. Remove temporary worktrees and files only after all
  reports and contract tests pass.
- In zsh validation wrappers, do not assign an exit code to `status`, because
  it is a read-only shell parameter and prevents the intended command from
  running. Use a task-specific name such as `test_exit` and propagate it only
  after printing the bounded log tail.
- In restricted worktrees, do not let `uv` fall back to the user-global cache,
  because even an offline check may inspect paths outside the permitted
  workspace. Set `UV_CACHE_DIR` to a worktree-local ignored directory together
  with `UV_NO_SYNC=1` and `UV_OFFLINE=1`.
- If the packaged `uv` runtime panics in macOS sandboxing while opening the
  System Configuration Dynamic Store, do not retry dependency resolution or
  enable network access. Reuse the repository's already-locked virtual
  environment executables directly and keep all validation offline.
- When replacing an untyped JSON route family with forward-compatible Pydantic
  responses, apply `response_model_exclude_unset=True` consistently to every
  route in the family. Do not rely on today's required fields for selected
  endpoints, because later optional compatibility fields must not appear as
  synthetic `null` keys.
- A successful `ruff check` does not prove formatting compliance. Run
  `ruff format --check` over the exact changed Python paths before wider gates,
  and format only those reviewed paths when it reports drift.
- Do not use `mypy --strict backend` as shorthand when `backend/tests` is inside
  that tree and the repository's production gate intentionally excludes legacy
  tests. Resolve and run the canonical production-source file set, then check
  any newly added typed contract tests explicitly; otherwise thousands of
  unrelated test annotations obscure the changed-source result.
- When a source guardrail invokes Ruff as a subprocess, selecting the locked
  virtual environment's Python executable is not enough. Prepend that virtual
  environment's `bin` directory to `PATH`; otherwise the guardrail reports that
  Ruff is unavailable even though direct Ruff checks pass.
- Do not invoke a pnpm workspace script from a fresh linked worktree before
  checking for its local `node_modules`. Pnpm may start a complete workspace
  install and attempt registry access. For deterministic generated-client work,
  execute the already-installed generator binary from the canonical checkout
  against the reviewed worktree's OpenAPI input and output paths.

## Verification

- `uv run ruff check pipeline/skills/python_module_refactor`
- `uv run mypy --strict pipeline/skills/python_module_refactor/scripts`
- `uv run pytest -q pipeline/skills/python_module_refactor/tests`
- Run the project-specific tests, architecture guardrails, and deterministic
  OpenAPI comparison documented by the active refactor directive.
