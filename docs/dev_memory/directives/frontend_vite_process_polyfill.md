# Directive: Vite `process` polyfill

## Context

Some libraries, including older Excalidraw builds, expect a global `process`
object that browsers do not provide under Vite. They fail with
`ReferenceError: process is not defined`.

## Implementation

Use Vite's `define` setting to replace `process.env` references at build and
development-server time:

```javascript
export default defineConfig(({ mode }) => {
  return {
    define: {
      "process.env": "({})", // Safe browser replacement.
      global: "window",      // Compatibility for legacy libraries.
    },
  };
});
```

## Restrictions and lessons

> [!CAUTION]
> **React 19 and Excalidraw:** Excalidraw 0.17.6 crashes the application under
> React 19 because it accesses `ReactCurrentDispatcher`. Do not re-enable that
> version without upgrading the library or implementing a verified workaround.

> [!WARNING]
> **BlockNote multi-column:** some Vite HMR configurations can trigger
> `Duplicate use of selection JSON ID`.

> [!IMPORTANT]
> **ESM import order:** keep every import at the top of `.jsx` modules. Running
> code such as `console.log` or `alert` before imports can break module
> evaluation and produce a silent blank screen.

## Debugging

1. For a blank screen, inspect the console for `ReferenceError`.
2. If the console is clean, check for a reload loop in the Network tab.
3. Disable heavy imports such as Excalidraw and BlockNote individually to
   isolate the module that prevents startup.
