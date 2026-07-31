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
5. Make the chat panel itself focusable so arrows work when focus is anywhere
   in the chat surface, not only in the composer.
6. Verify the decision logic with a unit test and verify the interaction in
   the native browser UI.

## Restrictions and edge cases

- Do not register a window-level keyboard listener: it would move the chat
  while the user is working elsewhere in Gnosi.
- Do not hijack arrow keys when the composer has content: this would prevent
  normal caret movement and text editing.
- Do not intercept modified arrows, because browsers, assistive technology,
  and operating systems may assign them navigation semantics.
- Do not install a global document listener: modal dialogs and other controls
  must retain their own keyboard behavior.

## Message actions

Every chat message exposes safe local actions below its bubble: copy, quote
into the composer, inspect bounded metadata, and (for user messages) edit the
next prompt. Assistant messages additionally allow the preceding user prompt
to be prepared again, local feedback, and a local saved marker. These actions
must not expose tool arguments or tool results. A visible undo control is
allowed only for the final message of an operation that supplies an explicit,
server-backed reversal; it must not claim to undo model text, a completed
confirmation, or an external side effect.
