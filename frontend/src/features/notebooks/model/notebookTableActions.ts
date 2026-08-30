export function canCreateNotebookFromTable(
  referenceTableId: string | null | undefined,
  openTableId: string | null | undefined,
): boolean {
  const configured = (referenceTableId ?? '').trim();
  const current = (openTableId ?? '').trim();
  return Boolean(configured && current && configured === current);
}
