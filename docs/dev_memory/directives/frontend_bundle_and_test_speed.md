# Directive: Frontend Bundle and Test-Speed Boundaries

**Status:** Active.
**Origin:** 2026-07-31.

## Purpose

Keep optional UI capabilities out of the startup bundle and make deterministic
unit tests fast without weakening production retry behavior.

## Rules

- Dynamic icon rendering must use the library's lazy icon loader; do not import
  an entire icon registry into an eagerly loaded component.
- Preserve a stable named-icon fallback when a configured icon is unknown.
- Production retry delays protect remote integrations and must remain real.
  Tests that deliberately exercise an empty or failed fake response must stub
  the delay locally instead of waiting for production backoff intervals.
- Vite dependency discovery must remain restricted to the Gnosi `index.html`
  entry. Vendored readers contain HTML fixtures with build-only PDF.js aliases;
  scanning the complete frontend tree makes clean native restarts fail.

## Verification

- Run the focused component or frontend build and inspect emitted chunk sizes.
- Run the affected backend test module and confirm retry semantics remain covered
  without wall-clock waits.
