import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    translateVaultPage,
    translateVaultRow,
    translateVaultRows,
} from '../../../../shared/api/translation';
import {
    requestVaultTranslation,
    toggleTranslationLanguage,
    visibleTranslationLanguages,
} from './translationModel';


vi.mock('../../../../shared/api/translation', () => ({
    translateVaultPage: vi.fn(),
    translateVaultRow: vi.fn(),
    translateVaultRows: vi.fn(),
}));


afterEach(() => {
    vi.clearAllMocks();
});


describe('translationModel', () => {
    it('hides the known source language and prevents selecting it', () => {
        expect(visibleTranslationLanguages('ca').some(({ code }) => code === 'ca')).toBe(false);
        expect(toggleTranslationLanguage(['en'], 'ca', 'ca')).toEqual(['en']);
        expect(toggleTranslationLanguage(['en'], 'fr', 'ca')).toEqual(['en', 'fr']);
        expect(toggleTranslationLanguage(['en', 'fr'], 'en', 'ca')).toEqual(['fr']);
    });

    it('routes row translations with their configured button action', async () => {
        const result = {
            created: [],
            item_id: 'row-1',
            skipped: [],
            source_lang: 'ca',
            status: 'ok' as const,
            updated: [],
        };
        vi.mocked(translateVaultRow).mockResolvedValueOnce(result);

        await expect(requestVaultTranslation({
            buttonAction: 'custom-translation',
            mode: 'row',
            noteId: 'row-1',
            noteIds: [],
            targetLanguages: ['en'],
        })).resolves.toEqual(result);
        expect(translateVaultRow).toHaveBeenCalledWith({
            button_action: 'custom-translation',
            item_id: 'row-1',
            target_languages: ['en'],
        });
    });

    it('routes page and bulk translations to their dedicated endpoints', async () => {
        vi.mocked(translateVaultPage).mockResolvedValueOnce({
            created: [],
            page_id: 'page-1',
            skipped: [],
            source_lang: 'ca',
            status: 'ok',
            updated: [],
        });
        vi.mocked(translateVaultRows).mockResolvedValueOnce({
            count: 2,
            errors: [],
            results: [],
            status: 'ok',
        });

        await requestVaultTranslation({
            mode: 'page',
            noteId: 'page-1',
            noteIds: [],
            targetLanguages: ['fr'],
        });
        await requestVaultTranslation({
            mode: 'bulk',
            noteIds: ['row-1', 'row-2'],
            targetLanguages: ['de'],
        });

        expect(translateVaultPage).toHaveBeenCalledWith({
            button_action: 'translate_page',
            page_id: 'page-1',
            target_languages: ['fr'],
        });
        expect(translateVaultRows).toHaveBeenCalledWith({
            button_action: 'translate_row',
            item_ids: ['row-1', 'row-2'],
            target_languages: ['de'],
        });
    });
});
