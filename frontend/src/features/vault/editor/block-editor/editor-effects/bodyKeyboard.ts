import type { GnosiEditor } from '../schema';
import { adjacentBlocks, currentBlockId, enterEmbed } from './embedNavigation';
import { caretOnBlockEdge } from './caret';
import { editorView, type EmbedNavApi } from './types';

export interface BodyKeyboardInputs {
    editor: Pick<GnosiEditor, 'prosemirrorView' | 'document' | 'getTextCursorPosition' | 'getSelection'>;
    navigation: ReadonlyMap<string, EmbedNavApi>;
    onNavigateUp?: (() => void) | null;
    onOpenProperties?: (() => void) | null;
    caretAtEdge?: (edge: 'first' | 'last') => boolean;
}

function consume(event: KeyboardEvent): void { event.preventDefault(); event.stopPropagation(); }

export function handleBodyKeyboard(event: KeyboardEvent, { editor, navigation, onNavigateUp, onOpenProperties, caretAtEdge = caretOnBlockEdge }: BodyKeyboardInputs): void {
    const pmDom = editorView(editor)?.dom;
    if (pmDom && document.activeElement && document.activeElement !== pmDom) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (event.altKey) {
        if (event.key === 'ArrowUp') { consume(event); onOpenProperties?.(); }
        return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
        const id = currentBlockId(editor);
        const block = id ? editor.document.find((block) => block.id === id) : undefined;
        if (block?.type === 'gnosi_view') { consume(event); enterEmbed(navigation, block.id, 'first'); return; }
    }
    if (event.key === 'ArrowUp') {
        if (!caretAtEdge('first')) return;
        const id = currentBlockId(editor);
        const previous = id ? adjacentBlocks(id, editor.document).prevBlock : null;
        if (!previous) { consume(event); onNavigateUp?.(); }
        else if (previous.type === 'gnosi_view' && enterEmbed(navigation, previous.id, 'last')) consume(event);
    } else if (event.key === 'ArrowDown') {
        if (!caretAtEdge('last')) return;
        const id = currentBlockId(editor);
        const next = id ? adjacentBlocks(id, editor.document).nextBlock : null;
        if (next?.type === 'gnosi_view' && enterEmbed(navigation, next.id, 'first')) consume(event);
    }
}
