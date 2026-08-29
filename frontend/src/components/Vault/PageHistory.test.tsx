import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PageHistory } from './PageHistory';


const mocks = vi.hoisted(() => ({
    fetchHistory: vi.fn(),
    fetchVersion: vi.fn(),
    logError: vi.fn(),
    purgeHistory: vi.fn(),
    restoreVersion: vi.fn(),
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
vi.mock('../../shared/api/vault-history', () => ({
    fetchVaultPageHistory: mocks.fetchHistory,
    fetchVaultPageHistoryVersion: mocks.fetchVersion,
    purgeVaultPageHistory: mocks.purgeHistory,
    restoreVaultPageHistoryVersion: mocks.restoreVersion,
}));
vi.mock('../ConfirmModal', () => ({
    ConfirmModal: ({
        isOpen,
        onConfirm,
        title,
    }: {
        readonly isOpen: boolean;
        readonly onConfirm: () => unknown;
        readonly title: ReactNode;
    }) => isOpen ? <button onClick={() => { void onConfirm(); }} type="button">
        {title}
    </button> : null,
}));


const versions = [
    { author: 'Ismael', id: 'new', size: 2048, timestamp: '2026-08-29' },
    { author: 'Ismael', id: 'old', size: 1024, timestamp: '2026-08-28' },
];


function buttonWithText(text: string): HTMLButtonElement {
    const button = Array.from(document.body.querySelectorAll('button'))
        .find((candidate) => candidate.textContent.includes(text));
    if (!button) throw new Error(`Button not found: ${text}`);
    return button;
}


describe('PageHistory', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        mocks.fetchHistory.mockResolvedValue(versions);
        mocks.fetchVersion.mockImplementation((_pageId: string, versionId: string) => (
            Promise.resolve({
                content: versionId === 'new' ? 'beta\ngamma' : 'alpha\nbeta',
                id: 'page-1',
                metadata: {},
                version_id: versionId,
            })
        ));
        mocks.restoreVersion.mockResolvedValue({ message: 'ok', status: 'success' });
        mocks.purgeHistory.mockResolvedValue({ message: 'ok', status: 'success' });
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
        vi.clearAllMocks();
    });

    it('does not load versions while closed', () => {
        act(() => {
            root.render(<PageHistory
                onClose={vi.fn()}
                onRestore={vi.fn()}
                open={false}
                pageId="page-1"
            />);
        });
        expect(mocks.fetchHistory).not.toHaveBeenCalled();
    });

    it('previews the visual diff and restores the selected version', async () => {
        const onClose = vi.fn();
        const onRestore = vi.fn();
        await act(async () => {
            root.render(<PageHistory
                onClose={onClose}
                onRestore={onRestore}
                open
                pageId="page-1"
            />);
            await Promise.resolve();
            await Promise.resolve();
        });
        const firstVersion = Array.from(container.querySelectorAll('[role="button"]'))
            .find((element) => element.textContent.includes('2026-08-29'));
        if (!(firstVersion instanceof HTMLElement)) throw new Error('Version row missing');
        await act(async () => {
            firstVersion.click();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(container.querySelector('.vault-history-diff-line--added')?.textContent)
            .toContain('gamma');
        act(() => { buttonWithText('vault.history.restore_now').click(); });
        await act(async () => {
            buttonWithText('Restore version').click();
            await Promise.resolve();
        });
        expect(mocks.restoreVersion).toHaveBeenCalledWith('page-1', 'new');
        expect(onRestore).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('purges history after confirmation', async () => {
        await act(async () => {
            root.render(<PageHistory
                onClose={vi.fn()}
                onRestore={vi.fn()}
                open
                pageId="page-1"
            />);
            await Promise.resolve();
            await Promise.resolve();
        });
        act(() => { buttonWithText('vault.history.purge_btn').click(); });
        await act(async () => {
            buttonWithText('Purge history').click();
            await Promise.resolve();
        });
        expect(mocks.purgeHistory).toHaveBeenCalledWith('page-1');
        expect(container.textContent).toContain('vault.history.empty');
    });
});
