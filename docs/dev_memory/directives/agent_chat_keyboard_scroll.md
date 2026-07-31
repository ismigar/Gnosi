# Directive: Agent chat keyboard scrolling

## Objective

Allow people to review a long assistant conversation with the Up and Down arrow
keys while the empty chat composer has focus.

## Procedure

1. Keep a reference to the scrollable message panel.
2. Intercept only unmodified Up and Down arrow presses in the empty composer.
3. Prevent the browser caret movement for those presses and scroll the message
   panel by a small, predictable amount.
4. Preserve native textarea navigation whenever the composer contains text.
5. Verify the decision logic with a unit test and verify the interaction in the
   native browser UI.

## Restrictions and edge cases

- Do not register a window-level keyboard listener: it would move the chat
  while the user is working elsewhere in Gnosi.
- Do not hijack arrow keys when the composer has content: this would prevent
  normal caret movement and text editing.
- Do not intercept modified arrows, because browsers, assistive technology,
  and operating systems may assign them navigation semantics.
