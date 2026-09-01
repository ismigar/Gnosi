import type { TableRowRecord } from './rowTypes';

const ALIASES: Readonly<Record<string, string | readonly string[]>> = {
  'date added': 'created_time',
  'date modified': 'last_edited_time',
  id: ['id', 'gnosi_id', 'source_id'],
};

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gi, '');
}

/** Preserve first-own-key resolution and the historical id fallback ordering. */
export function getMetaKey(note: Pick<TableRowRecord, 'metadata'> | null | undefined, field: string): string {
  const schemaKey = normalizeKey(field);
  const mapped = ALIASES[schemaKey];
  const metadata = note?.metadata;
  if (mapped && typeof mapped !== 'string') {
    if (!metadata) return field;
    const exact = mapped.find(key => Object.hasOwn(metadata, key));
    if (exact) return exact;
    for (const fallback of mapped) {
      const normalized = normalizeKey(fallback);
      const found = Object.keys(metadata).find(key => normalizeKey(key) === normalized);
      if (found) return found;
    }
    return field;
  }
  const target = mapped ? normalizeKey(mapped) : schemaKey;
  return metadata ? Object.keys(metadata).find(key => normalizeKey(key) === target) || field : field;
}

export function getMetadataValueByNormalizedKey(metadata: unknown, possibleKeys: readonly string[]): unknown {
  if (!metadata || typeof metadata !== 'object') return '';
  for (const key of possibleKeys) {
    const normalized = normalizeKey(key);
    const found = Object.keys(metadata).find(candidate => normalizeKey(candidate) === normalized);
    if (!found) continue;
    const value: unknown = Reflect.get(metadata, found);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}
