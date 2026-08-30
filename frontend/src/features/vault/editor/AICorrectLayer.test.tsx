import { act } from 'react';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AICorrectLayer from './AICorrectLayer';
import type { AICorrectionEditorPort } from './spell-check-layer/correctionEditorPort';
import { emitAppEvent } from '../../../shared/platform/app-events';


const mocks = vi.hoisted(() => ({
    correctAiContent: vi.fn(),
}));


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

vi.mock('../../../shared/api/ai', () => ({
    correctAiContent: mocks.correctAiContent,
}));

vi.mock('../../../shared/ui/dialogs/ConfirmModal', () => ({
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
    let view: EditorView;

    beforeEach(() => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*', toDOM: () => ['p', 0] }, text: {} } });
        view = new EditorView(document.createElement('div'), { state: EditorState.create({ schema }) });
        mocks.correctAiContent.mockResolvedValue({ corrected: 'Corrected page', provider: 'test' });
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        view.destroy();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('confirms and replaces a whole page through the typed app event', async () => {
        const replaceBlocks = vi.fn();
        const editor = {
            prosemirrorView: view,
            blocksToMarkdownLossy: vi.fn(() => 'Original page'),
            document: [{ id: 'block-1' }],
            replaceBlocks,
            tryParseMarkdownToBlocks: vi.fn(() => [{ id: 'block-2' }]),
        } satisfies AICorrectionEditorPort<{ id: string }, { id: string }>;
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

    it('roundtrips custom document and parser blocks without imposing the default schema', async () => {
        const source = [{ id: 'view', type: 'gnosi_view', props: { view_id: 'catalog' } }];
        const parsed = [{ id: 'reference', type: 'transclusion', props: { target: 'page' } }];
        const markdown = vi.fn((_blocks: typeof source) => 'Custom page');
        const parse = vi.fn((_markdown: string) => parsed);
        const replace = vi.fn((_before: typeof source, _after: typeof parsed) => undefined);
        const editor = { prosemirrorView: view, document: source, blocksToMarkdownLossy: markdown, tryParseMarkdownToBlocks: parse, replaceBlocks: replace };
        act(() => { root.render(<AICorrectLayer editor={editor} lang="ca" />); });
        expect(mocks.correctAiContent).not.toHaveBeenCalled();
        act(() => { emitAppEvent('gnosi:ai-correct-page'); });
        const button = container.querySelector('button');
        if (!button) throw new Error('Missing custom-page confirmation');
        await act(async () => { button.click(); await Promise.resolve(); });
        expect(markdown).toHaveBeenCalledExactlyOnceWith(source);
        expect(mocks.correctAiContent).toHaveBeenCalledExactlyOnceWith({ language: 'ca', scope: 'page', text: 'Custom page' });
        expect(parse).toHaveBeenCalledExactlyOnceWith('Corrected page');
        expect(replace).toHaveBeenCalledExactlyOnceWith(source, parsed);
        expect(replace.mock.calls[0]?.[0]).toBe(source);
        expect(replace.mock.calls[0]?.[1]).toBe(parsed);
    });
});
