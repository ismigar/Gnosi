# Hierarchical Vault Subpages

## Objective

Preserve Notion child-page hierarchy through `parent_id` instead of flattening
every child into the Wiki root.

## Model

Hierarchy is metadata only. Child Markdown files remain under `Wiki/`; never
place them in a table directory.

Table membership uses directory-prefix fast paths. A child page stored inside a
table folder can be misclassified as a database row.

The frontend builds the visible tree:

- A page's own markers determine whether it belongs to Wiki, Data, or
  Dashboards.
- A Wiki page nested below a database row remains a Wiki page.
- If its row parent is not rendered in the Wiki tree, the child appears at the
  Wiki root rather than under an invisible node.
- Dashboard children inherit dashboard placement.
- Parent-chain resolution is memoized and cycle-safe.

## Notion clone

The clone's child-page BFS passes the namespaced parent ID into each standalone
child creation. Seed rows and explicitly selected standalone pages have no
parent.

Child discovery descends through container blocks such as toggles and columns,
but stops at a `child_page` boundary. Grandchildren belong to the child and are
processed when the BFS visits it.

A visited set prevents cycles. If corrupt source data suggests two parents, the
first BFS parent wins.

## Re-walk repair

`pipeline/utils/rewalk_subpage_parents.py` repairs an existing clone. It is
idempotent and dry-run-first.

The tool derives source ownership from page search metadata, patches only
`parent_id`, and never moves files. It accepts the clone vault ID and sends the
corresponding vault header.

Run it only when the clone vault is hydrated. Individual unreadable pages are
reported and skipped so a later rerun can complete them.

## Restrictions

- Never infer hierarchy from physical subdirectories.
- Never store child pages inside table folders.
- Do not recurse through a child-page boundary while attributing descendants.
- Do not brute-force File Provider failures; allow hydration to complete.
- An unreadable `params.yaml` must degrade to inherited configuration rather
  than taking down all vault endpoints.

## Future work

- Create subpages from a row or page action.
- Show child-page lists inside the parent page.
- Treat Notion database subitems as a separate database feature, not Wiki
  subpages.

## QA

Clone nested pages inside ordinary and container blocks, run the repair twice,
and verify stable tree placement, no table contamination, no duplicate files,
and graceful partial hydration.
