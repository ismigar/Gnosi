type MetadataValue = string | number | boolean | null | undefined;

type VaultMetadata = Record<string, MetadataValue> & {
  llm_wiki_managed?: MetadataValue;
  llm_wiki_role?: MetadataValue;
  note_type?: MetadataValue;
};

interface VaultQuickNote<Id = string> {
  [key: string]: unknown;
  id?: Id | null;
  filename?: MetadataValue;
  last_modified?: string | number | Date | null;
  metadata?: VaultMetadata | null;
  title?: MetadataValue;
}

const normalizeMetadataValue = (value: MetadataValue): string =>
  String(value ?? '').trim().toLocaleLowerCase();

const LEGACY_INDEX_TYPES = new Set([
  'index',
  'index note',
  'nota index',
  'nota índex',
  'nota índice',
  'note index',
]);

const INDEX_TITLE_PATTERN = /^(index|índex|índice)(?:\s|·|$)/i;

export function openVaultNote<Id>(
  onNoteSelect: ((id: Id) => void) | null | undefined,
  note: VaultQuickNote<Id> | null | undefined,
): boolean {
  if (typeof onNoteSelect !== 'function' || !note?.id) return false;
  onNoteSelect(note.id);
  return true;
}

export function isGeneratedIndexNote(
  note: VaultQuickNote | null | undefined,
): boolean {
  const metadata: VaultMetadata = note?.metadata || {};
  const managed =
    metadata.llm_wiki_managed === true ||
    normalizeMetadataValue(metadata.llm_wiki_managed) === 'true';
  const role = normalizeMetadataValue(metadata.llm_wiki_role);
  const canonicalType = normalizeMetadataValue(metadata.note_type);

  if (managed && (canonicalType === 'index' || role.includes('index'))) {
    return true;
  }

  const legacyType = [
    metadata['Tipus de nota'],
    metadata['Tipo de nota'],
    metadata['Type de note'],
    metadata['Note type'],
  ]
    .map(normalizeMetadataValue)
    .find(Boolean);
  const title = String(note?.title || note?.filename || '').trim();

  return (
    LEGACY_INDEX_TYPES.has(legacyType ?? '') && INDEX_TITLE_PATTERN.test(title)
  );
}

export function selectRecentNotes<
  T extends VaultQuickNote | null | undefined,
>(notes: readonly T[] | null | undefined, limit = 20): T[] {
  const sorted = [...(notes || [])].sort((a, b) => {
    const dateA = new Date(a?.last_modified || 0).getTime();
    const dateB = new Date(b?.last_modified || 0).getTime();
    return dateB - dateA;
  });
  const userNotes = sorted.filter((note) => !isGeneratedIndexNote(note));
  return (userNotes.length > 0 ? userNotes : sorted).slice(0, limit);
}
