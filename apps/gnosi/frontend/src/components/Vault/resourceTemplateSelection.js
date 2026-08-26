import { ALL_ITEM_TYPES, LABEL_TO_ZOTERO_TYPE } from './zoteroSchema';

const LEGACY_ITEM_TYPE_TO_ZOTERO = Object.freeze({
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

/** Resolves a stored or imported resource type to its Zotero identifier. */
export function resolveResourceDocumentType(value) {
    if (!value || typeof value !== 'string') return null;
    if (LEGACY_ITEM_TYPE_TO_ZOTERO[value]) return LEGACY_ITEM_TYPE_TO_ZOTERO[value];
    if (ALL_ITEM_TYPES.includes(value)) return value;
    for (const labels of Object.values(LABEL_TO_ZOTERO_TYPE)) {
        if (labels[value]) return labels[value];
    }
    return null;
}

/**
 * Selects the template matching an imported document type. A table's default
 * template remains the fallback when no typed template matches.
 */
export function selectResourceTemplate(templates = [], suggestedMetadata = {}) {
    const documentType = resolveResourceDocumentType(
        suggestedMetadata?.['Item Type'] || suggestedMetadata?.item_type || suggestedMetadata?.itemType,
    );
    if (documentType) {
        const typedTemplate = templates.find((template) => resolveResourceDocumentType(
            template?.metadata?.['Item Type'] || template?.metadata?.item_type || template?.metadata?.itemType,
        ) === documentType);
        if (typedTemplate) return typedTemplate;
    }
    return templates.find((template) => template?.metadata?.is_default_template) || null;
}
