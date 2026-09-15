import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { logError } from '../../../../shared/notifications/notifyError';
import { richMarkdownToBlocks } from '../../../../shared/editor/markdown-mapper';
import { restoreToggleExpansionState } from '../toggleExpansionStateUtils';
import { readEditorBlocks } from './blockValues';
import type { EditorSchema, GnosiEditor, PartialEditorBlock } from './schema';
import { inFlightSaves } from '../editorState';
import { isEmptyDocument } from './emptyDocument';

export interface InitialDocumentOptions {
    readonly editor: Pick<GnosiEditor, 'document' | 'replaceBlocks'>;
    readonly schema: EditorSchema;
    readonly noteFilename: string;
    readonly initialContent: unknown;
    readonly setBlocks: Dispatch<SetStateAction<PartialEditorBlock[] | null>>;
    readonly setIsParsing: Dispatch<SetStateAction<boolean>>;
}

export function useInitialDocument({ editor, schema, noteFilename, initialContent, setBlocks, setIsParsing }: InitialDocumentOptions) {
    const initializedRef = useRef<{ editor: InitialDocumentOptions['editor']; noteId: string } | null>(null);
    const [loadError, setLoadError] = useState<Error | null>(null);
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const source = inFlightSaves.get(noteFilename)?.content ?? initialContent;
            if (!source) { setIsParsing(false); return; }
            const currentNoteId = noteFilename || '';
            // Save/context updates must not hydrate this editor again, even if
            // the user cleared it or it contains only blocks without inline text.
            const initialized = initializedRef.current;
            if (initialized?.editor === editor && initialized.noteId === currentNoteId) { setIsParsing(false); return; }
            try {
                const parsed = await richMarkdownToBlocks(source, editor);
                if (cancelled) return;
                const blocks = readEditorBlocks(parsed, schema);
                restoreToggleExpansionState(currentNoteId, blocks);
                setBlocks(blocks);
                const current = editor.document;
                if (isEmptyDocument(current) && blocks.length > 0) editor.replaceBlocks(current, blocks);
                initializedRef.current = { editor, noteId: currentNoteId };
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
