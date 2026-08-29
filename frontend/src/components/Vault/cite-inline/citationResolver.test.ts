import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    clearCitationCache,
    resolveCitationKey,
} from './citationResolver';


const mocks = vi.hoisted(() => ({
    fetchVaultPage: vi.fn(),
    resolveCitationKeyApi: vi.fn(),
}));


vi.mock('../../../shared/api/citations', () => ({
    resolveCitationKey: mocks.resolveCitationKeyApi,
}));

vi.mock('../../../shared/api/vaults', () => ({
    fetchVaultPage: mocks.fetchVaultPage,
}));


describe('citationResolver', () => {
    beforeEach(() => {
        clearCitationCache();
        vi.clearAllMocks();
    });

    it('resolves full page metadata and caches the CSL item', async () => {
        mocks.resolveCitationKeyApi.mockResolvedValue({ id: 'page-1' });
        mocks.fetchVaultPage.mockResolvedValue({
            metadata: {
                'Citation Key': 'weber1905',
                'Item Type': 'book',
                Autor: 'Max Weber',
            },
            title: 'The Protestant Ethic',
        });

        const first = await resolveCitationKey('weber1905');
        const second = await resolveCitationKey('weber1905');

        expect(first?.id).toBe('page-1');
        expect(first?.cslItem?.id).toBe('weber1905');
        expect(second).toBe(first);
        expect(mocks.resolveCitationKeyApi).toHaveBeenCalledOnce();
        expect(mocks.fetchVaultPage).toHaveBeenCalledOnce();
    });

    it('keeps navigation available when full metadata cannot load', async () => {
        mocks.resolveCitationKeyApi.mockResolvedValue({ id: 'page-2' });
        mocks.fetchVaultPage.mockRejectedValue(new Error('offline'));

        await expect(resolveCitationKey('arendt1958')).resolves.toEqual({
            id: 'page-2',
            page: null,
            cslItem: null,
        });
    });

    it('caches a key that does not exist', async () => {
        mocks.resolveCitationKeyApi.mockResolvedValue({ id: null });

        await expect(resolveCitationKey('missing')).resolves.toBeNull();
        await expect(resolveCitationKey('missing')).resolves.toBeNull();
        expect(mocks.resolveCitationKeyApi).toHaveBeenCalledOnce();
    });
});
