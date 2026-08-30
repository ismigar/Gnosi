/**
 * Bidirectional mapping between Recursos columns and Zotero fields.
 * Keep this Gnosi-specific mapping aligned with the backend mirror.
 */
import { ITEM_TYPE_FIELDS } from './zoteroSchema';

export const RECURSOS_TO_ZOTERO_FIELDS: Readonly<
  Record<string, readonly string[]>
> = {
  'Item Type': ['itemType'],
  Title: ['title'],
  Authors: ['creators'],
  Any: ['date'],
  'Llibre/Revista': [
    'publicationTitle',
    'bookTitle',
    'proceedingsTitle',
    'encyclopediaTitle',
  ],
  Editorial: ['publisher'],
  Lloc: ['place'],
  Volum: ['volume'],
  Número: ['issue'],
  Pàgines: ['pages'],
  'Núm. pàgines': ['numPages'],
  Edició: ['edition'],
  DOI: ['DOI'],
  ISBN: ['ISBN'],
  ISSN: ['ISSN'],
  PMID: ['PMID'],
  URL: ['url'],
  Idioma: ['language'],
};

// Inverse: zoteroField → first Recursos column that mentions it.
export const ZOTERO_FIELD_TO_RECURSOS: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(RECURSOS_TO_ZOTERO_FIELDS).flatMap(
      ([column, fields]) => fields.map((field) => [field, column]),
    ),
  );

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((field: unknown) => typeof field === 'string')
  );
}

/** True when a Recursos column is available for a Zotero item type. */
export function isFieldRelevantForType(
  recursosField?: string,
  zoteroItemType?: string,
): boolean {
  const candidates = RECURSOS_TO_ZOTERO_FIELDS[recursosField ?? ''];
  if (!candidates) return false;
  const itemTypeCatalog: unknown = ITEM_TYPE_FIELDS;
  const typeFields = isUnknownRecord(itemTypeCatalog)
    ? itemTypeCatalog[zoteroItemType ?? '']
    : undefined;
  if (!isStringArray(typeFields)) return false;
  return candidates.some((candidate) => typeFields.includes(candidate));
}
