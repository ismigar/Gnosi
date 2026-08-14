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
must not expose tool arguments or tool results.

Every visible message also offers a conversation rewind action. Rewinding one
message removes its complete turn and every later turn from both the browser
cache and the scoped server checkpoint. The UI must explain that this changes
conversation memory only: a completed confirmation or external side effect is
not reversed. Ask for confirmation before applying the destructive history
change, cancel pending confirmations in the rewound session, and restore the
removed user prompt to the composer when possible.

An operation-specific undo control remains distinct from conversation rewind.
It is allowed only for the final message of an operation that supplies an
explicit, server-backed reversal; it must not claim to undo model text, a
completed confirmation, or an external side effect.

## Response processing time

Start a monotonic timer immediately before sending a chat request. While the
response is streaming, show a live whole-second counter next to the processing
state. When the stream ends, attach the elapsed duration to the response bubble
that completed the turn and persist the bounded millisecond value with the
browser session cache. Show the saved duration in seconds on every completed
assistant or system response. Canonical history hydration may merge this
presentation metadata from the local cache, but it must never replace canonical
message roles or content with browser values.

## Additional restrictions and edge cases

- Do not implement rewind by hiding local bubbles only: the model would still
  receive the removed checkpoint history on the next request.
- Rewind only at complete user-turn boundaries so strict providers never resume
  from an orphan assistant/tool protocol group or an unanswered user message.
- Do not trust a client-supplied transcript during rewind. The server derives
  the retained prefix from the scoped canonical checkpoint and returns its
  public projection.
- Do not describe conversation rewind as reversing a completed external action.
- Cap stored processing durations and ignore malformed legacy values so browser
  persistence cannot accumulate invalid metadata.
