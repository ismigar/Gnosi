import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchCslStyles } from '../api/citation-io';
import {
    AVAILABLE_STYLES,
    fetchAvailableStyles,
    invalidateAvailableStylesCache,
    recursosPageToCsl,
    resolveCslType,
} from './cslEngine';

vi.mock('../api/citation-io', () => ({
    fetchCslStyles: vi.fn(),
}));

vi.mock('../api/transports', () => ({
    transportFetch: vi.fn(),
}));

vi.mock('../notifications/notifyError', () => ({
    logError: vi.fn(),
}));

vi.mock('citeproc', () => ({
    default: {
        Engine: class CiteprocEngineMock {
            readonly mock = true;
        },
    },
}));

const fetchCslStylesMock = vi.mocked(fetchCslStyles);

beforeEach(() => {
    fetchCslStylesMock.mockReset();
    invalidateAvailableStylesCache();
});

describe('cslEngine catalog', () => {
    it('caches the mapped backend catalog until invalidated', async () => {
        fetchCslStylesMock.mockResolvedValue([
            { file: 'custom.csl', id: 'custom', title: 'Custom Style' },
        ]);

        await expect(fetchAvailableStyles()).resolves.toEqual([
            {
                file: 'custom.csl',
                id: 'custom',
                label: 'Custom Style',
                locale: 'en-US',
            },
        ]);
        await fetchAvailableStyles();
        expect(fetchCslStylesMock).toHaveBeenCalledOnce();

        invalidateAvailableStylesCache();
        await fetchAvailableStyles();
        expect(fetchCslStylesMock).toHaveBeenCalledTimes(2);
    });

    it('supports forced refresh and retains bundled styles as offline fallback', async () => {
        fetchCslStylesMock.mockResolvedValue([
            { file: 'first.csl', id: 'first', title: null },
        ]);
        await fetchAvailableStyles();
        fetchCslStylesMock.mockRejectedValueOnce(new Error('offline'));

        await expect(fetchAvailableStyles({ force: true })).resolves.toBe(
            AVAILABLE_STYLES,
        );
        expect(fetchCslStylesMock).toHaveBeenCalledTimes(2);
        expect(AVAILABLE_STYLES.map((style) => style.id)).toEqual([
            'apa',
            'chicago-author-date',
            'modern-language-association',
            'ieee',
        ]);
    });
});

describe('CSL item mapping', () => {
    it('preserves translated types, structured authors, and literal dates', () => {
        expect(resolveCslType('Article de revista acadèmica')).toBe(
            'article-journal',
        );
        expect(recursosPageToCsl({
            metadata: {
                Any: 'in press',
                autoria: [{ cognom1: 'Lovelace', nom: 'Ada' }],
                'Citation Key': 'lovelace1843',
                'Item Type': 'journalArticle',
                'Llibre/Revista': 'Scientific Memoirs',
            },
            title: 'Notes on the Analytical Engine',
        })).toEqual({
            author: [{ family: 'Lovelace', given: 'Ada' }],
            'container-title': 'Scientific Memoirs',
            id: 'lovelace1843',
            issued: { literal: 'in press' },
            title: 'Notes on the Analytical Engine',
            type: 'article-journal',
        });
    });
});
