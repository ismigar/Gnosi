# BlockNote Custom Blocks with Vite

> Historical compatibility note.

## Problem

Initializing custom BlockNote schemas at module load can interact badly with
Vite dependency pre-bundling and environments without a real DOM. Passing a
factory where a realized block specification is expected can also cause
runtime schema errors.

## Rules

- Build the editor schema inside a memoized React boundary.
- Realize every custom block specification in the form required by the active
  BlockNote version.
- Keep property-schema default values compatible with their declared types.
- Avoid browser-only work during module evaluation.
- Validate both production build and runtime editor creation.

## QA

Cold-start Vite, build for production, create the editor, insert every custom
block, reload saved content, and confirm no pre-bundle hang or schema error.
