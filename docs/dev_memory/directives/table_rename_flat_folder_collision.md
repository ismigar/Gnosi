# Directive: Table Rename — Flat Asset Folder / DB-Root Collision

## Objective
Renaming a table must move only the assets that belong to that table, and must
keep every inline image/file reference in its pages valid. This directive
documents a latent collision that broke references in production for the
"Cervell Digital" DB and the guards added to `rename_table`
(`monorepo/apps/gnosi/backend/api/vault_routes.py`).

## Background — the two asset layouts
A table owns assets in two physically separate places:

1. **Flat folder** `Assets/<TableName>/` — loose drag&drop files dropped into a
   page body, referenced inline as `/api/vault/assets/<TableName>/file.png`.
2. **Structured tree** `Assets/<DBName>/<TableName>/<Property>/` — files attached
   to asset-type properties.

`rename_table` migrates BOTH so existing files follow the renamed table.

## The collision (root cause)
`_sanitize_asset_segment` turns a name into a folder segment. On macOS/APFS the
filesystem is **case-insensitive**, so two segments that differ only in case map
to the **same physical directory**.

When a table's segment equals its parent DB's segment (case-insensitively), the
table's flat folder `Assets/<TableName>/` **is the same directory** as the DB
nesting root `Assets/<DBName>/`. That root contains the structured trees of
*all* tables in the DB.

Production repro (DB "Cervell Digital", id `digital_brain_db`):
- Table "Cervell digital" → flat folder `Assets/Cervell digital/`.
- DB "Cervell Digital" → nesting root `Assets/Cervell Digital/`.
- These are the SAME folder. It held both the table's loose images AND
  `Assets/Cervell Digital/Recursos/Adjunts/*.pdf` (the "Recursos" table's tree).
- Renaming the table "Cervell digital" → "Cervell" did a wholesale
  `Assets/Cervell digital/` → `Assets/Cervell/` rename, **dragging the whole DB
  tree along** and breaking every reference under `Cervell Digital/...`.
- Additionally, 4 inline body refs `![..](/api/vault/assets/Cervell%20digital/..)`
  were never rewritten, so they pointed at a now-nonexistent path.

## Procedure (correct behaviour)
1. Resolve the DB segment once, up front.
2. **Flat folder**, by collision state:
   - `old_seg` and `new_seg` BOTH collide with DB segment → nothing to relocate.
   - EITHER collides → never rename the directory in bulk. Move only the **loose
     files** (`_move_loose_files`); leave subdirectories (other tables'
     structured trees) untouched.
   - Neither collides, destination free → wholesale rename (fast path).
   - Neither collides, destination exists → leave as-is + warning.
3. **Rewrite inline refs** whenever the flat segment effectively changed
   (`_rewrite_inline_asset_refs` over the table's vault folder): rewrite both the
   URL-encoded and raw forms of `/api/vault/assets/<old_seg>/` →
   `/api/vault/assets/<new_seg>/` (new form always URL-encoded).
4. **Structured tree** `Assets/<DB>/<Table>/` rename — always safe (nested under
   `<DB>/`, can never coincide with the root).

## Restrictions / Edge Cases
- **Do NOT** bulk-rename the flat folder when its segment collides with the DB
  segment → it drags the DB-nested trees of other tables → moves only loose
  files instead.
- **Ref rewriting MUST be case-SENSITIVE.** Loose-file refs carry the *table's*
  casing (`Cervell%20digital`); structured refs carry the *DB's* casing
  (`Cervell%20Digital`). A case-insensitive replace would corrupt the structured
  refs — exactly the breakage we are fixing. `str.replace` (case-sensitive) is
  required, never `re.IGNORECASE`.
- Collision detection uses `casefold()` (`_asset_segments_collide`) so APFS
  case-insensitivity is matched portably; do not switch to exact `==`.
- The new inline URL is always written URL-encoded (`%20`), matching how the
  editor stores refs.

## Verification
Simulated against the real case-insensitive APFS filesystem (mirrors the exact
handler logic), both scenarios PASS:
- **Collision**: structured `Recursos/Adjunts/doc.pdf` stays under
  `Assets/Cervell Digital/`; loose images move to `Assets/Cervell/`; encoded
  inline refs rewritten; DB-cased structured ref left intact.
- **Non-collision**: full flat-folder rename + inline ref rewrite.

E2E against a live backend (`tests/test_e2e_tables_assets.py`) requires the
Docker stack running and was not exercised in the worktree.

## Related Files
- `monorepo/apps/gnosi/backend/api/vault_routes.py`
  - `rename_table` (PUT `/tables/{table_id}`) — handler with the guards.
  - `_asset_segments_collide`, `_move_loose_files`, `_table_vault_dir`,
    `_rewrite_inline_asset_refs` — new helpers.
  - `_sanitize_asset_segment`, `_property_assets_dir`, `_table_assets_dir` —
    segment/layout helpers.

## History of Failures
- **Failure 2026-05-24**: Production DB "Cervell Digital". Renaming table
  "Cervell digital" → "Cervell" bulk-renamed the shared `Assets/Cervell digital/`
  (== DB root) folder, dragging `Recursos/Adjunts/*.pdf` and leaving 4 inline
  image refs pointing at the vanished `Cervell%20digital/` path. Data fixed
  manually; code fixed here so it cannot recur.

---
**Standard**: All directives must be written in English.
