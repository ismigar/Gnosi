import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { mountTestComponent } from '../../../../../../tests/mount-react';
import { useEditorDrop } from './useEditorDrop';
import { processEditorFiles, placeCaretAtCoords } from './fileInsertion';
import { editorFixture, paragraph, pmSchema } from './testFixtures';
import type { DropEffectInputs, LinkPasteContext } from './types';
import type { InsertContentResult } from '../../../content/insert-content/insertContentTypes';
import type { EditorBlock } from '../schema';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function setup() {
    const fixture = editorFixture();
    const apply = vi.fn<(result: InsertContentResult, anchor?: EditorBlock) => unknown>();
    const context = vi.fn<(value: LinkPasteContext) => void>();
    const request = vi.fn<(options: { initialFile: File; initialTab: 'upload' }) => Promise<InsertContentResult | null>>(() => Promise.resolve(null));
    const upload = vi.fn<(file: File) => Promise<string | null>>(() => Promise.resolve('asset.png'));
    const inputs: DropEffectInputs = { editor: fixture.editor, editorWrapperRef: { current: fixture.wrapper }, editorReady: true, applyInsertResultRef: { current: apply }, requestInsertContent: request, uploadFileToAssetsDirect: upload, toggleDropHandlerRef: { current: null }, setLinkPasteCtx: context };
    function Harness() { useEditorDrop(inputs); return null; }
    const mounted = mountTestComponent(<Harness />);
    cleanups.push(() => { mounted.unmount(); fixture.destroy(); });
    return { ...fixture, ...mounted, apply, context, request, upload, inputs };
}
function paste(files: File[] = [], text = '') {
    return Object.assign(new Event('paste', { cancelable: true, bubbles: true }), { clipboardData: { files, getData: (format: string) => format === 'text/plain' ? text : '' } });
}
function drop(files: File[]) {
    return Object.assign(new MouseEvent('drop', { cancelable: true, bubbles: true, clientX: 42, clientY: 56 }), { dataTransfer: { files, types: ['Files'] } });
}
async function dispatch(wrapper: HTMLElement, event: Event) { await act(async () => { wrapper.dispatchEvent(event); await Promise.resolve(); }); }

describe('file capture and insertion', () => {
    it('allows all-visual drop/paste to native BlockNote and captures mixed batches once', async () => {
        const { wrapper, upload, request, apply } = setup();
        const image = new File(['image'], 'image.png', { type: 'image/png' }); const pdf = new File(['pdf'], 'doc.pdf');
        request.mockResolvedValue({ url: 'doc.pdf', mode: 'frame' });
        for (const event of [drop([image]), paste([image])]) { await dispatch(wrapper, event); expect(event.defaultPrevented).toBe(false); }
        expect(upload).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
        const bubble = vi.fn(); wrapper.addEventListener('paste', bubble);
        const mixed = paste([image, pdf]); await dispatch(wrapper, mixed);
        expect(mixed.defaultPrevented).toBe(true); expect(bubble).not.toHaveBeenCalled();
        expect(upload).toHaveBeenCalledExactlyOnceWith(image); expect(request).toHaveBeenCalledExactlyOnceWith({ initialFile: pdf, initialTab: 'upload' });
        expect(apply.mock.calls.map((call) => call[0])).toEqual([{ url: 'asset.png', mode: 'block', kind: 'image', name: 'image.png' }, { url: 'doc.pdf', mode: 'frame' }]);
    });
    it('captures drop position before opening the insertion modal and cleans drop listeners', async () => {
        const { wrapper, editor, view, request, unmount } = setup();
        const node = pmSchema.node('paragraph', { id: 'at-drop' }, pmSchema.text('text'));
        view.updateState(view.state.apply(view.state.tr.replaceWith(0, view.state.doc.content.size, node)));
        vi.spyOn(view, 'posAtCoords').mockReturnValue({ pos: 2, inside: 0 });
        const event = drop([new File(['x'], 'file.pdf')]); await dispatch(wrapper, event);
        expect(event.defaultPrevented).toBe(true); expect(editor.setTextCursorPosition).toHaveBeenCalledWith('at-drop', 'end');
        expect(editor.setTextCursorPosition.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0] ?? -1);
        unmount(); await dispatch(wrapper, drop([new File(['y'], 'other.pdf')])); expect(request).toHaveBeenCalledOnce();
    });
    it('continues after cancellation/errors, captures per-file anchors and ignores empty results', async () => {
        const { inputs, editor, request, apply } = setup();
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const files = ['cancel', 'failed', 'empty', 'selected'].map((name) => new File(['x'], `${name}.pdf`));
        request.mockRejectedValueOnce(new Error('superseded')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null).mockResolvedValueOnce({ items: [{ kind: 'file', name: 'selected', url: 'selected.pdf' }] });
        await processEditorFiles(files, inputs);
        expect(request).toHaveBeenCalledTimes(4); expect(error).toHaveBeenCalledOnce(); expect(apply).toHaveBeenCalledOnce();
        expect(editor.getTextCursorPosition).toHaveBeenCalledTimes(4); expect(apply.mock.calls[0]?.[1]?.id).toBe('first');
    });
    it('keeps the current cursor if coordinate lookup fails', () => {
        const { editor, view } = setup(); vi.spyOn(view, 'posAtCoords').mockImplementation(() => { throw new Error('No position'); });
        expect(() => { placeCaretAtCoords(editor, 10, 20); }).not.toThrow(); expect(editor.setTextCursorPosition).not.toHaveBeenCalled();
    });
});

