import { describe, expect, it } from 'vitest';
import { groupValueKeys, groupValueLabel, readGroupValue } from './groupValueUtils';
import { readGroupFieldValue } from './groupFieldValue';
import { buildGallerySections } from './vault-gallery/vaultGalleryModel';

describe('grouping all field types', () => {
    it('preserves zero and false and deduplicates multiple values', () => {
        expect(groupValueKeys([0, false, '', null, 0, 'Area'])).toEqual(['0', 'false', 'Area']);
    });
    it('groups structured values canonically with readable file and period labels', () => {
        const first = groupValueKeys({ start: '2026-09-29', end: '2026-10-01' })[0];
        expect(first).toBe(groupValueKeys({ end: '2026-10-01', start: '2026-09-29' })[0]);
        expect(groupValueLabel(first ?? '')).toContain('2026-09-29');
        expect(groupValueLabel(groupValueKeys({ name: 'Book.pdf', url: '/file' })[0] ?? '')).toBe('Book.pdf');
    });
    it('uses page titles, stable field ids and explicit empty values', () => {
        const note = { title: 'Project', metadata: { field123: ['area1'], Area: '' } };
        expect(readGroupValue(note, 'title')).toBe('Project');
        expect(readGroupValue(note, 'Area', 'field123')).toBe('');
        expect(readGroupValue(note, 'Renamed', 'field123')).toEqual(['area1']);
    });
    it('renders relation titles while preserving distinct identities and missing values', () => {
        const notes = [{ id: 'a', metadata: { areaId: ['one', 'two', 'one'] } }, { id: 'b' }];
        const groups = buildGallerySections(notes, { Area: 'relation', Area_config: { id: 'areaId' } },
            { groupBy: 'Area', groupSort: 'alpha' }, { one: 'Same title', two: 'Same title' });
        expect(groups?.map(group => group.id)).toEqual(['g:one', 'g:two', '__gnosi_ungrouped__']);
        expect(groups?.slice(0, 2).map(group => [group.name, group.notes.length])).toEqual([['Same title', 1], ['Same title', 1]]);
    });
    it('groups checkbox, formula and rollup results using their field semantics', () => {
        const note = { id: 'a', title: 'Project', metadata: { Done: 'false', Score: 3, Links: ['b'] } };
        const schema = { Done: 'checkbox', Formula: 'formula', Formula_config: { formula: "prop('Score') * 2" },
            Rollup: 'rollup', Rollup_config: { relationField: 'Links', targetProperty: 'Score', aggregation: 'sum' } };
        expect(readGroupFieldValue(note, 'Done', schema)).toBe(false);
        expect(readGroupFieldValue(note, 'Formula', schema)).toBe(6);
        expect(readGroupFieldValue(note, 'Rollup', schema, [{ id: 'b', metadata: { Score: 4 } }])).toBe(4);
    });
    it('groups by title and structured calculated values', () => {
        expect(buildGallerySections([{ id: 'a', title: 'Project' }], {}, { groupBy: 'title' })?.[0]?.name).toBe('Project');
        const groups = buildGallerySections([{ id: 'a', metadata: { Result: { total: 2 } } }], {}, { groupBy: 'Result' });
        expect(groups?.[0]?.name).toBe('total: 2');
    });
});
