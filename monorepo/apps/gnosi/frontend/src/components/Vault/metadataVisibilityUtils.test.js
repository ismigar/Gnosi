import { describe, expect, it } from 'vitest';
import { isManagedInternalMetadataKey } from './metadataVisibilityUtils';

describe('isManagedInternalMetadataKey', () => {
    it('hides Brain implementation metadata from local properties', () => {
        expect(isManagedInternalMetadataKey('note_type')).toBe(true);
        expect(isManagedInternalMetadataKey('llm_wiki_resource_id')).toBe(true);
        expect(isManagedInternalMetadataKey('LLM_WIKI_STALE')).toBe(true);
    });

    it('keeps genuine local properties visible', () => {
        expect(isManagedInternalMetadataKey('Àrea personal')).toBe(false);
        expect(isManagedInternalMetadataKey('Projecte')).toBe(false);
    });
});
