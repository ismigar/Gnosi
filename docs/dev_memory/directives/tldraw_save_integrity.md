# Tldraw Save Integrity

> ID: `2026-06-10`
> Status: active

## Risk

An autosaving editor must distinguish a failed load from a new drawing.
Otherwise it can overwrite real data with an empty canvas.

Observed destructive paths:

- A non-404 load failure was treated as a new drawing.
- Legacy Excalidraw JSON produced a silent no-op in Tldraw and then an empty
  save.
- Reusing one editor store between drawing tabs could save the previous
  drawing under the next ID.

## Required behavior

Frontend load state is explicit:

```text
loading | ready | error | incompatible
```

Saving, including autosave and keyboard save, is allowed only in `ready`.

- `404` may represent a legitimate new drawing.
- Other fetch failures show a retry overlay and block all saves.
- Unknown nonempty JSON is incompatible and blocks saves.
- `{}` is the valid initial payload.
- Snapshot migration exceptions also produce incompatible state.

Validate snapshot shape before calling `loadSnapshot`; it may silently ignore
unsupported objects without throwing.

Listen only to user-originated document-scope changes. Camera and selection
state must not trigger persistence.

Keep at most one pending autosave timer. If an autosave effect is recreated,
clear the timer and reset its ref to `null`; a stale timer handle would make
later document changes look already scheduled and silently disable saving.

Render the editor with `key={drawingId}` so every drawing receives its own
store.

## Backend protection

Before overwriting a drawing, copy the existing file to
`.history/{id}/{timestamp}.tldraw.json`. Apply a ten-minute backup cooldown so a
broken save loop cannot replace every good backup with empty versions.

Run cloud filesystem reads and writes through `asyncio.to_thread`, including
drawing list and load endpoints. A synchronous `glob`, `stat`, or `read_text`
can block the FastAPI event loop on an online-only OneDrive placeholder and
make both existing and new drawings appear unable to open.

The backend backup is defense in depth and remains necessary for older
clients.

## Legacy drawings

Legacy `.excalidraw.json` files stay protected and read-only until a dedicated
migration exists. Never create an empty `.tldraw.json` that shadows a legacy
file.

## QA

- Load `500`: error overlay and no PUT.
- Load legacy Excalidraw JSON: incompatible overlay and no PUT.
- Load `{}`: pan and zoom do not save; drawing a stroke saves a snapshot.
- Switch tabs: stores and content never cross IDs.
- Two backend PUTs create one cooldown-respecting history version containing
  the previous data.

## Core rule

Never interpret “could not load” as “new empty document.” Block writes until
the document is explicitly known to be safe and ready.
