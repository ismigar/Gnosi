# Directive: Excalidraw integration MVP

> ID: 2026-02-28
> Status: ACTIVE
> Associated script: `sandbox/test_excalidraw_save.py`

## Objective

Integrate Excalidraw as a native drawing tool in a Gnosi vault. Users can
create, edit, and automatically persist `.excalidraw.json` files.

## Inputs and outputs

- `VAULT_PATH`: base vault location.
- `vault/*.excalidraw.json`: scene data.
- Optional `vault/.thumbnails/*.svg`: sidebar previews.

## Flow

1. Load `@excalidraw/excalidraw` dynamically to control initial bundle size.
2. Render the editor with a close action and current filename.
3. Track element and state changes through `onChange`.
4. Debounce persistence by about two seconds and send updated JSON to the
   backend.
5. Write the scene to the selected `.excalidraw.json` file.
6. In a later graph phase, extract text containing wikilinks.

## Restrictions

- Enforce an appropriate API payload limit because embedded images can make
  scene JSON large.
- Set `window.EXCALIDRAW_ASSET_PATH` for locally hosted fonts and icons when
  avoiding the Excalidraw CDN.
- Excalidraw does not support server-side rendering; load it on the client
  only.
- Never autosave when initial loading failed. A failed GET is not an empty new
  drawing. See `tldraw_save_integrity.md`.

## History

| Date | Issue | Cause | Resolution |
|---|---|---|---|
| 2026-02-28 | Initial proposal | N/A | Selected a native implementation rather than an Obsidian plugin dependency. |
| 2026-06-10 | Tldraw autosave overwrote real drawings after load failure | Failed GET treated as new drawing and silent `loadSnapshot` no-op | Added the safeguards in `tldraw_save_integrity.md`. |

## Checklists

Before implementation:

- Ensure the backend safely supports generic JSON files.
- Decide whether drawings live under `vault/drawings` or the vault root.

After implementation:

- Verify the file is saved correctly.
- Verify the graph ignores or handles unknown JSON safely.
- Test light and dark themes.
