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


vi.mock('../../../shared/hooks/useModalKeyboard', () => ({ useModalKeyboard: vi.fn() }));


vi.mock('../../../shared/notifications/notifyError', () => ({ logError: mocks.logError }));


vi.mock('../../../shared/notifications/toast', () => ({
    toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));


vi.mock('../../../shared/api/social', () => ({
    composeSocialPosts: mocks.composeSocialPosts,
    fetchSocialNetworks: mocks.fetchSocialNetworks,
    publishSocialPosts: mocks.publishSocialPosts,
    scheduleSocialPosts: mocks.scheduleSocialPosts,
}));


vi.mock('../../../shared/api/vaults', () => ({ fetchVaultPage: mocks.fetchVaultPage }));


function buttonWithText(scope: ParentNode, text: string): HTMLButtonElement {
    const button = Array.from(scope.querySelectorAll('button'))
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
        expect(document.body.textContent).toBe('');
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

        expect(document.body.textContent).toContain('Mastodon');
        await act(async () => {
            buttonWithText(document.body, 'Generate with AI').click();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mocks.composeSocialPosts).toHaveBeenCalledWith(expect.objectContaining({
            networks: ['mastodon'],
            title: 'Source title',
        }));
        expect(document.body.textContent).toContain('Generated post');

        await act(async () => {
            buttonWithText(document.body, 'Publish now').click();
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
    it('keeps failed drafts open and retries only unsuccessful networks', async () => {
        mocks.fetchSocialNetworks.mockResolvedValue(['mastodon', 'bluesky'].map(id => ({
            id, name: id, configured: true, enabled: true, char_limit: 500,
        })));
        const proposal = { text: 'Reviewed article', hashtags: [], char_count: 16, over_limit: false, provider: 'test' };
        mocks.composeSocialPosts.mockResolvedValue({ proposals: { mastodon: proposal, bluesky: proposal } });
        mocks.fetchVaultPage.mockResolvedValue({ title: 'Article', content: 'Article body', metadata: {} });
        mocks.publishSocialPosts.mockResolvedValueOnce({
            status: 'partial', record_id: 'first', results: {
                mastodon: { status: 'success' }, bluesky: { status: 'error', error: 'Unavailable' },
            },
        }).mockResolvedValueOnce({ status: 'published', record_id: 'retry', results: { bluesky: { status: 'success' } } });
        const onClose = vi.fn();
        const onPublished = vi.fn();
        await act(async () => { root.render(<PublishSocialModal isOpen noteId="article" onClose={onClose} onPublished={onPublished} />); await Promise.resolve(); });
        await act(async () => { buttonWithText(document.body, 'Generate with AI').click(); await Promise.resolve(); });
        expect(mocks.composeSocialPosts).toHaveBeenCalledWith(expect.objectContaining({ source_page_id: 'article', content: 'Article body', title: 'Article' }));
        await act(async () => { buttonWithText(document.body, 'Publish now').click(); await Promise.resolve(); });
        expect(onClose).not.toHaveBeenCalled();
        expect(onPublished).not.toHaveBeenCalled();
        expect(document.body.querySelectorAll('textarea')).toHaveLength(1);
        expect(document.body.querySelector('textarea')?.value).toBe('Reviewed article');
        await act(async () => { buttonWithText(document.body, 'Publish now').click(); await Promise.resolve(); });
        expect(mocks.publishSocialPosts).toHaveBeenLastCalledWith({
            posts: { bluesky: { text: 'Reviewed article' } }, source_page_id: 'article', source_title: 'Article',
        });
        expect(onClose).toHaveBeenCalledOnce();
        expect(onPublished).toHaveBeenCalledOnce();
    });

    it('retains the dialog after total failure', async () => {
        mocks.publishSocialPosts.mockResolvedValueOnce({ status: 'error', results: { mastodon: { status: 'error' } } });
        const onClose = vi.fn();
        await act(async () => { root.render(<PublishSocialModal isOpen recordMetadata={{ title: 'Article' }} onClose={onClose} />); await Promise.resolve(); });
        await act(async () => { buttonWithText(document.body, 'Generate with AI').click(); await Promise.resolve(); });
        await act(async () => { buttonWithText(document.body, 'Publish now').click(); await Promise.resolve(); });
        expect(onClose).not.toHaveBeenCalled();
        expect(document.body.querySelector('textarea')?.value).toBe('Generated post');
    });

    it('lets missing network proposals be edited and blocks publishing during regeneration', async () => {
        mocks.fetchSocialNetworks.mockResolvedValue(['mastodon', 'bluesky'].map(id => ({ id, name: id, configured: true, enabled: true, char_limit: 500 })));
        await act(async () => { root.render(<PublishSocialModal isOpen recordMetadata={{ title: 'Article' }} onClose={vi.fn()} />); await Promise.resolve(); });
        await act(async () => { buttonWithText(document.body, 'Generate with AI').click(); await Promise.resolve(); });
        expect(document.body.querySelectorAll('textarea')).toHaveLength(2);
        let finish: (value: unknown) => void = () => {};
        mocks.composeSocialPosts.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        await act(async () => { (document.body.querySelector('[title="Regenerate"]') as HTMLButtonElement).click(); await Promise.resolve(); });
        expect(buttonWithText(document.body, 'Publish now').disabled).toBe(true);
        await act(async () => { finish({ proposals: {} }); await Promise.resolve(); });
        expect(buttonWithText(document.body, 'Publish now').disabled).toBe(false);
    });

});
