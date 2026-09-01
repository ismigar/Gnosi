import { afterEach, describe, expect, it } from 'vitest';

import { emitAppEvent } from '../../platform/app-events';
import {
    formatHoverMetadataValue,
    invalidateHoverPreviewCache,
    normalizeHoverPreview,
    pickHoverWebUrl,
    readHoverPreviewCache,
    visibleHoverProperties,
    writeHoverPreviewCache,
} from './pageHoverCardModel';


afterEach(() => {
    invalidateHoverPreviewCache();
});


describe('pageHoverCardModel', () => {
    it('normalizes nullable and unknown preview fields', () => {
        expect(normalizeHoverPreview({
            body_md: null,
            cover: { src: '/cover.png' },
            excerpt: '',
            icon: 42,
            id: 'page-1',
            title: { value: 'Unknown title' },
        })).toEqual({ body: '', cover: '', icon: '', title: '' });
    });

    it('formats scalar, relation-label, array, and image metadata values', () => {
        expect(formatHoverMetadataValue('[[page-id|Readable page]]')).toBe('page-id');
        expect(formatHoverMetadataValue(['alpha', 2, false])).toBe('alpha, 2, false');
        expect(formatHoverMetadataValue({ src: '/asset.png' })).toBe('/asset.png');
    });

    it('hides internal and relation fields while retaining readable properties', () => {
        expect(visibleHoverProperties({
            Drupal_NID: 30,
            database_table_id: 'hidden',
            owner: 'Ada',
            relation: '[[target-id|Target]]',
            status: ['Draft', 'Reviewed'],
        })).toEqual([
            ['Drupal_NID', '30'],
            ['owner', 'Ada'],
            ['status', 'Draft, Reviewed'],
        ]);
    });

    it('selects a valid web URL and invalidates cached previews through app events', () => {
        const preview = { excerpt: '', id: 'page-2', title: 'Cached' };
        writeHoverPreviewCache('page-2', preview);

        expect(pickHoverWebUrl({ url: 'ftp://invalid', URL: 'https://example.test/page' }))
            .toBe('https://example.test/page');
        expect(readHoverPreviewCache('page-2')).toEqual(preview);

        emitAppEvent('gnosi:invalidatePreview', { pageId: 'page-2' });
        expect(readHoverPreviewCache('page-2')).toBeNull();
    });
});
