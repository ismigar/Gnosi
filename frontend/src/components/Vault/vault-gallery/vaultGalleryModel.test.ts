import { describe, expect, it, vi } from 'vitest';

import {
    buildGallerySections,
    galleryCardSize,
    galleryCoverFitClass,
    galleryGroupField,
    galleryMetadataValue,
    galleryGridClass,
    galleryPreviewMode,
    galleryVisibleProperties,
    normalizeGalleryMetadataKey,
    type GalleryNote,
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

    it('keeps opaque, cyclic and non-JSON metadata and rows by identity', () => {
        const opaque = new Map([['entry', 4n]]);
        const metadata: Record<string, unknown> = { Status: 'Doing', 'Àrea': opaque };
        metadata.self = metadata;
        const note: GalleryNote = { id: 'n1', metadata, title: 42, resolved_table_id: opaque };
        expect(galleryMetadataValue(note, 'area')).toBe(opaque);
        expect(galleryMetadataValue(note, 'self')).toBe(metadata);
        expect(buildGallerySections([note], {}, { groupBy: 'Status' })?.[0]?.notes[0]).toBe(note);
        expect(note.metadata).toBe(metadata);
        expect(note.resolved_table_id).toBe(opaque);
    });

    it('accepts null metadata and absent, null and scalar titles without projecting rows', () => {
        const notes: readonly GalleryNote[] = [
            { id: 'missing' },
            { id: 'null', metadata: null, title: null },
            { id: 'number', metadata: {}, title: 0 },
            { id: 'boolean', metadata: {}, title: false },
            { id: 'bigint', metadata: {}, title: 42n },
        ];
        const section = buildGallerySections(notes, {}, { group_by: 'Status' })?.[0];
        expect(section?.id).toBe('__gnosi_ungrouped__');
        notes.forEach((note, index) => {
            expect(galleryMetadataValue(note, 'Status')).toBeUndefined();
            expect(section?.notes[index]).toBe(note);
        });
    });

    it('uses native property-key coercion without serializing metadata', () => {
        const symbol = Symbol('cover');
        const image = { src: 'https://example.test/cover.png' };
        const field = { toString() { return this.name; }, name: 'Cover' };
        const note = { id: 'n1', metadata: { Cover: image, [symbol]: image } };
        expect(galleryMetadataValue(note, field)).toBe(image);
        expect(galleryMetadataValue(note, symbol)).toBe(image);
        const failure = new Error('imported key failure');
        expect(() => galleryMetadataValue(note, { toString() { throw failure; } })).toThrow(failure);
        expect(() => galleryMetadataValue({ id: 'n2', metadata: {
            get Cover() { throw failure; },
        } }, 'Cover')).toThrow(failure);
    });

    it('retains scalar grouping, catalog order, aliases and count sorting', () => {
        const notes: readonly GalleryNote[] = [
            { id: 'n1', metadata: { Status: [false, 0, 4n, 'Done', ' '] } },
            { id: 'n2', metadata: { Status: 'Done' } },
            { id: 'n3', metadata: { Status: {} } },
        ];
        const sections = buildGallerySections(notes, {}, {
            group_by: 'Status', group_sort: 'count', group_sort_dir: 'desc',
        });
        expect(sections?.[0]?.name).toBe('Done');
        expect(sections?.at(-1)?.id).toBe('__gnosi_ungrouped__');
        expect(sections?.find(({ name }) => name === 'false')?.notes[0]).toBe(notes[0]);
        expect(sections?.find(({ name }) => name === '0')?.notes[0]).toBe(notes[0]);
        expect(sections?.find(({ name }) => name === '4')?.notes[0]).toBe(notes[0]);
    });

    it('narrows open display settings with their original fallback behavior', () => {
        const extension = new Map();
        expect(galleryCardSize(extension)).toBe('medium');
        expect(galleryCardSize('small')).toBe('small');
        expect(galleryCardSize('large')).toBe('large');
        expect(galleryPreviewMode(undefined)).toBe('cover');
        expect(galleryPreviewMode(null)).toBe('cover');
        expect(galleryPreviewMode(extension)).toBe('none');
        expect(galleryPreviewMode('')).toBe('none');
        expect(galleryPreviewMode('content')).toBe('content');
        expect(galleryPreviewMode('properties')).toBe('properties');
        expect(galleryCoverFitClass(extension)).toBe('bg-contain');
        expect(galleryCoverFitClass('cover')).toBe('bg-cover');
        expect(galleryGroupField({ groupBy: '', group_by: 'Status' })).toBe('');
        expect(galleryGroupField({ groupBy: null, group_by: 'Status' })).toBe('Status');
        const properties = ['Status'];
        expect(galleryVisibleProperties(properties)).toBe(properties);
        expect(galleryVisibleProperties([])).toBeUndefined();
        expect(galleryVisibleProperties({ length: 0 })).toBeUndefined();
        expect(galleryVisibleProperties(new Map())).toBeUndefined();
        expect(galleryVisibleProperties(false)).toBeUndefined();
        expect(galleryVisibleProperties('ab')).toEqual(['a', 'b']);
        expect(() => galleryVisibleProperties(['Status', extension])).toThrow(TypeError);
    });
});
