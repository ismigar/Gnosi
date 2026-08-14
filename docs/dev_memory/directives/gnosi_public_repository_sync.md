# Gnosi Public Repository Synchronization

> Status: ACTIVE
> Last verified: 2026-08-14

## Objective

Publish the Gnosi source tree to `ismigar/Gnosi` without exposing unrelated
applications, private workspace projects, or repository-level operational
scripts from `ismigar/Projectes`.

## Publication contract

The private `Projectes` repository remains the source of truth. The public
repository is a generated snapshot with an orphan commit and no inherited
private history.

The snapshot uses an explicit allowlist. It contains the public repository
workflows and metadata, `apps/gnosi`, the shared packages required by the
product, and the root Node workspace manifests. It does not export the whole
`monorepo` tree.

The public layout remains stable: Gnosi stays under `apps/gnosi` so release,
documentation, and development commands keep working without path rewrites.

## Execution

The GitHub Actions workflow invokes `scripts/sync_repos.py` after changes to
`main`. The script must preflight the selected source manifest, create an
orphan branch, check out only allowlisted paths, promote them from `monorepo`
to the public repository root, and validate the staged manifest before the
force push.

Local execution is validation-only. The destructive snapshot preparation and
force push remain restricted to the isolated GitHub Actions checkout.

## Restrictions and edge cases

- Do not check out `monorepo/` or `monorepo/apps/` as a broad pathspec. That
  exports unrelated applications such as `mcp-drupal-proxy` and `sandbox`.
  Check out only the explicit allowlist instead.
- Do not export the private repository root. It contains Témenos and other
  workspace projects that are outside the Gnosi publication boundary.
- Do not export `monorepo/scripts` implicitly. A repository tool must be added
  to the allowlist only after confirming it is required by public Gnosi users.
- Do not accept staged paths outside the allowlist. Abort before commit and
  push when the preflight and staged manifests differ.
- Do not add a new public top-level path by widening a parent directory. Add
  the narrowest required path and extend the regression tests.
- Do not pass absent optional allowlist entries to one Git checkout command.
  Git rejects the complete checkout when any pathspec is missing. Resolve the
  entries that exist at the selected ref first and check out only those paths.
- Do not run the publishing mode in a developer worktree. Use the read-only
  manifest check locally and let the isolated CI job perform publication.
- Do not print the authenticated remote URL. It contains the CI token. Log a
  redacted command while passing the real URL only to the subprocess.

## Verification

The synchronization is ready when the unit tests prove that the allowlist
accepts the Gnosi application and shared packages, rejects unrelated apps and
Témenos paths, and the read-only manifest check succeeds against the current
Git tree. The resulting manifest must contain no `temenos`,
`apps/mcp-drupal-proxy`, `apps/sandbox`, or root `scripts` paths.

## Related files

- `.github/workflows/sync.yml`
- `scripts/sync_repos.py`
- `scripts/tests/test_sync_repos.py`
- `docs/dev_memory/directives/technical_documentation_system.md`
