/**
 * Returns whether a metadata key belongs to Gnosi's managed implementation
 * details and must not be exposed as a user-created local property.
 */
export function isManagedInternalMetadataKey(key) {
    const normalized = String(key || '').trim().toLowerCase();
    return normalized === 'note_type' || normalized.startsWith('llm_wiki_');
}

/**
 * Returns whether document-oriented knowledge panels belong on this page.
 * Dashboards are composed views, so their internal metadata and link graph are
 * not exposed as if the Dashboard itself were a knowledge document.
 */
export function shouldShowKnowledgePanels(metadata) {
    return metadata?.is_dashboard !== true;
}
