---
status: implemented
last_verified: 2026-08-02
source_paths:
  - pyproject.toml
  - uv.lock
  - mkdocs.yml
  - pipeline/skills/technical_documentation/SKILL.md
  - pipeline/skills/technical_documentation/scripts/generate.py
tests:
  - pipeline/skills/technical_documentation/tests
---

# ADR 0002: Reviewed documentation plus generated source reference

- Status: Accepted
- Decision date: 2026-08-02

## Context

Gnosi has hundreds of backend and frontend modules and extensive implementation
memory. A single manually maintained architecture file cannot enumerate the
current API, configuration, components, tests, and skills without drifting.
Fully generated prose would be exhaustive but unable to explain intent and
would risk converting names into false claims.

## Decision

Maintain one MkDocs engineering portal in the authoritative application tree.
Human-reviewed pages own purpose, architecture, domain behavior, security,
operations, and decisions. A deterministic standard-library generator owns
source catalogs. Generated pages are committed and checked in CI.

The generator performs static inspection and never imports the application or
reads local configuration/secrets.

## Consequences

- Engineers can navigate from intent to exact source and tests.
- Generated diffs reveal surface changes during review.
- Domain ownership remains curated in `domains.json`.
- Reviewers still verify prose semantics; automation checks traceability, not
  correctness of human explanations.
- Documentation dependencies use the optional `docs` group in `pyproject.toml`
  and the shared `uv.lock`, not a separate requirements file or environment.
  Catalog generation does not import the runtime ML stack.

## Rejected alternatives

- One monolithic handbook: poor navigation, review conflicts, and rapid drift.
- Docstrings alone: insufficient for cross-component flows and operational
  decisions.
- Runtime import of FastAPI for every docs build: side effects, host
  dependencies, secret loading, and database initialization.
- Uncommitted generated output: changes become invisible in code review.

## Verification impact

CI runs generator unit tests, stale-output check, portal validation, and strict
MkDocs build. Browser QA verifies the rendered portal and Mermaid diagrams.
