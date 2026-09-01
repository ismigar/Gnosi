import { describe, expect, it, vi } from 'vitest';
import { applyInsertResult } from './insertResult';
import type { EditorBlock, GnosiEditor } from './schema';

const cursor: EditorBlock = { id: 'cursor', type: 'paragraph', props: { textAlignment: 'left', textColor: 'default', backgroundColor: 'default' }, content: [], children: [] };
const anchor: EditorBlock = { ...cursor, id: 'anchor' };
function fixture() {
    return {
        insertInlineContent: vi.fn<GnosiEditor['insertInlineContent']>(),
        insertBlocks: vi.fn<GnosiEditor['insertBlocks']>(),
        getTextCursorPosition: vi.fn<GnosiEditor['getTextCursorPosition']>().mockReturnValue({ block: cursor, prevBlock: undefined, nextBlock: undefined, parentBlock: undefined }),
        focus: vi.fn(),
    };
}

describe('insertion result to native editor operations', () => {
    it('keeps all batch links in order with one separating space and restores focus', () => {
        const editor = fixture();
        applyInsertResult(editor, { items: [{ url: '/one', name: 'One', kind: 'file' }, { url: '/two', name: '', kind: 'file' }] });
        expect(editor.insertInlineContent).toHaveBeenCalledExactlyOnceWith([
            { type: 'link', href: '/one', content: [{ type: 'text', text: 'One', styles: {} }] },
            { type: 'text', text: ' ', styles: {} },
            { type: 'link', href: '/two', content: [{ type: 'text', text: '/two', styles: {} }] },
        ]);
        expect(editor.focus).toHaveBeenCalledOnce();
        expect(editor.insertBlocks).not.toHaveBeenCalled();
    });
    it('inserts a frame after the captured anchor even if the current cursor moved', () => {
        const editor = fixture();
        applyInsertResult(editor, { url: 'https://example.org/document.pdf', mode: 'frame' }, anchor);
        expect(editor.insertBlocks).toHaveBeenCalledExactlyOnceWith([{ type: 'embed', props: { url: 'https://example.org/document.pdf', caption: '' } }], anchor, 'after');
        expect(editor.getTextCursorPosition).not.toHaveBeenCalled();
        expect(editor.focus).toHaveBeenCalledOnce();
    });
    it.each(['image', 'video', 'audio', 'file'] as const)('preserves the native %s block kind and filename', kind => {
        const editor = fixture();
        applyInsertResult(editor, { url: '/asset', mode: 'block', kind, name: 'Asset' });
        expect(editor.insertBlocks).toHaveBeenCalledExactlyOnceWith([{ type: kind, props: { url: '/asset', name: 'Asset' } }], cursor, 'after');
        expect(editor.focus).toHaveBeenCalledOnce();
    });
    it('defaults a block without media kind to file and a missing label to its URL', () => {
        const editor = fixture();
        applyInsertResult(editor, { url: '/asset', mode: 'block' });
        expect(editor.insertBlocks).toHaveBeenCalledExactlyOnceWith([{ type: 'file', props: { url: '/asset', name: '/asset' } }], cursor, 'after');
    });
    it('inserts a plain link and does nothing for a cancelled empty result', () => {
        const editor = fixture();
        applyInsertResult(editor, {});
        expect(editor.focus).not.toHaveBeenCalled();
        applyInsertResult(editor, { url: '/target', mode: 'link' });
        expect(editor.insertInlineContent).toHaveBeenCalledExactlyOnceWith([{ type: 'link', href: '/target', content: [{ type: 'text', text: '/target', styles: {} }] }]);
        expect(editor.focus).toHaveBeenCalledOnce();
    });
});
