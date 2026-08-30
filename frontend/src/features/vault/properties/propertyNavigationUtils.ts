interface PropertyQueryRoot {
  querySelectorAll(selector: string): ArrayLike<HTMLElement>;
}

function hasPropertyQuery(
  root: unknown,
): root is PropertyQueryRoot {
  if (
    (typeof root !== 'object' && typeof root !== 'function') ||
    root === null ||
    !('querySelectorAll' in root)
  ) {
    return false;
  }
  return typeof root.querySelectorAll === 'function';
}

export function focusPropertyRow(
  root?: unknown,
  propertyName?: unknown,
): boolean {
  if (!root || !propertyName || !hasPropertyQuery(root)) return false;

  const row = Array.from(root.querySelectorAll('[data-prop-row]')).find(
    (candidate) =>
      candidate.getAttribute('data-prop-row') === propertyName,
  );
  if (!row) return false;

  row.focus({ preventScroll: true });
  if (typeof row.scrollIntoView === 'function') {
    row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  return true;
}
