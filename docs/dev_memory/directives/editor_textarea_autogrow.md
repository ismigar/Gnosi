# Directive: Auto-growing textareas without scroll jumps

## Objective

Auto-growing textareas, including Vault source view and page titles, must not
move the document scroll position after each keystroke.

## Cause

The usual pattern temporarily collapses the textarea:

```js
element.style.height = "auto";
element.style.height = `${element.scrollHeight}px`;
```

In a long scroll container, that collapse makes the browser clamp or adjust
`scrollTop` while following the caret. The edited line drifts down the screen
after every character.

## Implementation

`BlockEditor.jsx` provides `getScrollableAncestor()` and
`autoGrowTextarea()`. Save the scrollable ancestor's `scrollTop`, update the
height, and restore the position synchronously in the same tick before paint.

Use this helper in `MarkdownCodeEditor` and `EditorInner` title auto-growth.

The Markdown source textarea must also keep a minimum height equal to the Vault
page body. Auto-growth may set its inline height to zero for an empty document,
but the minimum height keeps the code surface visible, focusable, and editable.
Show a localized placeholder so an empty source document is distinguishable
from a failed editor render.

## Restrictions

- Never use raw `height = "auto"` plus `scrollHeight` without preserving
  scroll position.
- Restore synchronously in the same effect. `requestAnimationFrame` or
  `setTimeout` allows a visible flicker.
- The Vault scroll container is a nested `overflow-y-auto h-full` element,
  not necessarily `window`. Walk ancestors and fall back to
  `document.scrollingElement`.
- Every new auto-growing textarea must reuse `autoGrowTextarea()`.
- Never rely only on `scrollHeight` for an empty source editor. A zero-height
  textarea makes code view look active while leaving no practical click target;
  keep the source textarea at least as tall as the page body's 500 px minimum.
