# Directive: Modal behavior standard

> ID: 2024-04-17-MODAL-STD
> Status: ACTIVE

## Objective

Provide consistent, safe, and accessible behavior across all Gnosi dialogs.
Accidental closure can lose data, while predictable keyboard controls improve
efficiency and accessibility.

## Behavior

### Backdrop

- Clicking the backdrop must not close a dialog.
- Every dialog must provide an explicit close or Cancel action.

### Escape

- `Escape` must close an open dialog.
- Register and clean up a `keydown` listener from a React effect.

### Enter

- `Enter` invokes the primary action such as Accept, Save, or Confirm.
- Do not intercept Enter when the focused element needs it for its own
  behavior, especially a `textarea`.
- Search and list dialogs may use Enter to select the highlighted item.

## React reference

```javascript
useEffect(() => {
  if (!isOpen) return;

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      onClose();
    } else if (event.key === "Enter") {
      if (document.activeElement?.tagName === "TEXTAREA") return;
      onConfirm();
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [isOpen, onClose, onConfirm]);
```

Register global modal listeners on `window` or `document`, not on an
unfocused modal element that cannot receive keyboard events.

Created on 2026-04-17.
