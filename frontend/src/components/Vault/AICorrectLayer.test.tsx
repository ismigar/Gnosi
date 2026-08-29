import { act } from 'react';
import type { BlockNoteEditor } from '@blocknote/core';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AICorrectLayer from './AICorrectLayer';
import { emitAppEvent } from '../../shared/platform/app-events';


const mocks = vi.hoisted(() => ({
    correctAiContent: vi.fn(),
}));
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback ?? key,
    }),
}));

vi.mock('react-hot-toast', () => ({
    default: Object.assign(vi.fn(), {
        dismiss: vi.fn(),
        error: vi.fn(),
        loading: vi.fn(() => 'toast-id'),
        success: vi.fn(),
    }),
}));

vi.mock('../../shared/api/ai', () => ({
    correctAiContent: mocks.correctAiContent,
}));

vi.mock('../ConfirmModal', () => ({
    ConfirmModal: ({
        isOpen,
        onConfirm,
    }: {
        readonly isOpen: boolean;
        readonly onConfirm: () => unknown;
    }) => isOpen ? <button onClick={() => { void onConfirm(); }}>Confirm correction</button> : null,
}));


describe('AICorrectLayer', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        mocks.correctAiContent.mockResolvedValue({ corrected: 'Corrected page', provider: 'test' });
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        vi.clearAllMocks();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('confirms and replaces a whole page through the typed app event', async () => {
        const replaceBlocks = vi.fn();
        const editor = {
            blocksToMarkdownLossy: vi.fn(() => 'Original page'),
            document: [{ id: 'block-1' }],
            replaceBlocks,
            tryParseMarkdownToBlocks: vi.fn(() => [{ id: 'block-2' }]),
        } as unknown as BlockNoteEditor;
        act(() => {
            root.render(<AICorrectLayer editor={editor} lang="ca" />);
        });
        act(() => {
            emitAppEvent('gnosi:ai-correct-page');
        });

        const confirm = Array.from(container.querySelectorAll('button'))
            .find((button) => button.textContent.includes('Confirm correction'));
        if (!confirm) throw new Error('Correction confirmation was not opened');
        await act(async () => {
            confirm.click();
            await Promise.resolve();
        });

        expect(mocks.correctAiContent).toHaveBeenCalledWith({
            language: 'ca',
            scope: 'page',
            text: 'Original page',
        });
        expect(replaceBlocks).toHaveBeenCalledWith(
            editor.document,
            [{ id: 'block-2' }],
        );
    });
});
