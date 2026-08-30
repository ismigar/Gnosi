import { describe, expect, it } from 'vitest';

import type { MediaItem } from '../../../../shared/api/media-browser';
import { filterMediaItems, normalizeMediaUrl } from './model';


function mediaItem(filename: string, kind: string): MediaItem {
    return {
        album: 'Trips',
        date_taken: null,
        description: '',
        extension: filename.split('.').at(-1) ?? '',
        filename,
        id: filename,
        kind,
        last_modified: '2026-08-29T00:00:00Z',
        location: null,
        path: `/vault/${filename}`,
        path_in_root: filename,
        root: 'images',
        size: 10,
        tags: [],
        url: `/api/vault/media/file/${filename}`,
    };
}


describe('media picker model', () => {
    it('normalizes only absolute API URLs', () => {
        expect(normalizeMediaUrl('https://localhost:5002/api/vault/media/file/a.jpg'))
            .toBe('/api/vault/media/file/a.jpg');
        expect(normalizeMediaUrl('https://cdn.example.test/a.jpg'))
            .toBe('https://cdn.example.test/a.jpg');
        expect(normalizeMediaUrl('')).toBe('');
        expect(normalizeMediaUrl(null)).toBe('');
    });

    it('filters by scalar or list kind and case-insensitive filename', () => {
        const items = [
            mediaItem('Sunset.JPG', 'image'),
            mediaItem('Notes.pdf', 'pdf'),
            mediaItem('Theme.mp3', 'audio'),
        ];
        expect(filterMediaItems(items, ' sunset ', null).map((item) => item.id))
            .toEqual(['Sunset.JPG']);
        expect(filterMediaItems(items, '', 'pdf').map((item) => item.id))
            .toEqual(['Notes.pdf']);
        expect(filterMediaItems(items, '', ['image', 'audio']).map((item) => item.id))
            .toEqual(['Sunset.JPG', 'Theme.mp3']);
    });
});
