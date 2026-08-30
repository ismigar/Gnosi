import {
  ALL_ITEM_TYPES,
  LABEL_TO_ZOTERO_TYPE,
} from '../../../shared/citations/zoteroSchema';

const LEGACY_ITEM_TYPE_TO_ZOTERO: Readonly<Record<string, string>> =
  Object.freeze({
    'Article científic': 'journalArticle',
    'Article de revista': 'journalArticle',
    'Article divulgatiu': 'magazineArticle',
    Tesis: 'thesis',
    Manual: 'book',
    'Secció de Llibre': 'bookSection',
    Ponència: 'conferencePaper',
    Curs: 'document',
    Relat: 'document',
    Document: 'document',
    Vídeo: 'videoRecording',
    'Entrevista/testimoni': 'interview',
  });

interface ResourceMetadata {
  'Item Type'?: unknown;
  is_default_template?: unknown;
  itemType?: unknown;
  item_type?: unknown;
}

interface ResourceTemplate {
  metadata?: ResourceMetadata | null;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Resolves a stored or imported resource type to its Zotero identifier. */
export function resolveResourceDocumentType(value?: unknown): string | null {
  if (!value || typeof value !== 'string') return null;
  const legacyType = LEGACY_ITEM_TYPE_TO_ZOTERO[value];
  if (legacyType) return legacyType;
  if (ALL_ITEM_TYPES.includes(value)) return value;
  const labelCatalogues: readonly unknown[] = Object.values(
    LABEL_TO_ZOTERO_TYPE,
  );
  for (const labels of labelCatalogues) {
    if (!isUnknownRecord(labels)) continue;
    const resolvedType = labels[value];
    if (typeof resolvedType === 'string' && resolvedType) {
      return resolvedType;
    }
  }
  return null;
}

/** Selects a typed resource template, falling back to the table default. */
export function selectResourceTemplate<Template extends ResourceTemplate>(
  templates: readonly (Template | null | undefined)[] = [],
  suggestedMetadata: ResourceMetadata | null | undefined = {},
): Template | null {
  const documentType = resolveResourceDocumentType(
    suggestedMetadata?.['Item Type'] ||
      suggestedMetadata?.item_type ||
      suggestedMetadata?.itemType,
  );
  if (documentType) {
    const typedTemplate = templates.find(
      (template) =>
        resolveResourceDocumentType(
          template?.metadata?.['Item Type'] ||
            template?.metadata?.item_type ||
            template?.metadata?.itemType,
        ) === documentType,
    );
    if (typedTemplate) return typedTemplate;
  }
  return (
    templates.find(
      (template) => template?.metadata?.is_default_template,
    ) || null
  );
}
