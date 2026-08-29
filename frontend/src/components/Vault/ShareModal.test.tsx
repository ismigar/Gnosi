import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { toast } from '../../lib/toast';
import {
    createShareLink,
    fetchShareLinks,
    revokeShareLink,
    type ShareLink,
} from '../../shared/api/sharing';
import { writeClipboardText } from '../../shared/platform/clipboard';
import { ShareModal } from './ShareModal';


vi.mock('../../hooks/useModalKeyboard', () => ({
    useModalKeyboard: () => undefined,
}));


vi.mock('../../lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));


vi.mock('../../shared/api/sharing', () => ({
    createShareLink: vi.fn(),
    fetchShareLinks: vi.fn(),
    revokeShareLink: vi.fn(),
}));


vi.mock('../../shared/platform/clipboard', () => ({
    writeClipboardText: vi.fn(),
}));


vi.mock('../ConfirmModal', () => ({
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
