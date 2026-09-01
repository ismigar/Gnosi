import type { EditorBlock, GnosiEditor } from '../schema';
import type { EmbedNavApi } from './types';

export type NavigationEditor = Pick<GnosiEditor, 'document' | 'focus' | 'setTextCursorPosition' | 'insertBlocks' | 'getTextCursorPosition' | 'getSelection'>;
export interface AdjacentBlocks { prevBlock: EditorBlock | null; nextBlock: EditorBlock | null; }

export function adjacentBlocks(blockId: string, document: EditorBlock[]): AdjacentBlocks {
    const index = document.findIndex((block) => block.id === blockId);
    if (index !== -1) return { prevBlock: document[index - 1] ?? null, nextBlock: document[index + 1] ?? null };
    function walk(list: EditorBlock[], parent: EditorBlock | null): AdjacentBlocks | null {
        for (const [index, block] of list.entries()) {
            if (block.id === blockId) return { prevBlock: list[index - 1] ?? parent, nextBlock: list[index + 1] ?? null };
            const found = block.children.length ? walk(block.children, block) : null;
            if (found) return found;
        }
        return null;
    }
    return walk(document, null) ?? { prevBlock: null, nextBlock: null };
}

export function currentBlockId(editor: Pick<NavigationEditor, 'getTextCursorPosition' | 'getSelection'>): string | null {
    try {
        const id = editor.getTextCursorPosition().block.id;
        if (id) return id;
    } catch { /* Node selections may not expose a text cursor. */ }
    try {
        const id = editor.getSelection()?.blocks[0]?.id;
        if (id) return id;
    } catch { /* The editor can be disposing. */ }
    return null;
}

export function focusFirstBlock(editor: Pick<NavigationEditor, 'document' | 'focus' | 'setTextCursorPosition'>, navigation: ReadonlyMap<string, EmbedNavApi>): boolean {
    try {
        const first = editor.document[0];
        if (!first) return false;
        if (first.type === 'gnosi_view') {
            const api = navigation.get(first.id);
            if (api?.focusFirstCell && api.focusFirstCell() !== false) return true;
        }
        editor.focus();
        editor.setTextCursorPosition(first.id || first, 'start');
        return true;
    } catch { return false; }
}

export function enterEmbed(navigation: ReadonlyMap<string, EmbedNavApi>, blockId: string, edge: 'first' | 'last'): boolean {
    const api = navigation.get(blockId);
    // Preserve the historical detached invocation for the keyboard entry path.
    const focus = edge === 'last' ? api?.focusLastCell : api?.focusFirstCell;
    return typeof focus === 'function' && focus() !== false;
}

export function exitEmbed(editor: Pick<NavigationEditor, 'document' | 'focus' | 'setTextCursorPosition' | 'insertBlocks'>, navigation: ReadonlyMap<string, EmbedNavApi>, blockId: string, direction: string, onNavigateUp?: (() => void) | null): void {
    try {
        const document = editor.document;
        const index = document.findIndex((block) => block.id === blockId);
        const current = document[index];
        if (!current) return;
        if (direction === 'up') {
            const previous = document[index - 1];
            if (!previous) { onNavigateUp?.(); return; }
            if (previous.type === 'gnosi_view') {
                const api = navigation.get(previous.id);
                if (api?.focusLastCell && api.focusLastCell() !== false) return;
            }
            editor.focus();
            editor.setTextCursorPosition(previous.id, 'end');
            return;
        }
        const next = document[index + 1];
        if (next) {
            if (next.type === 'gnosi_view') {
                const api = navigation.get(next.id);
                if (api?.focusFirstCell && api.focusFirstCell() !== false) return;
            }
            editor.focus();
            editor.setTextCursorPosition(next.id, 'start');
            return;
        }
        editor.insertBlocks([{ type: 'paragraph' }], current.id, 'after');
        editor.focus();
        const after = editor.document[index + 1];
        if (after) editor.setTextCursorPosition(after.id, 'start');
    } catch (error) {
        const message = typeof error === 'object' && error && 'message' in error ? error.message : undefined;
        console.warn('exit embed nav failed:', message);
    }
}
