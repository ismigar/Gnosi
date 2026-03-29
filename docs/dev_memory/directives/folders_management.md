# DIRECTIVE: FOLDERS_MANAGEMENT

> ID: 2026-03-27_FOLDERS_SIMPLIFICATION
Status: DRAFT

---

## 1. Objectives and Scope

*   **Main Objective:** Simplify the system configuration by defining a single root path ("Vault") from which all other system directories are derived.
*   **Success Criteria:**
    *   The Settings UI only shows one input for "Vault Path".
    *   The backend automatically derives `BD`, `Newsletters`, `Assets`, etc., relative to the `Vault` path.
    *   The `params.yaml` file is cleaned up of redundant path overrides.

## 2. Input/Output (I/O) Specifications

### Inputs
- **Required Arguments:**
    - `vault_path`: String - The absolute path to the Gnosi root folder (e.g., `/Users/user/Onedrive/Gnosi`).
- **Source Files:**
    - `monorepo/apps/gnosi/config/params.yaml`: Stores the `vault` path.

### Outputs
- **Derived Paths (Internal):**
    - `Assets`: `{vault}/Assets`
    - `Calendar`: `{vault}/Calendar`
    - `Dibuixos`: `{vault}/Dibuixos`
    - `Newsletters`: `{vault}/Newsletters`
    - `Wiki`: `{vault}/Wiki`
    - `BD`: `{vault}/BD`
    - `data`: `{vault}/data`
    - `Mail`: `{vault}/Mail`
    - `Plantilles`: `{vault}/Plantilles`

## 3. Logical Flow (Algorithm)

1.  **Frontend:** Update `GlobalSettingsModal.jsx` to only allow editing `paths.vault`.
2.  **Backend (Path Resolution):** In `backend/config/paths_config.py`, use the `vault` path from `params.yaml` as the base for all other folders.
3.  **Persistence:** Ensure that when saving configuration, only the `vault` path is strictly required in the `paths` section of `params.yaml`.

## 4. Tools and Libraries
- **Frontend:** React, Tailwind (if used), Lucide-react.
- **Backend:** Python (Pathlib), FastAPI, PyYAML.

## 5. Restrictions and Edge Cases
- **Absolute vs Relative:** The `vault` path should ideally be absolute. If relative, it should be relative to the project root.
- **Missing Vault:** If no `vault` path is configured, the system should fall back to a default location (e.g., `./vault`).
- **Permissions:** The system must have read/write access to the `vault` path.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 27/03 | Multiple path configuration | User confusion | Simplify to a single Vault root. |

## 10. Additional Notes
The folders identified within the vault are: `Assets`, `Calendar`, `Dibuixos`, `Newsletters`, `Wiki`, `BD`, `data`, `Mail`, `Plantilles`.
