import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GnosiApiError } from '../../../../shared/api/errors';
import { emitAppEvent } from '../../../../shared/platform/app-events';
import { CanvasPageContext } from './context';
import { PageCardComponent } from './PageCardComponent';


const mocks = vi.hoisted(() => ({
    fetchVaultPage: vi.fn(),
    patchVaultPage: vi.fn(),
}));
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback ?? key,
    }),
}));

vi.mock('tldraw', () => ({
    HTMLContainer: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../../shared/api/vaults', () => ({
    fetchVaultPage: mocks.fetchVaultPage,
    patchVaultPage: mocks.patchVaultPage,
}));


vi.mock('../../../../shared/editor/InstructionMarkdownEditor', () => ({
    InstructionMarkdownEditor: ({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) =>
        <textarea aria-label={label} value={value} onChange={event => { onChange(event.target.value); }} />,
}));

describe('PageCardComponent', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        mocks.fetchVaultPage.mockResolvedValue({
            content: '---\ntitle: Stored\n---\nLive content',
            title: 'Updated page',
            etag: 'revision-1',
        });
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        vi.clearAllMocks();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('loads live page data and delegates opening the page', async () => {
        const onOpenPage = vi.fn();
        await act(async () => {
            root.render(
                <CanvasPageContext.Provider value={{ onOpenPage }}>
                    <PageCardComponent shape={{
                        props: { h: 170, pageId: 'page-1', pageTitle: 'Cached', w: 260 },
                    }} />
                </CanvasPageContext.Provider>,
            );
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.fetchVaultPage).toHaveBeenCalledWith('page-1', expect.any(AbortSignal), expect.objectContaining({ workspaceId: 'personal' }));
        expect(container.textContent).toContain('Updated page');
        expect(container.textContent).toContain('Live content');
        expect(container.textContent).not.toContain('title: Stored');
        const open = container.querySelector('button[title="Open page"]');
        if (!open) throw new Error('Open-page action did not render');
        act(() => {
            open.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        });
        expect(onOpenPage).toHaveBeenCalledWith('page-1');
    });
    it('saves against the revision being edited, preserves a conflict draft and refreshes only after cancellation', async () => {
        await act(async () => { root.render(<PageCardComponent shape={{ props: { h: 300, pageId: 'edit-page', pageTitle: 'Note', w: 300 } }} />); await Promise.resolve(); });
        const edit = container.querySelector<HTMLButtonElement>('button[aria-label="Edit page content"]');
        act(() => { edit?.click(); });
        const textarea = container.querySelector('textarea');
        if (!textarea) throw new Error('Missing content editor');
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, 'My draft');
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const reads = mocks.fetchVaultPage.mock.calls.length;
        act(() => { emitAppEvent('gnosi:invalidatePreview', { pageId: 'edit-page' }); });
        expect(mocks.fetchVaultPage).toHaveBeenCalledTimes(reads);
        mocks.patchVaultPage.mockRejectedValueOnce(new GnosiApiError(new Response(null, { status: 409 }), { detail: 'Changed' }));
        await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Save')?.click(); await Promise.resolve(); });
        expect(mocks.patchVaultPage).toHaveBeenCalledWith('edit-page', { content: 'My draft', expected_etag: 'revision-1' }, expect.objectContaining({ signal: expect.any(AbortSignal) as unknown }));
        expect(container.querySelector('textarea')?.value).toBe('My draft');
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('changed elsewhere');
        mocks.fetchVaultPage.mockResolvedValueOnce({ content: 'External change', title: 'Latest title', etag: 'revision-2' });
        await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Cancel')?.click(); await Promise.resolve(); });
        expect(container.querySelector('textarea')).toBeNull();
        expect(container.textContent).toContain('External change');
    });

    it('keeps a draft on network failure and only updates the preview after a successful save', async () => {
        await act(async () => { root.render(<PageCardComponent shape={{ props: { h: 300, pageId: 'save-page', pageTitle: 'Note', w: 300 } }} />); await Promise.resolve(); });
        act(() => { container.querySelector<HTMLButtonElement>('button[aria-label="Edit page content"]')?.click(); });
        mocks.patchVaultPage.mockRejectedValueOnce(new Error('offline'));
        await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Save')?.click(); await Promise.resolve(); });
        expect(container.querySelector('textarea')).not.toBeNull();
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be saved');
        mocks.patchVaultPage.mockResolvedValueOnce({ etag: 'revision-2' });
        await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Save')?.click(); await Promise.resolve(); });
        expect(container.querySelector('textarea')).toBeNull();
        expect(container.querySelector('[role="alert"]')).toBeNull();
    });

});
