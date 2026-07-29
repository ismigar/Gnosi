/**
 * Returns whether a metadata key belongs to Gnosi's managed implementation
 * details and must not be exposed as a user-created local property.
 */
export function isManagedInternalMetadataKey(key) {
    const normalized = String(key || '').trim().toLowerCase();
    return normalized === 'note_type' || normalized.startsWith('llm_wiki_');
}
