import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BrainInbox } from './BrainInbox';


const mocks = vi.hoisted(() => ({
    dismiss: vi.fn(),
    fetch: vi.fn(),
}));
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { readonly defaultValue?: string }) => options?.defaultValue ?? key,
    }),
}));

vi.mock('../../../shared/api/brain', () => ({
    dismissBrainSuggestion: mocks.dismiss,
    fetchBrainSuggestions: mocks.fetch,
}));

vi.mock('../../../shared/editor/WikilinkInline', () => ({
    WikilinkInline: ({ title }: { readonly title: string }) => <span>{title}</span>,
}));

vi.mock('../../../shared/hooks/useModalKeyboard', () => ({ useModalKeyboard: vi.fn() }));


describe('BrainInbox', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        mocks.fetch.mockResolvedValue({
            suggestions: [{
                evidence: ['Shared topic'],
                id: 'suggestion-1',
                kind: 'connection',
                member_ids: ['page-1'],
                member_titles: ['Research note'],
                title: 'Possible connection',
                why: 'Related evidence',
            }],
        });
        mocks.dismiss.mockResolvedValue({ id: 'suggestion-1' });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        vi.clearAllMocks();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('loads, inspects and dismisses a read-only suggestion', async () => {
        const onAccepted = vi.fn();
        await act(async () => {
            root.render(<BrainInbox onAccepted={onAccepted} />);
            await Promise.resolve();
        });
        const open = Array.from(container.querySelectorAll('button'))
            .find((button) => button.textContent.includes('Connections'));
        if (!open) throw new Error('Brain inbox action not rendered');
        await act(async () => {
            open.click();
            await Promise.resolve();
        });
        expect(container.textContent).toContain('Possible connection');
        expect(container.textContent).toContain('Research note');

        const dismiss = Array.from(container.querySelectorAll('button'))
            .find((button) => button.textContent.includes('Dismiss'));
        if (!dismiss) throw new Error('Dismiss action not rendered');
        await act(async () => {
            dismiss.click();
            await Promise.resolve();
        });
        expect(mocks.dismiss).toHaveBeenCalledWith('suggestion-1');
        expect(onAccepted).toHaveBeenCalledOnce();
    });
});
