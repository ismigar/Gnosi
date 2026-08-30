import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateBlockNote } from '@blocknote/react';
import { withCollaboration } from '@blocknote/core/yjs';
import { multiColumnDropCursor } from '@blocknote/xl-multi-column';
import { useYjsCollaboration } from '../../collaboration/useYjsCollaboration';
import { resolveBlockNoteDictionary } from '../locales/registry';
import { createEditorSchema, type GnosiEditor, type PartialEditorBlock } from './schema';
import { useMediaUpload } from './useMediaUpload';
import { useInitialDocument } from './useInitialDocument';
import type { PageEditorBodyProps } from './page-editor/types';
import { useDropBridge } from './useDropBridge';

export function useEditorRuntime({ noteFilename, initialContent, contextValue, metadata, metadataRef }: PageEditorBodyProps) {
    const { i18n } = useTranslation();
    const [dictionary] = useState(() => resolveBlockNoteDictionary(i18n.resolvedLanguage || i18n.language));
    const schema = useMemo(() => createEditorSchema(contextValue), [contextValue]);
    const [blocks, setBlocks] = useState<PartialEditorBlock[] | null>(null);
    const [isParsing, setIsParsing] = useState(true);
    const [editorReady, setEditorReady] = useState(false);
    const editorRef = useRef<GnosiEditor | null>(null);
    const { toggleDropHandlerRef, handleDrop } = useDropBridge();
    const tableId = metadata.table_id || metadata.database_table_id || '';
    const uploadFileToAssetsDirect = useMediaUpload(tableId, metadataRef, editorRef);
    const { collaboration, ready: collabReady } = useYjsCollaboration(noteFilename);
    const baseOptions = {
        schema, dictionary, uploadFile: uploadFileToAssetsDirect, dropCursor: multiColumnDropCursor,
        _tiptapOptions: { editorProps: { handleDrop } },
        tables: { splitCells: true, cellBackgroundColor: true, cellTextColor: true, headers: true },
    };
    // Metadata and callbacks never recreate the editor; only collaboration activation does.
    const editor = useCreateBlockNote(collaboration ? withCollaboration({ ...baseOptions, collaboration: { ...collaboration, user: { ...collaboration.user } } }) : { ...baseOptions, initialContent: blocks || undefined }, [collabReady]);
    useLayoutEffect(() => { editorRef.current = editor; return () => { editorRef.current = null; }; }, [editor]);
    const loadError = useInitialDocument({ editor, schema, noteFilename, initialContent, setBlocks, setIsParsing });
    useEffect(() => { const timer = setTimeout(() => { setEditorReady(true); }, 100); return () => { clearTimeout(timer); }; }, [editor]);
    useEffect(() => {
        if (!collaboration || !blocks) return;
        const document = collaboration.provider.doc;
        const timer = setTimeout(() => {
            try {
                const meta = document.getMap('meta'); if (meta.get('seeded')) return;
                const first = editor.document[0]?.content;
                const empty = editor.document.length <= 1 && (!first || (Array.isArray(first) && first.length === 0));
                if (empty) {
                    document.transact(() => { meta.set('seeded', true); });
                    editor.replaceBlocks(editor.document, blocks);
                }
            } catch (error) { console.warn('Yjs seed skipped:', error); }
        }, 400);
        return () => { clearTimeout(timer); };
    }, [blocks, collaboration, editor]);
    return { editor, schema, isParsing, editorReady, loadError, tableId, toggleDropHandlerRef, uploadFileToAssetsDirect };
}
