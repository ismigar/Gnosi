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
- Use the canonical `useModalKeyboard` hook. It listens during the capture
  phase so embedded editors cannot swallow the key.
- In nested dialogs, one press closes only the topmost dialog.
- If closure is temporarily unsafe during a non-interruptible operation, bind
  `closeOnEscape` to the same state that disables the visible Cancel and close
  actions. Changing that state must not re-register the modal layer or move
  focus.

### Enter

- `Enter` invokes the primary action such as Accept, Save, or Confirm.
- Do not intercept Enter when the focused element needs it for its own
  behavior, especially a `textarea`.
- Search and list dialogs may use Enter to select the highlighted item.

## Accessibility contract

- The modal panel uses `role="dialog"` and `aria-modal="true"`.
- Every dialog has an accessible name through `aria-labelledby` or a
  localized `aria-label`.
- Enable `trapFocus` for blocking dialogs, mark the preferred initial control
  with `data-autofocus`, and restore focus to the opener after closure.
- Icon-only controls have localized accessible names. Toggle-style selection
  buttons expose `aria-pressed`.
- Backdrops are presentation only: do not attach close handlers to them.
- Keep background content inert from keyboard navigation while a blocking
  dialog is open.

## Verification

- Test Escape from text inputs, selectors, and embedded editors.
- Test nested dialogs with two consecutive Escape presses.
- Test forward and reverse Tab cycling and focus restoration.
- Verify that backdrop clicks do not close the dialog.
- Query the rendered dialog by its accessible role and name in component tests.

Created on 2026-04-17.
Last audited on 2026-08-21.
