export function focusPropertyRow(root, propertyName) {
    if (!root || !propertyName || typeof root.querySelectorAll !== 'function') return false;

    const row = Array.from(root.querySelectorAll('[data-prop-row]'))
        .find(candidate => candidate.getAttribute('data-prop-row') === propertyName);
    if (!row) return false;

    row.focus({ preventScroll: true });
    if (typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    return true;
}
