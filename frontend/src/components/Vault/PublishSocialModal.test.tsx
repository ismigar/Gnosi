import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PublishSocialModal } from './PublishSocialModal';


const mocks = vi.hoisted(() => ({
    composeSocialPosts: vi.fn(),
    fetchSocialNetworks: vi.fn(),
    fetchVaultPage: vi.fn(),
    logError: vi.fn(),
    publishSocialPosts: vi.fn(),
    scheduleSocialPosts: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
}));
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string | { readonly defaultValue?: string }) => (
            typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key
        ),
    }),
}));


vi.mock('../../hooks/useModalKeyboard', () => ({ useModalKeyboard: vi.fn() }));


vi.mock('../../lib/notifyError', () => ({ logError: mocks.logError }));


vi.mock('../../lib/toast', () => ({
    toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));


vi.mock('../../shared/api/social', () => ({
    composeSocialPosts: mocks.composeSocialPosts,
    fetchSocialNetworks: mocks.fetchSocialNetworks,
    publishSocialPosts: mocks.publishSocialPosts,
    scheduleSocialPosts: mocks.scheduleSocialPosts,
}));


vi.mock('../../shared/api/vaults', () => ({ fetchVaultPage: mocks.fetchVaultPage }));


function buttonWithText(container: ParentNode, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button'))
        .find((candidate) => candidate.textContent.includes(text));
    if (!button) throw new Error(`Button not found: ${text}`);
    return button;
}


describe('PublishSocialModal', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        mocks.fetchSocialNetworks.mockResolvedValue([
            {
                char_limit: 500,
                configured: true,
                enabled: true,
                icon: '🐘',
                id: 'mastodon',
                name: 'Mastodon',
            },
        ]);
        mocks.composeSocialPosts.mockResolvedValue({
            proposals: {
                mastodon: {
                    char_count: 14,
                    hashtags: [],
                    over_limit: false,
                    provider: 'test',
                    text: 'Generated post',
                },
            },
            provider: 'test',
            source_lang: 'en',
        });
        mocks.publishSocialPosts.mockResolvedValue({
            record_id: 'record-1',
            results: { mastodon: { id: 'post-1', status: 'success' } },
            status: 'ok',
        });
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
        vi.clearAllMocks();
    });

    it('does not load data while closed', () => {
        act(() => {
            root.render(<PublishSocialModal
                isOpen={false}
                onClose={vi.fn()}
            />);
        });
        expect(container.textContent).toBe('');
        expect(mocks.fetchSocialNetworks).not.toHaveBeenCalled();
    });

    it('generates editable proposals and publishes them', async () => {
        const onClose = vi.fn();
        const onPublished = vi.fn();
        await act(async () => {
            root.render(<PublishSocialModal
                isOpen
                onClose={onClose}
                onPublished={onPublished}
                recordMetadata={{ title: 'Source title' }}
            />);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(container.textContent).toContain('Mastodon');
        await act(async () => {
            buttonWithText(container, 'Generate with AI').click();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mocks.composeSocialPosts).toHaveBeenCalledWith(expect.objectContaining({
            networks: ['mastodon'],
            title: 'Source title',
        }));
        expect(container.textContent).toContain('Generated post');

        await act(async () => {
            buttonWithText(container, 'Publish now').click();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mocks.publishSocialPosts).toHaveBeenCalledWith({
            posts: { mastodon: { text: 'Generated post' } },
            source_page_id: null,
            source_title: 'Source title',
        });
        expect(onPublished).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok' }));
        expect(onClose).toHaveBeenCalledOnce();
    });
});
