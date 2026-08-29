import { describe, expect, it, vi } from 'vitest';

import {
    buildGallerySections,
    galleryMetadataValue,
    galleryGridClass,
    normalizeGalleryMetadataKey,
} from './vaultGalleryModel';


vi.mock('../schemaUtils', () => ({
    getFieldConfig: () => ({
        options: [{ color: 'red', name: 'Doing' }, { color: 'green', name: 'Done' }],
    }),
}));


describe('vaultGalleryModel', () => {
    it('resolves metadata keys without case or accents', () => {
        const note = { id: 'n1', metadata: { 'Àrea': 'Research' }, title: 'One' };
        expect(normalizeGalleryMetadataKey('Àrea')).toBe('area');
        expect(galleryMetadataValue(note, 'area')).toBe('Research');
    });

    it('groups multi-value notes and keeps ungrouped records last', () => {
        const sections = buildGallerySections([
            { id: 'n1', metadata: { Status: ['Done', 'Doing'] }, title: 'One' },
            { id: 'n2', metadata: {}, title: 'Two' },
        ], {}, { groupBy: 'Status' });
        expect(sections?.map(({ id }) => id)).toEqual([
            'g:Doing',
            'g:Done',
            '__gnosi_ungrouped__',
        ]);
        expect(sections?.[0]?.notes[0]?.id).toBe('n1');
    });

    it('uses responsive classes for each card size', () => {
        expect(galleryGridClass('small')).toContain('lg:grid-cols-5');
        expect(galleryGridClass('medium')).toContain('xl:grid-cols-4');
        expect(galleryGridClass('large')).toContain('2xl:grid-cols-3');
    });
});
