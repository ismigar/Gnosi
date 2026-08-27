# SKILL: Maintenance & Hygiene

This skill is responsible for maintaining the integrity and cleanliness of the Gnosi system, both at the data level and in the local infrastructure.

> ID: MAINT-20260408
> Status: ACTIVE

---

## 1. Vault Maintenance (Data)

### Safe Cleanup
Protocol for emptying the Vault at the user's request.
1. **Mandatory Backup**: Compress the Vault directory to `pipeline/sandbox/backups/`.
2. **Deletion**: Delete only `.md` files.
3. **Persistence**: DO NOT delete `vault_db_registry.json` unless explicitly requested.

### Interface Hygiene (Views Cleanup)
Protocol for deleting duplicate views ("Principal Table").
- **Identification**: Inspect the DOM to obtain the actual `view_id`.
- **Action**: Call `DELETE` to `/api/vault/views/{view_id}` via a sandbox script.

---

## 2. Systems Maintenance (Infrastructure)

### Canonical checkout and legacy runtime migration

- The canonical tracked checkout is `Projectes/apps/gnosi`.
- A force-pushed `Sync from Projectes` root commit can leave the former
  `Projectes/monorepo/apps/gnosi` tree behind as untracked files because Git
  does not delete ignored runtime state such as `.env`, `.venv`, `local_data`
  or databases.
- Before retiring the legacy tree, identify every process whose working
  directory points into it, migrate local-only runtime state to the canonical
  checkout, rebuild the virtual environment there, and verify the backend and
  frontend from the canonical paths.
- Note: Do not delete or archive the legacy tree while a backend is still
  writing SQLite files there, because this risks an inconsistent migration.
  Instead, validate a fresh canonical environment first, stop the legacy
  process, move runtime state on the same filesystem, restart from the
  canonical checkout, and only then move the legacy tree to the macOS Trash.
- Note: Do not assume `SIGTERM` stops a development backend launched with
  `uvicorn --reload`, because the supervisor and spawned worker can keep the
  listening socket alive. Instead, interrupt the reload supervisor, verify the
  worker has also exited, and require port 5002 to be closed before moving any
  SQLite state.
- Note: Do not merge a newly generated canonical `local_data` tree with the
  legacy SQLite tree, because imports and smoke starts may create directories
  and scheduler state even when a temporary data override is requested.
  Instead, move any pre-existing canonical tree to a timestamped quarantine
  under `.tmp`, move the complete legacy tree atomically, and record both paths
  for recovery.
- Note: Do not calculate the Projectes root from a fixed parent depth, because
  both `apps/gnosi` and the historical `monorepo/apps/gnosi` layouts have
  existed. Instead, discover the repository root from stable tracked markers.
- The idempotent migration helper is
  `scripts/migrate_legacy_gnosi_checkout.py`. Run its `prepare` phase while the
  legacy backend is live, validate a fresh canonical backend, stop every
  legacy writer, and then run its `migrate` phase.
- Note: Do not assume the repository README and the application README are
  byte-identical during path migrations, because synchronized documentation
  can drift. Instead, inspect and patch each tracked document independently,
  then search the full canonical documentation set for stale legacy paths.
- Note: Do not use `path` as a shell loop variable in `zsh`, because it is a
  special array tied to `PATH` and can make commands appear unavailable.
  Instead, use a task-specific name such as `file_item`.
- Note: Do not append a generic exit-status assertion after a chained QA
  command, because it can turn an earlier failure into a successful shell
  result. Instead, invoke the canonical `apps/gnosi/.venv` explicitly and let
  each validation command propagate its own exit code.
- Note: Do not carry test filenames across history-rewritten sync branches,
  because a valid test on an older root may no longer exist on current
  `gnosi/main`. Instead, discover the current test tree before invoking pytest.
- Note: Do not leave macOS LaunchAgent plists pointing at the compatibility
  symlink after a checkout migration, because KeepAlive services preserve the
  old path operationally and can race with manually started servers. Instead,
  update every active Gnosi plist to `Projectes/apps/gnosi`, reload the jobs,
  and verify each process working directory and listening port.

### Docker Management (Update & Prune)
- **Update**: Edit `docker-compose.yml` with the new image tag and restart.
- **Cleanup**: Execute `docker system prune -a -f --volumes` periodically to free up space.
- **Risk**: If the Docker Daemon hangs (>60s), DO NOT retry; request a manual restart of the computer.

---

## 3. Code Quality (I18N & Syntax)

- **Logs**: Never leave `console.log` or `print` in production files.
- **I18N**: All new text strings must use `i18n.t()` keys.
- **YML**: Avoid duplicate keys in GitHub Actions workflows. Always use 2-space indentation.

---

## 4. History and Learning (Learning Cycle)

| Date | Error / Learning | Root Cause | Solution / Refinement |
| --- | --- | --- | --- |
| 2026-01-31 | Docker Hangs | Mac Daemon freeze | Added manual restart warning to the protocol. |
| 2026-04-08 | Duplicate Views | Sync collisions | API-based cleanup SOP via `SKILL.md`. |
| 2026-04-08 | Fragmentation | Dispersed maintenance | Unification of all cleanup protocols into `maintenance`. |
| 2026-08-27 | Duplicate Gnosi checkout | A history-rewriting sync changed the tracked layout while ignored runtime files remained under `monorepo/` | Declare `apps/gnosi` canonical, migrate runtime state after stopping writers, archive the legacy tree recoverably, and resolve roots from repository markers. |

---
*Maintenance: Before any uninstallation of legacy containers, verify volume persistence.*
