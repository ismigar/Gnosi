# Directive: Local handwriting recognition

## Objective

Convert handwritten Tldraw strokes to text and provide optional palm
rejection. Processing remains local for offline-first Vault privacy.

## Architecture

- `backend/services/handwriting.py` lazily loads a singleton TrOCR model on
  CPU, cached under `GNOSI_LOCAL_DATA/cache/trocr`, never OneDrive. Horizontal
  projection segments input into lines because TrOCR is single-line.
- Handwriting routes expose recognize, warmup, and status endpoints under
  `/api/vault/handwriting`.
- Optional AI correction restores accents and digraphs through the configured
  local-capable generation path. If no provider is available, return raw text
  successfully.
- Warmup starts from the frontend when the canvas opens rather than at backend
  startup, avoiding permanent 1.3 GB model memory.
- `TldrawEditor.jsx` exports selected shapes or the complete canvas as a white
  background PNG and inserts recognized text below the strokes.
- The stylus-only toggle blocks touch pointers in capture phase while
  retaining pen and mouse input.

## Restrictions

- Do not upload handwriting to a cloud recognition service.
- The default Microsoft model is trained primarily on English and can miss
  Catalan or Spanish accents. Present this as note recognition, not perfect
  transcription.
- Limit processing to `_MAX_LINES = 40` and run recognition through
  `asyncio.to_thread`.
- Export with `background: true` and `darkMode: false`; transparent or dark
  input produces poor OCR.
- First use downloads the configured model and can take time. Show a localized
  recognizing state.
- Native backend uses reload for backend source, but dependency changes still
  require a LaunchAgent restart.
- Stylus-only mode also disables two-finger pan and zoom; it is off by default.
- Tldraw already supports pen pressure.

## QA

- Status returns model availability.
- Recognize accepts a PNG and returns text, line count, and model.
- Frontend build passes and the insertion action works from the canvas.
