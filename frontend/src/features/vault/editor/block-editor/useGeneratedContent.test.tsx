import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useGeneratedContent } from './useGeneratedContent';
import type { EditorSchema, GnosiEditor } from './schema';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('../../../../shared/editor/markdown-mapper', () => ({ blocksToRichMarkdown: () => 'Original text', richMarkdownToBlocks: () => Promise.resolve([{ id: 'edited' }]) }));
vi.mock('./blockValues', () => ({ readEditorBlocks: (blocks: unknown) => blocks }));

it.each(['apply', 'changed', 'different-page', 'locked'] as const)('keeps reviewed whole-page edits bound to their original editable document: %s', async state => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const replaceBlocks = vi.fn(); const insertBlocks = vi.fn(); const save = vi.fn(() => Promise.resolve());
    const editor = { document: [{ id: 'original' }], replaceBlocks, insertBlocks } as unknown as GnosiEditor;
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    let result: ReturnType<typeof useGeneratedContent> | undefined;
    function current() {
        if (!result) throw new Error('Editor hook was not rendered');
        return result;
    }
    function Harness({ page = 'article', editable = true }) {
        result = useGeneratedContent(editor, {} as EditorSchema, save, page, editable); return null;
    }
    try {
        act(() => { root.render(<Harness />); });
        act(() => { result?.openPageEdit(); });
        const request = current().aiRequest;
        if (!request) throw new Error('Edit request was not opened');
        expect(request).toMatchObject({ replacePage: true, context: 'Original text' });
        expect(replaceBlocks).not.toHaveBeenCalled();
        if (state === 'changed') Object.defineProperty(editor, 'document', { value: [{ id: 'changed' }] });
        if (state === 'different-page') act(() => { root.render(<Harness page="another" />); });
        if (state === 'locked') act(() => { root.render(<Harness editable={false} />); });
        await act(async () => {
            const applying = current().insertGeneratedMarkdown('**Original text**', request.anchor);
            if (state === 'apply') await applying;
            else await expect(applying).rejects.toThrow('page changed');
        });
        expect(replaceBlocks).toHaveBeenCalledTimes(state === 'apply' ? 1 : 0);
        expect(save).toHaveBeenCalledTimes(state === 'apply' ? 1 : 0);
        expect(insertBlocks).not.toHaveBeenCalled();
    } finally { act(() => { root.unmount(); }); host.remove(); vi.unstubAllGlobals(); }
});
