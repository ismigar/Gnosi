import type {MediaRoot, MediaView} from '../../../shared/api/media-browser';
import {DEFAULT_FILTERS, DEFAULT_SORT, type MediaAsset} from './model';

/** Synthetic fixtures shared by focused tests; never contain user media. */
export function mediaAsset(id = 'fixture-image', kind = 'image'): MediaAsset {
    return {id, filename: id + '.png', kind, root: 'images', album: 'Fixture album',
        path: '/fixture/' + id, path_in_root: 'Fixture album/' + id,
        url: '/api/vault/media/file/' + id, size: 1024, tags: ['fixture'],
        description: 'Synthetic media', date_taken: '2026-08-01', extension: '.png',
        last_modified: '2026-08-01', location: null};
}
export const MEDIA_ROOTS: MediaRoot[] = [
    {key: 'images', label: 'Images', available: true, url_prefix: '/api/vault/media'},
    {key: 'assets', label: 'Assets', available: true, url_prefix: '/api/vault/assets'},
    {key: 'nextcloud', label: 'Nextcloud fixture', available: true, url_prefix: '/api/vault/media'},
    {key: 'offline', label: 'Unavailable', available: false, url_prefix: '/api/vault/media'},
];
export function savedView(): MediaView {
    return {id: 'fixture-view', label: 'Nextcloud photographs', created_at: '2026-08-01',
        updated_at: '2026-08-01', scope: {root: 'nextcloud', album: 'Photos/2026'},
        filters: {...DEFAULT_FILTERS, kinds: ['image'], tagsAny: ['fixture']},
        sort: {...DEFAULT_SORT, field: 'filename', dir: 'asc'}};
}
