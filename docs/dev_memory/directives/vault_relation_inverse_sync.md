# Vault Inverse-Relation Synchronization

## Problem

Vault relationships are bidirectional in schema intent, but a page update once
changed only one side. Embedded views filtering on the inverse field could
therefore appear empty even when the source's direct relation was populated.

## Data model

Relation properties specify a destination table and cardinality. Legacy
schemas may not contain `related_property_id`, so an inverse can be inferred
only when the destination table has exactly one compatible relation back.

Persisted relation values use `[[Title|id]]`. Parsed API metadata exposes clean
IDs, and save logic decorates them again.

Field recognition is schema-based:

- Use `type == "relation"`.
- Include canonical names and aliases.
- Normalize labels for matching.
- Retain the legacy icon prefix only as a compatibility fallback.

Never detect relations only with `startswith()` on a decorative prefix.

## One-time repair

`pipeline/sandbox/sync_inverse_relations.py` is idempotent and dry-run-first:

1. Read source and destination tables.
2. Select only unambiguous inverse pairs.
3. Add missing source IDs to destination inverse values.
4. Create a local backup before `--apply`.
5. Patch sequentially through the backend.
6. Refresh embedded-view snapshots.
7. Refetch and prove inverse values are a superset of direct values.

The repair only adds missing links. It never removes inverse values because a
target may legitimately relate to multiple sources.

## Automatic synchronization

`_propagate_relation_inverse` runs after page create and update. Pure logic in
`services/relation_sync.py` computes changes and resolves an unambiguous
inverse.

The background writer saves the target page directly through canonical page
services to avoid endpoint recursion. It is idempotent and skips ambiguous
schemas with a warning.

## Rename compatibility

All consumers resolve relation fields through schema names and aliases:

- Frontmatter stripping and decoration.
- Inverse propagation.
- Embedded-view filtering.
- Structural graph edges.
- Hover-card property hiding.

A saved filter using an old field name must still match metadata stored under a
new alias.

## Restrictions

- Skip targets with zero or multiple possible inverse fields.
- Never guess an inverse from UI icons or localized labels.
- Do not edit YAML directly.
- Use sequential or bounded writes to protect the database pool.
- Materialize cloud files before mutation.
- Preserve existing IDs and relation order where meaningful.

## QA

Unit tests cover direct/inverse changes, ambiguity, renamed aliases, decorated
wikilinks, and legacy prefix fallback. E2E creates or updates a disposable
relation and verifies both pages plus the filtered embedded view.
