import { extractInternalPageId, isEmptyInlineBlock, normalizeStandaloneHttpUrl } from '../../contextualLinkPasteUtils';
import { currentBrowserOrigin } from '../../../../../shared/platform/browser-events';
import { editorView, type LinkPasteContext } from './types';
import type { GnosiEditor } from '../schema';

export type PasteEditor = Pick<GnosiEditor, 'prosemirrorView' | 'getSelectedText' | 'insertInlineContent' | 'getTextCursorPosition'>;

// ClipboardEvent has no coordinates, but synthetic/legacy events sometimes do.
function eventCoordinate(event: ClipboardEvent, key: 'clientX' | 'clientY'): number {
    const value: unknown = key in event ? Reflect.get(event, key) : undefined;
    return typeof value === 'number' && value ? value : 24;
}

export function handleLinkPaste(event: ClipboardEvent, editor: PasteEditor, setContext: (value: LinkPasteContext) => void): void {
    const url = normalizeStandaloneHttpUrl(event.clipboardData?.getData('text/plain'));
    if (!url) return;
    const view = editorView(editor);
    const selection = view?.state.selection;
    if (!view || !selection) return;
    if (!selection.empty) {
        const selectedText = editor.getSelectedText().trim();
        if (!selectedText) return;
        event.preventDefault();
        event.stopPropagation();
        editor.insertInlineContent([{ type: 'link', href: url, content: [{ type: 'text', text: selectedText, styles: {} }] }]);
        return;
    }
    const cursor = editor.getTextCursorPosition();
    if (!isEmptyInlineBlock(cursor.block)) return;
    event.preventDefault();
    event.stopPropagation();
    let caret = { left: eventCoordinate(event, 'clientX'), bottom: eventCoordinate(event, 'clientY') };
    try { caret = view.coordsAtPos(selection.from); } catch { /* Keep event-position fallback. */ }
    setContext({ url, anchorBlockId: cursor.block.id, internalPageId: extractInternalPageId(url, currentBrowserOrigin()), position: { left: caret.left, top: caret.bottom + 8 } });
}
