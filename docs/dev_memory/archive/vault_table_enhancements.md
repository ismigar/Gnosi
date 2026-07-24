# Vault Table Enhancements

> Historical proposal; newer grid and formatting directives supersede parts of
> this document.

## Objective

Support inline typed editing, sticky headers, aggregations, and scalable table
rendering.

## Requirements

- Use an editor appropriate to each field type.
- Validate and save on the intended keyboard or blur action.
- Patch only the affected property.
- Calculate sum, average, and count from current rows.
- Render totals through the same locale-aware format as their column.
- Keep derived values read-only.
- Normalize dates before persistence.
- Virtualize large tables.

Concurrent editing requires optimistic concurrency or field-level merge;
last-writer-wins whole-file replacement is not an acceptable long-term model.

All visible labels use i18n with English defaults.
