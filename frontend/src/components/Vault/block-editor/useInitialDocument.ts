import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { logError } from '../../../lib/notifyError';
import { richMarkdownToBlocks } from '../markdown-mapper';
import { restoreToggleExpansionState } from '../toggleExpansionStateUtils';
import { readEditorBlocks } from './blockValues';
import type { EditorBlock, EditorSchema, GnosiEditor, PartialEditorBlock } from './schema';
import { inFlightSaves } from '../editorState';

export interface InitialDocumentOptions {
    readonly editor: Pick<GnosiEditor, 'document' | 'replaceBlocks'>;
    readonly schema: EditorSchema;
    readonly noteFilename: string;
    readonly initialContent: unknown;
    readonly setBlocks: Dispatch<SetStateAction<PartialEditorBlock[] | null>>;
    readonly setIsParsing: Dispatch<SetStateAction<boolean>>;
}

function contentLength(block: EditorBlock | undefined): number {
    const content = block?.content;
    return typeof content === 'string' || Array.isArray(content) ? content.length : 0;
}

export function useInitialDocument({ editor, schema, noteFilename, initialContent, setBlocks, setIsParsing }: InitialDocumentOptions) {
    const initializedNoteRef = useRef('');
    const [loadError, setLoadError] = useState<Error | null>(null);
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const source = inFlightSaves.get(noteFilename)?.content ?? initialContent;
            if (!source) { setIsParsing(false); return; }
            const currentNoteId = noteFilename || '';
            const initialized = initializedNoteRef.current === currentNoteId;
            const hasContent = editor.document.some(block => contentLength(block) > 0 || block.children.length > 0);
            if (initialized && hasContent) { setIsParsing(false); return; }
            try {
                const parsed = await richMarkdownToBlocks(source, editor);
                if (cancelled) return;
                const blocks = readEditorBlocks(parsed, schema);
                restoreToggleExpansionState(currentNoteId, blocks);
                setBlocks(blocks);
                initializedNoteRef.current = currentNoteId;
                const current = editor.document.filter(block => block.id);
                if (current.length <= 1 && contentLength(current[0]) === 0 && blocks.length > 0) editor.replaceBlocks(current, blocks);
                setLoadError(null);
            } catch (error) {
                if (!cancelled) {
                    logError('load-initial-content', error);
                    setLoadError(error instanceof Error ? error : new Error('Document could not be loaded'));
                }
            } finally {
                if (!cancelled) setIsParsing(false);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [editor, initialContent, noteFilename, schema, setBlocks, setIsParsing]);
    return loadError;
}
