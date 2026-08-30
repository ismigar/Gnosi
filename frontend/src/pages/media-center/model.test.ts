import {afterEach, describe, expect, it, vi} from 'vitest';
import {DEFAULT_FILTERS, DEFAULT_SORT, isoDaysAgo, mediaQuery, normalizeUrl, viewFilters} from './model';
import {savedView} from './fixtures';

afterEach(() => {vi.useRealTimers();});
describe('media model contracts', () => {
    it('preserves relative and external URLs and rewrites only absolute backend API URLs', () => {
        expect(normalizeUrl('')).toBe('');
        expect(normalizeUrl('/api/vault/file?a=1')).toBe('/api/vault/file?a=1');
        expect(normalizeUrl('https://backend.example.test/api/vault/file?a=1')).toBe('/api/vault/file?a=1');
        expect(normalizeUrl('https://example.test/photo.png')).toBe('https://example.test/photo.png');
    });
    it('keeps arbitrary root/provider keys and does not send inactive filters or default sorting', () => {
        expect(mediaQuery('google-drive', '', 0, {...DEFAULT_FILTERS}, {...DEFAULT_SORT}))
            .toEqual({root: 'google-drive', limit: 50, offset: 0});
    });
    it('retains kind OR filters, trimmed query, tags, date bounds, sizes and sorting', () => {
        expect(mediaQuery('nextcloud', 'Photos/2026', 50, {...DEFAULT_FILTERS, kinds: ['image', 'video'],
            q: ' family ', tagsAny: ['one','two'], mtimeFrom: '2026-08-01', mtimeTo: '2026-08-30',
            sizePreset: 'medium'}, {field: 'filename', dir: 'asc'})).toEqual({
                root: 'nextcloud', album: 'Photos/2026', limit: 50, offset: 50, kinds: 'image,video',
                q: 'family', tags_any: 'one,two', mtime_from: '2026-08-01', mtime_to: '2026-08-30',
                size_min: 500, size_max: 5120, sort: 'filename', dir: 'asc',
            });
    });
    it('preserves unknown saved-view fields while narrowing legacy JSON arrays', () => {
        const view = savedView();
        expect(viewFilters({...view, filters: {...DEFAULT_FILTERS, kinds: ['image', 2],
            tagsAny: ['fixture', null], custom: {retained: true}}})).toEqual({
                ...DEFAULT_FILTERS, kinds: ['image'], tagsAny: ['fixture'], custom: {retained: true},
            });
    });
    it('uses local calendar arithmetic for date presets', () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-30T12:00:00Z'));
        expect(isoDaysAgo(7)).toBe('2026-08-23');
    });
});
