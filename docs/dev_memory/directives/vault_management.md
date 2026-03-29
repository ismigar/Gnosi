# DIRECTIVE: VAULT_MANAGEMENT_AND_RENAMING

> ID: VAULT-MNG-20240308
> Associated Script: backend/config/paths_config.py
> Last Update: 2024-03-08
> Status: ACTIVE

---

## 1. Objectives and Scope

The goal is to provide a single, consistent way to manage the Gnosi Vault path (the location of Markdown notes, resources, and assets) across all components (backend, pipeline, and sync scripts).

- **Main Objective:** Ensure all scripts and services use the same root Vault directory and avoid redundant folder creation (e.g., `gnosi/vault`).
- **Success Criteria:** Standardized environment variables determine the path, and no hardcoded fallbacks exist in individual scripts.

## 2. Input/Output (I/O) Specifications

### Inputs (Environment Variables)

The system looks for the following variables in order:
1. `DIGITAL_BRAIN_VAULT_PATH`: Primary path used by the backend and UI.
2. `gnosi_VAULT_PATH`: Secondary path (compatibility).

### Configuration Overrides
- `config/params.yaml`: Can override the `paths.vault` section, though **not recommended** for standard installations.

## 3. Logical Flow (Path Resolution)

All scripts **MUST** import `get_paths` from `backend.config.paths_config` instead of calculating paths themselves.

1. **Detection:** `get_paths()` reads environment variables.
2. **Validation:** If no path is found, the system raises a `RuntimeError` instead of defaulting to a local folder.
3. **Construction:** Relative paths in overrides are resolved against the project root.
4. **Initialization:** Folders are created only if a valid path is resolved.

## 5. Renaming Procedure (SOP)

To rename the Vault folder (e.g., from `CervellDigital` to `Gnosi`):

1. **Physical Rename:** Rename the folder in the filesystem (e.g., using macOS Finder or `mv`).
2. **Environment Update:**
    - Update `.env.shared` in the project root.
    - Update `docker-compose.yml` in `monorepo/apps/gnosi/`.
3. **Registry Sync:** Ensure the `vault_db_registry.json` is present in the new root.
4. **Restart:** Restart the Docker containers to apply the new environment variables (`docker-compose up -d`).

## 5. Restrictions and Edge Cases

- **OneDrive/Sync:** If using OneDrive or similar, ensure the full path is updated correctly in the environment variables.
- **Redundant Folders:** NEVER hardcode `gnosi/vault` as a fallback. It causes files to be hidden from the user while the UI seems to work.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 08/03/24 | Redundant `gnosi/vault` creation | Inconsistent ENV variables and hardcoded fallbacks to `"vault"` in scripts. | Centralized logic in `paths_config.py` and removed all local fallbacks. |
| 08/03/24 | API reporting 0 pages | Overrides in `params.yaml` pointing to non-existent subfolders. | Removed `paths` section from `params.yaml` to follow dynamic ENV variables. |

---

## 7. Examples of Use

### In any script:
```python
from backend.config.paths_config import get_paths

paths = get_paths()
vault_path = paths["VAULT"]
```

## 8. Pre-Execution Checklist
- [ ] Environment variables `DIGITAL_BRAIN_VAULT_PATH` match the real folder name.
- [ ] Docker has been restarted after any env changes.
