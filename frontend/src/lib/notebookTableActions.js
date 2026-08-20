export function canCreateNotebookFromTable(referenceTableId, openTableId) {
    const configured = String(referenceTableId || '').trim();
    const current = String(openTableId || '').trim();
    return Boolean(configured && current && configured === current);
}
