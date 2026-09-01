import { useEffect, useRef, type RefObject } from 'react';
import type { InsertContentResult } from '../../content/InsertContentModal';
import type { EditorBlock, GnosiEditor } from './schema';
import type { InsertContentRequest } from './editor-view/types';
import { inlineText } from './inlineTokens';

function errorMessage(value: unknown): string {
    return value instanceof Error ? value.message : '';
}

export function usePlusShortcut(editor: GnosiEditor, requestInsertContent: (request: InsertContentRequest) => Promise<InsertContentResult>, applyInsertResultRef: RefObject<((result: InsertContentResult, anchor?: EditorBlock) => void) | null>) {
    const busy = useRef(false);
    useEffect(() => editor.onChange(() => {
        if (busy.current) return;
        try {
            const block = editor.getTextCursorPosition().block;
            const content = block.content;
            const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(inlineText).join('') : '';
            if (!text.endsWith('/+')) return;
            busy.current = true;
            editor.updateBlock(block.id, { content: text.slice(0, -2) || [] });
            setTimeout(() => { busy.current = false; }, 0);
            const anchor = editor.getTextCursorPosition().block;
            void requestInsertContent({ initialTab: 'vault' }).then(result => {
                if (result.url || result.items?.length) applyInsertResultRef.current?.(result, anchor);
            }).catch((error: unknown) => {
                if (!/cancelled|superseded/.test(errorMessage(error))) console.warn('plus shortcut cancelled:', errorMessage(error));
            });
        } catch (error) { console.warn('plus shortcut error:', errorMessage(error)); busy.current = false; }
    }), [applyInsertResultRef, editor, requestInsertContent]);
}
