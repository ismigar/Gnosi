import { describe, expect, it } from 'vitest';
import { sourceSectionOptions, sourceSectionTitle } from './sourceSectionRelations';
import { matchesRule } from '../../../shared/filtering/vaultFilters';

describe('source section relations', () => {
    const config = { relation_database_id: 'sections', source_sections: true };
    const metadata = { llm_wiki_resource_id: 'book', llm_wiki_source_table_id: 'sources' };
    const notes = [
        { id: 'child', title: 'Book › Chapter › Examples', metadata: { ...metadata, table_id: 'sections', llm_wiki_section_path: 'Chapter › Examples', llm_wiki_section_order: [0, 2, 2] } },
        { id: 'other', title: 'Other book › Chapter', metadata: { ...metadata, table_id: 'sections', llm_wiki_resource_id: 'other-book', llm_wiki_section_order: [0, 1, 1] } },
        { id: 'parent', title: 'Book › Chapter', metadata: { ...metadata, table_id: 'sections', llm_wiki_section_path: 'Chapter', llm_wiki_section_order: [0, 1, 1] } },
    ];
    it('offers only the current source sections in source order', () => {
        expect(sourceSectionOptions(notes, config, metadata).map(note => note.id)).toEqual(['parent', 'child']);
        expect(sourceSectionOptions(notes, config).map(note => note.id)).toEqual([]);
        expect(sourceSectionOptions([{ ...notes[0], id: 'stale', metadata: { ...metadata,
            table_id: 'sections', llm_wiki_section_stale: true } }], config, metadata)).toEqual([]);
        const child = notes[0];
        if (!child) throw new Error('Missing section fixture');
        expect(sourceSectionTitle(child, true)).toBe('Chapter › Examples');
    });
    it('keeps ordinary relation options unchanged', () => {
        expect(sourceSectionOptions(notes, { relation_database_id: 'sections' }).map(note => note.id)).toEqual(['child', 'other', 'parent']);
    });
    it('distinguishes exact sections from including their subsections', () => {
        const note = { metadata: { Apartat: ['child'], llm_wiki_section_field: 'Apartat', llm_wiki_section_ancestor_ids: ['parent'] } };
        expect(matchesRule(note, { field: 'Apartat', operator: 'equals', value: 'child' })).toBe(true);
        expect(matchesRule(note, { field: 'Apartat', operator: 'equals', value: 'parent' })).toBe(false);
        expect(matchesRule(note, { field: 'Apartat', operator: 'contains', value: 'parent' })).toBe(true);
        expect(matchesRule(note, { field: 'Apartat', operator: 'not_contains', value: 'parent' })).toBe(false);
        expect(matchesRule(note, { field: 'Apartat', operator: 'is_empty' })).toBe(false);
    });
});
