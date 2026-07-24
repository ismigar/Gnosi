# DIRECTIVE: VAULT_ICON_UPLOAD_ENDPOINT

> ID: 2026-04-04
Associated Script: N/A (Backend/Frontend integration) Last Update: 2026-04-05
Status: ACTIVE

---

## 1. Objectives and Scope

Separate icon uploads from cover uploads in the Vault and make the icon
pipeline more robust.

- Main Objective: provide a dedicated icon endpoint and store icons in a
  folder separate from covers.
- Success Criteria: `IconPicker` uses `/api/vault/upload-icon`, uploaded icons
  are stored in `Assets/Icons`, covers continue to use `Assets/Covers`, and
  external URLs are imported into local storage.

## 2. Input/Output (I/O) Specifications

### Inputs

- Source Files:
  - `monorepo/apps/gnosi/backend/api/vault_routes.py`
  - `monorepo/apps/gnosi/frontend/src/components/Vault/IconPicker.jsx`

### Outputs

- Functional API:
  - `POST /api/vault/upload-icon`
  - `POST /api/vault/import-icon-url`
- Stored artifacts:
  - uploaded icons in `Assets/Icons`
  - icon thumbnails in `Assets/Icons/Thumbnails`
  - uploaded covers in `Assets/Covers`

## 3. Logical Flow (Algorithm)

1. Validate that the uploaded file is an image.
2. Persist icon uploads in `Assets/Icons` using hashed filename + normalized extension.
3. For large raster icons, generate a square thumbnail in `Assets/Icons/Thumbnails`.
4. Keep cover uploads in `Assets/Covers`.
5. Return relative API URL `/api/vault/assets/...` in both flows.
6. Import external icon URLs through backend (`import-icon-url`) and persist locally.
7. Update `IconPicker` so file and URL flows both end in local icon assets.

## 4. Tools and Libraries

- FastAPI
- Existing Vault asset helpers in `vault_routes.py`
- React + Axios in frontend

## 5. Restrictions and Edge Cases

- Do not break existing cover uploads.
- External icon URLs must be downloaded and persisted locally by backend before assigning icon metadata.
- Keep returned URLs relative so frontend works across environments.
- If Pillow is unavailable in runtime, backend must still accept icon uploads/imports and skip thumbnail generation gracefully.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 04/04 | Icon uploads reused cover endpoint | Icons and covers shared the same upload route and folder semantics | Add dedicated `upload-icon` endpoint and store icon files in `Assets/Icons`. |
| 05/04 | Backend crash on startup after adding thumbnails | `PIL` was imported at module level but the Docker image had no Pillow installed | Make PIL import optional (graceful fallback) and rebuild backend image with Pillow dependency in requirements. |

## 8. Pre-Execution Checklist

- [x] Locate current upload endpoints
- [x] Confirm current icon picker uses cover endpoint

## 9. Post-Execution Checklist

- [x] Frontend build OK
- [x] Icon upload stores files under `Assets/Icons`
- [x] Cover upload still stores files under `Assets/Covers`
- [x] Visual test confirms icon upload still works
- [x] Icon filenames use hash + normalized extension
- [x] Thumbnail generation works for large raster icons
- [x] URL import persists remote icons locally in `Assets/Icons`
