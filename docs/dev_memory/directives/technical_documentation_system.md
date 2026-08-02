# Directive: Technical Documentation System

> Status: ACTIVE
> Last verified: 2026-08-02

## Objective

Maintain a versioned engineering documentation portal that lets a software
engineer move from Gnosi's product purpose to the implementation details of a
specific route, module, data flow, configuration value, test, or operational
constraint.

The portal must combine reviewed explanatory documentation with deterministic
reference pages generated from source code. It must not present plans,
historical directives, or inferred behavior as current implementation without
verification against code and tests.

## Sources of truth

Use evidence in this order:

1. Executable source code and runtime schemas.
2. Tests that prove observable behavior.
3. Current configuration and deployment definitions.
4. Active directives that explain decisions, restrictions, and incidents.
5. Git history for chronology and motivation only.

When sources disagree, document the executable behavior, record the
discrepancy, and update or retire the stale source. Never silently merge
contradictory claims.

## Canonical locations

- Engineering portal: `monorepo/apps/gnosi/docs/engineering/`.
- Portal configuration: `monorepo/apps/gnosi/mkdocs.yml`.
- Mature generator: `monorepo/apps/gnosi/pipeline/skills/technical_documentation/`.
- Generator development: `monorepo/apps/gnosi/pipeline/sandbox/`.
- Historical and operational memory: `docs/dev_memory/directives/`.

Documentation under the application tree is public, written in English, and
exported with the authoritative `monorepo/apps/gnosi/` application. Directives
remain evidence and implementation memory; they are not copied into the public
portal automatically.

## Publication and access contract

The canonical public URL is `https://gnosi.temenosismael.org/engineering/`, using
the custom domain configured for the public `ismigar/Gnosi` GitHub Pages site.
`scripts/sync_repos.py` exports `monorepo/` to the root of `ismigar/Gnosi`, so
the Pages workflow belongs at
`monorepo/.github/workflows/documentation-pages.yml`. In the public repository
it becomes `.github/workflows/documentation-pages.yml` and builds the MkDocs
project from `apps/gnosi/`.

The workflow publishes `apps/gnosi/site/`, not only
`apps/gnosi/site/engineering/`, so the repository Pages base path retains the
documented `/engineering/` suffix. GitHub Pages uses GitHub Actions as its
publishing source and deploys only from the public repository's `main` branch.

Gnosi exposes the same canonical URL from the global sidebar. The link opens in
the system browser or a new browser tab, remains available in native, Docker,
and Electron distributions, and uses localized labels from all four frontend
catalogs. It never points to a development-only localhost address.

## Information architecture

The portal uses progressive disclosure:

1. Product purpose, scope, terminology, and design principles.
2. System context, runtime processes, storage, trust boundaries, and deployment.
3. Domain guides for each product capability.
4. Cross-cutting guides for security, configuration, observability, and testing.
5. Generated reference catalogs with direct source links.
6. Architecture Decision Records for durable decisions and their consequences.

Each domain guide must cover purpose, responsibilities, non-goals, actors,
dependencies, end-to-end flows, data contracts, invariants, failure behavior,
security, configuration, tests, operations, known limitations, and source
locations.

## Generation contract

The generator must:

- Use only deterministic, local, read-only source inspection.
- Avoid importing Gnosi runtime modules because imports can initialize
  databases, load secrets, start integrations, or depend on host state.
- Parse Python with the standard-library AST whenever possible.
- Scan frontend source conservatively and label heuristic findings as such.
- Exclude virtual environments, dependencies, vendored code, build output,
  caches, local data, generated reports, and secrets.
- Emit stable ordering and repository-relative POSIX paths.
- Write generated pages only below `docs/engineering/generated/`.
- Include a generated-file notice and the command that reproduces the page.
- Never include secret values or the contents of `.env`, local databases, user
  vaults, OAuth stores, or logs.
- Support `--check`, which fails when committed generated pages differ from the
  current source tree.

The initial catalogs cover the repository inventory, FastAPI routes, backend
modules, frontend pages and components, configuration keys, tests, runtime
skills, and documentation coverage. Runtime OpenAPI remains the authoritative
schema for request and response bodies; the static API catalog exists to give
safe source-level traceability without starting the application.

## Traceability metadata

Reviewed pages should declare relevant source files, tests, directives, status,
and last verification date in YAML front matter. Use these implementation
statuses consistently:

