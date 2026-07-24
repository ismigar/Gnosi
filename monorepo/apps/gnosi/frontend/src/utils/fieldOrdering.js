/**
 * Return a copy of field-like items sorted by their visible label.
 *
 * Pickers are navigation aids, so their order must not inherit API response
 * order or a persisted schema's column layout. Callers keep any sentinel
 * options outside this helper so "None" and similar actions stay first.
 *
 * @param {Array} items Field-like items.
 * @param {(item: unknown) => string} getLabel Visible-label accessor.
 * @param {string | undefined} locale Active UI locale.
 * @returns {Array} Sorted copy of items.
 */
export function sortFieldItems(items = [], getLabel = (item) => item?.name || item?.id || '', locale) {
    return [...(Array.isArray(items) ? items : [])].sort((left, right) => (
        String(getLabel(left) || '').localeCompare(
            String(getLabel(right) || ''),
            locale,
            { sensitivity: 'base', numeric: true },
        )
    ));
}
