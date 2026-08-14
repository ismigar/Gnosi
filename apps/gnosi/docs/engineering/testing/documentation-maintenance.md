---
status: implemented
last_verified: 2026-08-09
source_paths:
  - pipeline/skills/technical_documentation/SKILL.md
  - pipeline/skills/technical_documentation/domains.json
  - pipeline/skills/technical_documentation/scripts/check_change_impact.py
  - pipeline/skills/technical_documentation/scripts/generate.py
  - mkdocs.yml
tests:
  - pipeline/skills/technical_documentation/tests
---

# Documentation maintenance

## Reviewed versus generated content

Reviewed pages explain intent, boundaries, flows, invariants, failure behavior,
security, operations, and verification. Generated pages enumerate facts that
can be extracted reliably: modules, route decorators, environment references,
frontend routes, exports, tests, and runtime skill packages.

Do not put architectural claims into the generator based only on names. Do not
manually duplicate a 400-operation API table in a reviewed guide.

## Standard workflow

From `monorepo/apps/gnosi/`:

```bash
python pipeline/skills/technical_documentation/scripts/generate.py
python pipeline/skills/technical_documentation/scripts/generate.py --check
python pipeline/skills/technical_documentation/scripts/validate.py
mkdocs build --strict
```

Then serve or open `site/engineering`, navigate the changed pages, inspect
tables and diagrams, and verify the browser console.

## Public access

The canonical portal is published at
`https://gnosi.temenosismael.org/engineering/`. The private monorepo exports
`monorepo/` to the root of the public `ismigar/Gnosi` repository. That makes
`monorepo/.github/workflows/documentation-pages.yml` the source of the public
`.github/workflows/documentation-pages.yml` deployment workflow.

On each relevant push to the public `main` branch, the workflow verifies the
generated catalogs, validates traceability, builds MkDocs in strict mode, and
publishes the complete `apps/gnosi/site/` tree through GitHub Pages. Publishing
the parent `site/` directory preserves the `/engineering/` URL segment.

Gnosi's global sidebar links to the same canonical address. The label is
localized in Catalan, English, Spanish, and French and the portal opens outside
the application route tree.

## Page metadata

Every reviewed Markdown page declares:

```yaml
status: implemented
last_verified: YYYY-MM-DD
source_paths:
  - backend/path/to/source.py
tests:
  - backend/tests/test_behavior.py
```

Allowed statuses are `implemented`, `partial`, `experimental`, `planned`, and
`deprecated`. A page marked `implemented` must describe current behavior. A
planned design must not appear under an implemented heading.

## Domain coverage

`domains.json` is the curated responsibility map. Each entry links one domain
guide to source globs, test globs, and relevant private directives. Generated
coverage reports `covered` only when the reviewed guide and source matches
exist. Zero tests are visible and require a deliberate testing decision.

## What requires an update

- A new or removed route, browser page, model, configuration name, or runtime
  skill: regenerate catalogs.
- A changed invariant, trust boundary, lifecycle, or storage owner: update the
  reviewed architecture/domain guide.
- A new provider or deployment dependency: update domain and operations pages.
- A new failure or recovery constraint: update the directive first, then
  promote stable knowledge to the portal.
- A durable architectural decision: add an ADR.

## CI impact gate

The pull-request documentation gate is scoped to changes that can alter a
system boundary or an operational contract. It covers backend APIs and
services, integrations, desktop and native runtime code, deployment files, and
frontend authentication, routing, providers, and application-shell code.

Routine frontend component, page, styling, and test changes do not require a
prose documentation edit when the existing contract remains accurate. They
still require documentation when they change an invariant, trust boundary,
lifecycle, storage owner, failure constraint, or other durable system fact.

## Anti-drift validation

The validator checks generated notices, metadata, source/test paths, internal
links, required domain guides, local absolute paths, and obvious secret
material. `generate.py --check` independently compares committed output to the
current tree. MkDocs strict mode validates navigation and documentation links.

These controls cannot prove prose semantics. Reviewers must compare claims with
the linked source and tests.
