type GroupKey = string | number | bigint | boolean | null | undefined;

interface GroupOrderOptions<Key extends GroupKey> {
  direction?: string;
  emptyKey?: Key;
  getCount?: (key: Key) => number;
  getLabel?: (key: Key) => GroupKey;
  keys?: readonly Key[];
  mode?: string;
}

/**
 * Orders view groups while keeping the empty-value bucket at the end.
 *
 * Catalog order is the incoming key order. Alphabetical order uses the
 * user-visible label, and count order uses each bucket's record count.
 */
export function orderGroupKeys<Key extends GroupKey = string>({
  keys = [],
  mode = 'catalog',
  direction = 'asc',
  emptyKey,
  getLabel = (key) => key,
  getCount = () => 0,
}: GroupOrderOptions<Key> = {}): Key[] {
  const factor = direction === 'desc' ? -1 : 1;
  const catalogIndex = new Map(
    keys.map((key, index) => [key, index]),
  );
  const getCatalogIndex = (key: Key): number =>
    catalogIndex.get(key) ?? -1;
  const emptyKeys = keys.filter((key) => key === emptyKey);
  const ordered = keys.filter((key) => key !== emptyKey);

  if (mode === 'alpha') {
    ordered.sort(
      (a, b) =>
        (String(getLabel(a) ?? '').localeCompare(
          String(getLabel(b) ?? ''),
          undefined,
          { numeric: true },
        ) ||
          getCatalogIndex(a) - getCatalogIndex(b)) *
        factor,
    );
  } else if (mode === 'count') {
    ordered.sort(
      (a, b) =>
        (getCount(a) - getCount(b) ||
          getCatalogIndex(a) - getCatalogIndex(b)) *
        factor,
    );
  } else if (factor === -1) {
    ordered.reverse();
  }

  return [...ordered, ...emptyKeys];
}
