# Public pipeline

This directory contains reusable Gnosi tooling and compatibility adapters. It is
not a workspace manager, a private operations repository, or the application's
agent skill registry. `skills/catalog.yaml` classifies development and automation
packages; a package is not assignable to the application agent by default.

## Ownership

- `skills/` contains each public package's instructions and implementation.
- `scripts/` contains explicit developer/admin commands. Read the command's
  arguments and recovery requirements before using it against a vault.
- Shared application services remain in `backend/`. Public compatibility imports
  such as notifications, translation and host file opening remain available.
- The backend's scheduler owns application jobs. Historical development
  orchestrators are not an alternative scheduler.

Machine provisioning, private Drupal operations, personal vault migrations,
representative copies of real user data, backup jobs and maintainer runner checks
belong outside this public repository. Their reviewed historical versions were
preserved privately before removing their public copies. Existing Git history is
not rewritten by this cleanup. Archived tools are historical evidence, not
validated runnable tools after relocation.

## Publication checks

From the repository root, run `pnpm check:pipeline` after staging reviewed
changes. The check reads Git index names and modes, including force-added ignored
files; it does not open credentials, databases, or symlink targets. It rejects
known private packages, generated state, non-template environment files and links
to external code. An unstaged deletion still exists in the index and must fail.

Run `pnpm typecheck:pipeline` after staging as well. It checks every indexed Python
file, including tests and files inside ignored directories, with strict mypy and
no directory exclusions. It fails on missing sources or an empty source set.
Run `pnpm check:pipeline:structure` to enforce 800 lines per Python module and
cyclomatic complexity at most 15. This explicit source-reading mode uses the same
complete index, includes tests and force-added ignored files, rejects missing or
external sources and has no size allowlist. The default boundary command remains
metadata-only. Public CI runs all three checks; checking only the backend does
not cover these tools.

Obsolete parser/cache, Wiki/BD helpers, the personal full Notion importer and
standalone mail/calendar synchronizers were preserved privately before source
retirement. Current backend routes and public compatibility adapters remain.
The calendar and mail skill instructions identify the maintained entry points;
the source cleanup neither runs a sync nor removes existing vault content.

This is a source-boundary check, not a complete secret scanner or proof that every
remaining tool is portable. New tools still require consumer review, typed code,
tests, explicit configuration and a documented failure/recovery procedure.
Ignored scratch files never become publication inputs merely because they exist
locally. Use disposable synthetic data for tests; never execute a backup, sync,
publisher or migration as an incidental documentation-generation step.

## Configuration and documentation

Use process variables, then Gnosi's local `.env`, then an explicitly configured
`GNOSI_SHARED_ENV_FILE`. Do not discover shared files by walking parent folders.
Runtime state belongs under `GNOSI_DATA_DIR`, not in this source directory.

The engineering portal's [maintenance guide](../docs/engineering/testing/documentation-maintenance.md)
describes deterministic catalogs and the pre-PR checks. Use the existing root
Python environment and pnpm workspace; this pipeline has no independent
dependency installation. Generated references must be regenerated, never patched
by hand. A passing catalog build does not certify live cloud integrations or
desktop installers.

Reviewed translations also preserve the source guide's metadata, code examples,
identifiers, diagram structure and link destinations. The localization check
rejects technical drift without loading a translation model or rewriting pages.
This does not prove prose equivalence: review translated explanations and inspect
the rendered guides alongside the automated checks.
