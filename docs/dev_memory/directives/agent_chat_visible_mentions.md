# Directive: Visible assistant chat mentions

## Objective

Let people mention pages and tables in the assistant chat without exposing
internal identifiers in the composer or the visible conversation history.

## Procedure

1. Load pages and tables into the existing `@` mention catalog.
2. Insert the selected resource as its visible `@Name` token.
3. Retain the selected resource type, identifier, and label as structured
   client state.
4. Send only selected tokens still present in the final composer text as the
   request's structured mentions.
5. Render the user's visible message from the composer text without adding
   identifier syntax.

## Restrictions and edge cases

- Do not put table or page IDs in the composer, user-visible chat history, or
  session title. IDs belong only in the structured mention payload.
- Do not infer a reference merely because a user types a matching name. Only a
  resource selected from the mention menu becomes a structured mention.
- Drop a selected mention when its visible token is removed before sending.