describe('contextual link paste', () => {
    it('links selected text directly without opening a chooser', async () => {
        const { editor, view, wrapper, context } = setup();
        view.updateState(view.state.apply(view.state.tr.insertText('Selected')));
        view.updateState(view.state.apply(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 9))));
        editor.getSelectedText.mockReturnValue(' Selected ');
        const event = paste([], 'https://example.test/page'); await dispatch(wrapper, event);
        expect(event.defaultPrevented).toBe(true); expect(context).not.toHaveBeenCalled();
        expect(editor.insertInlineContent).toHaveBeenCalledExactlyOnceWith([{ type: 'link', href: 'https://example.test/page', content: [{ type: 'text', text: 'Selected', styles: {} }] }]);
    });
    it('opens an anchored chooser only for an empty inline block, with caret coordinates', async () => {
        const { wrapper, view, context, editor } = setup();
        vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 80, right: 80, top: 70, bottom: 90 });
        const url = `${window.location.origin}/vault/page/local%20id`;
        await dispatch(wrapper, paste([], url));
        expect(context).toHaveBeenCalledExactlyOnceWith({ url, anchorBlockId: 'first', internalPageId: 'local id', position: { left: 80, top: 98 } });
        editor.getTextCursorPosition.mockReturnValue({ block: paragraph('not-empty', [], 'body'), prevBlock: undefined, nextBlock: undefined, parentBlock: undefined });
        const event = paste([], url); await dispatch(wrapper, event); expect(event.defaultPrevented).toBe(false); expect(context).toHaveBeenCalledOnce();
    });
    it('preserves synthetic-coordinate fallback and ignores non-standalone URLs', async () => {
        const { wrapper, view, context } = setup();
        vi.spyOn(view, 'coordsAtPos').mockImplementation(() => { throw new Error('No geometry'); });
        await dispatch(wrapper, Object.assign(paste([], 'https://example.test'), { clientX: 34, clientY: 45 }));
        expect(context.mock.calls[0]?.[0].position).toEqual({ left: 34, top: 53 });
        for (const text of ['words https://example.test', 'file:///tmp/a.pdf', 'javascript:alert(1)']) { const event = paste([], text); await dispatch(wrapper, event); expect(event.defaultPrevented).toBe(false); }
        expect(context).toHaveBeenCalledOnce();
    });
});
