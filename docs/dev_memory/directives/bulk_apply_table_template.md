# Apply a Template to Selected Table Records

## Objective

Allow a user to apply an existing table template to multiple selected records.

## Behaviour

- The bulk actions bar exposes a template picker only when the current table has templates.
- Applying a template replaces each selected record's body and copies the values for properties declared by that table's schema in the template.
- Titles, table context, identifiers, template flags, authorship, and other internal metadata remain owned by each target record.
- The server validates that every target and the template belong to the same table. A bad or missing record is reported without cancelling the rest of the batch.
- Perform one server-side bulk operation. Do not issue one browser PATCH per selected record.

## Consistency

- Serialize each target write with its page write lock.
- Refresh the in-memory page index and invalidate response caches after every successful write.
- Return updated, skipped, conflict, and error identifiers so callers can refresh and report partial completion accurately.

## QA

1. Apply a template to more than one record and confirm every body is replaced.
2. Confirm declared template properties are copied while titles and table identifiers do not change.
3. Confirm a template from a different table is rejected.
4. Confirm the refreshed view immediately shows the copied properties.
