type SortableLabel = string | number | boolean | null | undefined;

function defaultFieldLabel(item: unknown): SortableLabel {
  if (typeof item !== 'object' || item === null) return '';
  const field = item as {
    id?: SortableLabel;
    name?: SortableLabel;
  };
  return field.name || field.id || '';
}

/**
 * Return a copy of field-like items sorted by their visible label.
 *
 * Pickers are navigation aids, so their order must not inherit API response
 * order or a persisted schema's column layout. Callers keep any sentinel
 * options outside this helper so "None" and similar actions stay first.
 */
export function sortFieldItems<T>(
  items: readonly T[] | null | undefined = [],
  getLabel: (item: T) => SortableLabel = defaultFieldLabel,
  locale?: string,
): T[] {
  const safeItems: readonly T[] = Array.isArray(items) ? items : [];
  const sorted = [...safeItems];
  if (sorted.length < 2) return sorted;
  // Reuse the locale rules for all comparisons in this sort. Passing options
  // to localeCompare for every pair rebuilds the same collator thousands of times.
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return sorted.sort((left, right) =>
    collator.compare(String(getLabel(left) || ''), String(getLabel(right) || '')),
  );
}
