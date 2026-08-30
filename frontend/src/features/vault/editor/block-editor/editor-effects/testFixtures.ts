import { vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import type { EditorBlock } from '../schema';
import type { EffectsEditor } from './types';

const textProps = { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' as const };
export function paragraph(id: string, children: EditorBlock[] = [], text = ''): EditorBlock {
    return { id, type: 'paragraph', props: textProps, content: text ? [{ type: 'text', text, styles: {} }] : [], children };
}
export function heading(id: string, level = 1, children: EditorBlock[] = [], text = ''): EditorBlock {
    return { id, type: 'heading', props: { ...textProps, level, isToggleable: true }, content: text ? [{ type: 'text', text, styles: {} }] : [], children };
}
export function embed(id: string): EditorBlock {
    return { id, type: 'gnosi_view', props: { view_id: '', heading: '', heading_level: '1', section: '' }, content: undefined, children: [] };
}

export const pmSchema = new Schema({ nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', attrs: { id: { default: '' } }, toDOM: () => ['p', 0] },
    text: {},
} });

export function editorFixture(blocks: EditorBlock[] = [paragraph('first')]) {
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    const view = new EditorView(wrapper, { state: EditorState.create({ schema: pmSchema }) });
    const listeners = new Set<() => void>();
    const transactions = vi.fn();
    const cursor = vi.fn<EffectsEditor['getTextCursorPosition']>(() => ({ block: blocks[0] ?? paragraph('empty'), prevBlock: undefined, nextBlock: blocks[1], parentBlock: undefined }));
    const editor = {
        document: blocks,
        prosemirrorView: view,
        getTextCursorPosition: cursor,
        getSelection: vi.fn<EffectsEditor['getSelection']>(),
        getSelectedText: vi.fn(() => ''),
        getBlock: vi.fn((identifier: string | { id: string }): EditorBlock | undefined => {
            const id = typeof identifier === 'string' ? identifier : identifier.id;
            const find = (list: EditorBlock[]): EditorBlock | undefined => {
                for (const block of list) {
                    if (block.id === id) return block;
                    const nested = find(block.children);
                    if (nested) return nested;
                }
                return undefined;
            };
            return find(editor.document);
        }),
        transact: <T,>(callback: (transaction: Transaction) => T): T => { transactions(); return callback(view.state.tr); },
        removeBlocks: vi.fn<EffectsEditor['removeBlocks']>(() => []),
        insertBlocks: vi.fn<EffectsEditor['insertBlocks']>(() => []),
        updateBlock: vi.fn<EffectsEditor['updateBlock']>(() => paragraph('updated')),
        insertInlineContent: vi.fn<EffectsEditor['insertInlineContent']>(),
        focus: vi.fn(),
        setTextCursorPosition: vi.fn<EffectsEditor['setTextCursorPosition']>(),
        onChange: vi.fn((callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; }),
    } satisfies EffectsEditor;
    return { editor, wrapper, view, listeners, transactions, changed: () => { for (const listener of listeners) listener(); }, destroy: () => { view.destroy(); wrapper.remove(); } };
}
