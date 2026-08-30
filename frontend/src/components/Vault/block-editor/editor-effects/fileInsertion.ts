import { isVisualMediaFile, nativeBlockTypeFor } from '../media';
import { editorView, type FileInsertionInputs } from './types';
import type { GnosiEditor } from '../schema';

function scalarText(value: unknown): string { return String(value); }
function message(error: unknown): string {
    if (typeof error !== 'object' || !error || !('message' in error)) return '';
    return scalarText(error.message || '');
}

export async function processEditorFiles(files: readonly File[], { editor, uploadFileToAssetsDirect, requestInsertContent, applyInsertResultRef }: FileInsertionInputs): Promise<void> {
    for (const file of files) {
        try {
            // Capture separately for each file, before awaiting its uploader/modal.
            const anchor = editor.getTextCursorPosition().block;
            if (isVisualMediaFile(file)) {
                const url = await uploadFileToAssetsDirect(file);
                if (url) applyInsertResultRef.current?.({ url, mode: 'block', kind: nativeBlockTypeFor(file), name: file.name }, anchor);
                continue;
            }
            const result = await requestInsertContent({ initialFile: file, initialTab: 'upload' });
            if (result?.url || result?.items?.length) applyInsertResultRef.current?.(result, anchor);
        } catch (error) {
            if (!/cancelled|superseded/.test(message(error))) console.error('file insert failed', error);
        }
    }
}

export function placeCaretAtCoords(editor: Pick<GnosiEditor, 'prosemirrorView' | 'setTextCursorPosition'>, x: number, y: number): void {
    try {
        const view = editorView(editor);
        const position = view?.posAtCoords({ left: x, top: y });
        if (!view || !position) return;
        const resolved = view.state.doc.resolve(position.pos);
        for (let depth = resolved.depth; depth > 0; depth--) {
            const id: unknown = resolved.node(depth).attrs.id;
            if (typeof id === 'string' && id) { editor.setTextCursorPosition(id, 'end'); return; }
        }
    } catch { /* Preserve the current selection if coordinates cannot resolve. */ }
}
