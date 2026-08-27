# SKILL: Technical documentation

> ID: GNOSI-TECHNICAL-DOCUMENTATION-20260802
> Status: ACTIVE

## Purpose

Build and validate Gnosi's public engineering documentation from reviewed
Markdown and deterministic source catalogs. The result must let an engineer
trace product capabilities through frontend routes, backend operations,
configuration, relational models, tests, skills, and source files without importing the runtime or
reading local secrets.

## Sources and outputs

- Reviewed portal: `docs/engineering/`.
- Generated reference: `docs/engineering/generated/`.
- Domain coverage configuration: `domains.json`.
- Generator: `scripts/generate.py`.
- Validator: `scripts/validate.py`.
- Functional change gate: `scripts/check_change_impact.py`.
- Portal configuration: `mkdocs.yml` at the application root.
- Development rules and incident memory live in the private `WorkspaceTools`
  repository and are intentionally absent from public checkouts.

Generated pages are committed so documentation changes can be reviewed as
ordinary diffs. They must never be edited manually.

## Commands

Run from the `Gnosi/` repository root:

```bash
uv run --group docs python pipeline/skills/technical_documentation/scripts/pre_pr.py --base-ref origin/main
uv run --group docs python pipeline/skills/technical_documentation/scripts/generate.py
uv run --group docs python pipeline/skills/technical_documentation/scripts/generate.py --check
uv run --group docs python pipeline/skills/technical_documentation/scripts/validate.py
uv run --group docs python pipeline/skills/technical_documentation/scripts/check_change_impact.py --base-ref <base-commit>
uv run --group docs mkdocs build --strict
```

The generator accepts `--app-root` and `--domains` only for isolated tests and
development. Normal runs auto-detect the application root from the script
location.

The pre-PR command is the mandatory local entry point for implementation
branches covered by the private documentation workflow. It regenerates catalogs
before checking them, runs the documentation-tool tests and change-impact gate,
validates localization and traceability, and builds every strict locale portal.
Use `--check-only` in read-only automation that must reject stale catalogs
without updating them.

## Generation rules

1. Inspect source only; never import `backend.server` or another runtime module.
2. Use Python AST for routers, functions, docstrings, and environment access.
3. Treat frontend route, export, and API-string discovery as conservative
   static signals rather than a complete call graph.
4. Exclude dependencies, vendored code, local data, databases, caches, reports,
   and build output.
5. Redact every default associated with a secret-bearing environment name.
6. Sort all inputs and output rows so two unchanged runs are byte-identical.
7. Keep domain classification explicit in `domains.json`; do not infer product
   intent from file names in generated prose.

## Adding or changing a domain

1. Add or update its reviewed guide under `docs/engineering/domains/`.
2. Update its `domains.json` entry with owned source patterns, test patterns,
   and relevant directives.
3. Regenerate the catalogs.
4. Confirm that the coverage page reports `covered` and that every pattern is
   accurate.
5. Run validation and the strict MkDocs build.

The change-impact gate is intentionally limited to high-impact boundaries:
backend APIs and services, integrations, desktop and native runtime code,
deployment files, and frontend authentication, routing, providers, or
application-shell code. Routine frontend component, page, styling, and test
changes do not require a prose documentation edit when the existing contract
remains accurate. High-impact changes must still change at least one public
English engineering Markdown page; the locale mirror check then requires
Catalan, Spanish, and French parity before the pull request can merge.

Dependency-only changes to supported manifests or lockfiles are exempt from the
change-impact gate because they do not by themselves change the documented
product contract. A dependency update combined with implementation changes still
requires documentation evidence.

## Restrictions and edge cases

- Static routes with dynamically computed path strings are labeled
  `<dynamic-path>` and require runtime OpenAPI review.
- Decorator and router dependency lists are reported as source expressions;
  middleware and dependencies introduced inside service functions are not
  inferred.
- Literal frontend `/api/` strings are a lower bound because helpers often
  construct paths dynamically.
- Test signal counts help navigation; only pytest, Vitest, and Playwright
  collection determine executable test totals.
- Environment names may appear in tests or legacy tools. Presence in the
  catalog does not make a variable a supported public configuration contract.
- The generator must not read `.env`, `.env_shared`, Keychain, SQLite, vault,
  or log contents.
- Public source links target the canonical `ismigar/Gnosi` repository root;
  local source paths remain in page metadata for validation.

## Verification

- Run the pre-PR command before the final implementation commit and again after
  staging the generated output; the second run must create no further diff.
- Run the generator twice and compare the tree; the second run must be clean.
- Run `generate.py --check`.
- Run `validate.py`.
- Build MkDocs with strict warnings.
- Open the built site and verify navigation, tables, code blocks, and Mermaid
  diagrams.
- Run the application frontend build because documentation tooling must not
  disturb the shipped dependency graph.
