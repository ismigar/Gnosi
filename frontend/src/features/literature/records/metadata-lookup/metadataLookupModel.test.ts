import { describe, expect, it } from 'vitest';

import {
    groupMetadataEntries,
    initialFieldSelection,
    normalizeLookupResult,
    resolveZoteroType,
    selectedMetadataPatch,
    zoteroTypeLabel,
} from './metadataLookupModel';


describe('metadata lookup model', () => {
    it('resolves canonical and translated Zotero item types', () => {
        expect(resolveZoteroType('journalArticle')).toBe('journalArticle');
        expect(resolveZoteroType('Article de revista acadèmica')).toBe(
            'journalArticle',
        );
        expect(resolveZoteroType('unknown')).toBeNull();
        expect(zoteroTypeLabel('journalArticle', 'ca')).toBe(
            'Article de revista acadèmica',
        );
    });

    it('groups fields according to the generated Zotero schema', () => {
        const grouped = groupMetadataEntries({
            'Camp personal': 'keep',
            DOI: '10.1234/example',
            'Item Type': 'journalArticle',
            Title: 'Evidence',
        });

        expect(grouped.zoteroType).toBe('journalArticle');
        expect(grouped.relevantEntries.map(([key]) => key)).toEqual([
            'DOI',
            'Title',
        ]);
        expect(grouped.otherEntries).toEqual([['Camp personal', 'keep']]);
    });

    it('selects only empty current fields and builds the exact patch', () => {
        const suggested = { DOI: 'new-doi', Title: 'New title' };
        const selection = initialFieldSelection(suggested, { Title: 'Existing' });

        expect(selection).toEqual({ DOI: true, Title: false });
        expect(selectedMetadataPatch(suggested, selection)).toEqual({
            DOI: 'new-doi',
        });
    });

    it('normalizes PDF responses without inventing an identifier', () => {
        expect(normalizeLookupResult({
            error: null,
            identifiers: { doi: '10.1234/example' },
            source: 'pdf',
            suggested: { Title: 'PDF title' },
        })).toEqual({
            error: null,
            identifier: null,
            source: 'pdf',
            suggested: { Title: 'PDF title' },
        });
    });
});
