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

---
*Maintenance: Before any uninstallation of legacy containers, verify volume persistence.*
