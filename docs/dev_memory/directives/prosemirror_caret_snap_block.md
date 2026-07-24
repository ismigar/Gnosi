# ProseMirror Dashboard Caret-Snap Guard

## Objective

Prevent ProseMirror from jumping a long dashboard scroll back to the invisible
caret around an atomic embedded view when arrow keys are pressed.

## Cause

A dashboard page can consist of one atomic `gnosi_view` block. ProseMirror
still maintains a selection before or after it and calls
`scrollToSelection`. When the user scrolls far away, Chrome moves the
container back to that invisible caret.

## Implementation

`FeedRender` installs a configurable `scrollTop` setter only on its scroll
container instance.

The setter ignores a change only when:

- The jump exceeds the configured large-distance threshold.
- The call stack identifies ProseMirror selection scrolling.

All smaller adjustments and ordinary user scrolling call the original setter.
Cleanup deletes the instance property so prototype behavior resumes.

## Restrictions

- Never patch `Element.prototype`; that would affect the entire app.
- Filter by both source stack and magnitude.
- Do not instrument the same setter in browser tools during verification,
  because that replaces the guard. Observe passive scroll events instead.
- Do not blur the editor, disable focus, or make ProseMirror non-editable as a
  workaround.
- Keep the threshold centralized and covered by browser behavior.

## QA

Run frontend build and lint. In Chrome, scroll far down, navigate with arrow
keys, and verify no long jump occurs. Confirm small legitimate caret movement
and Firefox scrolling remain unchanged.
