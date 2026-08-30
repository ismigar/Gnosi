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
  return [...safeItems].sort((left, right) =>
    String(getLabel(left) || '').localeCompare(
      String(getLabel(right) || ''),
      locale,
      { sensitivity: 'base', numeric: true },
    ),
  );
}
