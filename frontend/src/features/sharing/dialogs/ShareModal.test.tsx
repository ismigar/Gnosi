import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { recordWebsiteDestinations } from '../../../shared/api/sites';
import { toast } from '../../../shared/notifications/toast';
import {
    createShareLink,
    fetchShareLinks,
    revokeShareLink,
    type ShareLink,
} from '../../../shared/api/sharing';
import { writeClipboardText } from '../../../shared/platform/clipboard';
import { ShareModal } from './ShareModal';


const plugin = vi.hoisted(() => ({ enabled: false }));
vi.mock('../../../shared/plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: (id: string) => id === 'web-publishing' && plugin.enabled }) }));
vi.mock('../../../shared/api/sites', () => ({ recordWebsiteDestinations: vi.fn() }));
vi.mock('../../websites', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../websites')>()),
    RecordWebsitePublicationDialog: ({ pageId }: { pageId: string }) => <div data-testid="record-website-dialog">{pageId}</div>,
}));

vi.mock('../../../shared/hooks/useModalKeyboard', () => ({
    useModalKeyboard: () => undefined,
}));


vi.mock('../../../shared/notifications/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));


vi.mock('../../../shared/api/sharing', () => ({
    createShareLink: vi.fn(),
    fetchShareLinks: vi.fn(),
    revokeShareLink: vi.fn(),
}));


vi.mock('../../../shared/platform/clipboard', () => ({
    writeClipboardText: vi.fn(),
}));


vi.mock('../../../shared/ui/dialogs/ConfirmModal', () => ({
    ConfirmModal: ({ isOpen, onConfirm }: {
        isOpen: boolean;
        onConfirm: () => unknown;
    }) => isOpen
        ? <button data-testid="confirm-revoke" onClick={() => { void onConfirm(); }} type="button">Confirm revoke</button>
        : null,
}));


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        i18n: { language: 'en' },
        t: (key: string, fallback?: string | { defaultValue?: string }) => (
            typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key
        ),
    }),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];
const share: ShareLink = {
    created_at: '2026-08-29T12:00:00Z',
    created_by: 'owner',
    expires_at: null,
    page_id: 'page-1',
    permission: 'view',
    revoked: false,
    token: 'token-1',
    url: '/s/token-1',
};


beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});


afterEach(() => {
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) continue;
        act(() => { mounted.root.unmount(); });
        mounted.container.remove();
    }
    plugin.enabled = false;
    vi.clearAllMocks();
});


function render(element: ReactElement): void {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });
    act(() => { root.render(element); });
}


async function flushRequests(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}


describe('ShareModal', () => {
    it('loads and renders existing links through the typed API', async () => {
        vi.mocked(fetchShareLinks).mockResolvedValueOnce({ shares: [share] });

        render(<ShareModal onClose={vi.fn()} open pageId="page-1" pageTitle="Shared page" />);
        await flushRequests();

        expect(fetchShareLinks).toHaveBeenCalledWith('page-1', expect.any(AbortSignal));
        expect(document.body.textContent).toContain('Shared page');
        expect(document.body.textContent).toContain('/s/token-1');
    });

    it('creates a link, copies it, and adds it to the list', async () => {
        vi.mocked(fetchShareLinks).mockResolvedValueOnce({ shares: [] });
        vi.mocked(createShareLink).mockResolvedValueOnce(share);
        vi.mocked(writeClipboardText).mockResolvedValueOnce();
        render(<ShareModal onClose={vi.fn()} open pageId="page-1" />);
        await flushRequests();

        const createButton = [...document.body.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Create link'));
        await act(async () => {
            createButton?.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(createShareLink).toHaveBeenCalledWith('page-1', { permission: 'view' });
        expect(writeClipboardText).toHaveBeenCalledWith('http://localhost:3000/s/token-1');
        expect(toast.success).toHaveBeenCalled();
        expect(document.body.textContent).toContain('/s/token-1');
    });

    it('revokes a confirmed link and removes it from the list', async () => {
        vi.mocked(fetchShareLinks).mockResolvedValueOnce({ shares: [share] });
        vi.mocked(revokeShareLink).mockResolvedValueOnce({
            status: 'revoked',
            token: 'token-1',
        });
        render(<ShareModal onClose={vi.fn()} open pageId="page-1" />);
        await flushRequests();

        act(() => {
            document.body.querySelector<HTMLButtonElement>('button[title="Revoke"]')?.click();
        });
        await act(async () => {
            document.body.querySelector<HTMLButtonElement>('[data-testid="confirm-revoke"]')?.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(revokeShareLink).toHaveBeenCalledWith('token-1');
        expect(document.body.textContent).not.toContain('/s/token-1');
    });
});


describe('contextual website action', () => {
    it('loads ordinary sharing without discovering website destinations when Webs is disabled', async () => {
        vi.mocked(recordWebsiteDestinations).mockResolvedValue([]);
        vi.mocked(fetchShareLinks).mockResolvedValue({ shares: [] });
        render(<ShareModal open onClose={() => undefined} pageId="article-a" />);
        await flushRequests();
        expect(fetchShareLinks).toHaveBeenCalledWith('article-a', expect.any(AbortSignal));
        expect(recordWebsiteDestinations).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('recordWebsite.legacyStaging');
        expect(document.body.textContent).toContain('recordWebsite.independentSite');
    });

    it('passes the current article identity into website publication', async () => {
        plugin.enabled = true;
        vi.mocked(recordWebsiteDestinations).mockResolvedValue([{ site_id: 'bound', site_name: 'Bound website', target_id: 'local', target_name: 'Local', environment: 'local', url: '' }]);
        vi.mocked(fetchShareLinks).mockResolvedValue({ shares: [] });
        render(<ShareModal open onClose={() => undefined} pageId="article-a" pageTitle="Article A" />);
        await flushRequests();
        const action = [...document.querySelectorAll('button')].find(button => button.textContent === 'recordWebsite.thisRecord');
        await act(async () => { action?.click(); await Promise.resolve(); });
        expect(document.querySelector('[data-testid="record-website-dialog"]')?.textContent).toBe('article-a');
    });
});