- `implemented`: verified in current source and tests or runtime behavior.
- `partial`: present but known to be incomplete.
- `experimental`: implemented without a stable compatibility commitment.
- `planned`: design only; never describe it as shipped behavior.
- `deprecated`: still present only for compatibility or migration.

Generated catalogs derive status from source presence only and must not infer
product completeness.

## Documentation workflow

1. Read this directive and the relevant domain directives.
2. Change source and reviewed documentation in the same pull request.
3. Run the generator and commit its deterministic output.
4. Run generator check, documentation build, link checks, and the relevant
   application tests.
5. Review diagrams and navigation in the built portal.
6. Record new restrictions or incidents in the relevant directive and promote
   stable knowledge into the public domain guide.

## Restrictions and edge cases

- Do not treat Markdown file count as documentation coverage. Coverage requires
  a traceable relationship between a capability, its implementation, and tests.
- Do not publish absolute local paths. Public pages use repository-relative
  paths and source links.
- Do not generate prose that claims intent from identifier names alone.
- Do not expose environment values. Catalog names, defaults written in source,
  and consumers only; redact defaults whose names look secret-bearing.
- Do not import `backend.server` merely to obtain OpenAPI during static
  generation. Export runtime OpenAPI in an isolated integration test or from a
  running, explicitly configured development instance.
- Do not document vendored Zotero reader internals as Gnosi-owned code. Record
  only the integration boundary, pinned source, build procedure, and local
  modifications.
- Do not make every React component a prose page. Generate a component catalog
  and write reviewed guides for components that own behavior or architectural
  boundaries.
- Do not copy directives verbatim into public documentation. They may contain
  historical recovery detail, local paths, or incomplete proposals.
- Do not let Mermaid auto-start and then initialize it again. Double processing
  removes or corrupts rendered diagrams. Disable `startOnLoad`, convert the
  MkDocs `pre.mermaid` wrapper to a plain text container, and run Mermaid once
  for each unprocessed diagram.
- In an isolated worktree, do not link only `frontend/node_modules` before the
  required application build. npm workspaces resolve hoisted tools such as
  Vite from `monorepo/node_modules`; install or link dependencies at that root.
- Do not add or move the documentation generator skill without updating
  `pipeline/skills/catalog.yaml`. Every `pipeline/skills/*/SKILL.md` directory
  requires an explicit non-runtime classification; use `kind: developer` for
  this documentation procedure.
- Do not place the public Pages workflow only under the private repository's
  root `.github/workflows/`; that path is not exported to `ismigar/Gnosi`.
  Store public-repository workflows under `monorepo/.github/workflows/`.
- Do not let changes to the exported Pages workflow bypass private-repository
  documentation CI. Include its source path in the root documentation
  workflow's pull-request path filters.
- Do not count `__pycache__`, bytecode, dependency, vendor, or build artifacts
  matched by broad domain globs. Local caches make coverage output differ from
  a clean CI checkout; apply the owned-file filter before counting matches.
- Do not publish only `site/engineering/` while the configured canonical URL
  ends in `/engineering/`; doing so moves the portal to the repository root and
  makes the in-app link and canonical metadata disagree.
- A missing doc-tool dependency is a failed documentation build, not permission
  to skip verification.

## Verification

The documentation system is ready when:

- The generator produces byte-identical output on consecutive runs.
- `generate.py --check` succeeds on a clean generated tree.
- The documentation site builds with strict warnings enabled.
- All internal Markdown links and declared source paths resolve.
- The generated catalog contains every registered FastAPI router and every
  discovered route operation.
- No generated output contains known secret-bearing file contents or absolute
  developer paths.
- The portal navigation reaches every reviewed and generated page.
- A browser smoke test confirms that the built portal renders its home page,
  navigation, tables, code blocks, and Mermaid diagrams.
- The public Pages workflow builds from the synchronized repository layout and
  uploads an artifact whose root contains the `engineering/` directory.
- The Gnosi sidebar exposes the canonical URL with correct labels in Catalan,
  English, Spanish, and French.

## Related files

- `AGENTS.md`
- `docs/dev_memory/directives/_protocol_directives.md`
- `docs/dev_memory/directives/environment_integrity.md`
- `docs/dev_memory/directives/qa_protocol.md`
- `docs/dev_memory/directives/english_code_documentation.md`
- `monorepo/apps/gnosi/ARCHITECTURE.md`
- `monorepo/apps/gnosi/CONTRIBUTING.md`
