# Vault Dashboard Knowledge Panels

## Objective

Keep Vault Dashboard pages focused on composed views rather than document
metadata. A page whose canonical metadata marks it as a Dashboard does not show
the Properties or Links and mentions panels in the editor header.

## Behavior

- Dashboard titles, page actions, embedded views, and links inside result cards
  remain available.
- Ordinary Wiki and Data pages retain their Properties and Links and mentions
  panels unchanged.
- Dashboard pages do not request backlinks, relation links, or unlinked mentions
  merely to populate hidden panels.

## Restrictions and edge cases

- Use the canonical boolean `is_dashboard` metadata marker. Do not infer the
  editor behavior from a title or folder name because pages can move or be
  renamed.
- Do not disable navigation from records rendered inside a Dashboard; those
  links belong to the source records, not to the Dashboard document.
- Do not remove persisted Dashboard metadata. It remains necessary to classify
  and render the page even though it is not user-editable knowledge metadata.

## QA

Verify the metadata predicate with unit tests, build the frontend, and compare a
Dashboard page with a normal Wiki page in the browser. The Dashboard must omit
both panels while its content remains visible; the Wiki page must still show
both panels.
