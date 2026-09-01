import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { fetchContacts } from '../../../../shared/api/contacts';
import { useEditorRuntime } from './useEditorRuntime';
import { useEditorPersistence } from './useEditorPersistence';
import { useInsertionRequest } from './useInsertionRequest';
import { useLinkPaste } from './useLinkPaste';
import { useInlineIcon } from './useInlineIcon';
import { useLinkCommands } from './useLinkCommands';
import { useGeneratedContent } from './useGeneratedContent';
import { useViewSection } from './useViewSection';
import { usePlusShortcut } from './usePlusShortcut';
import { useNoteHeadings } from './useNoteHeadings';
import { useLinkableNotes, formatNoteDisambiguator, readMenuTables } from './linkableNotes';
import { applyInsertResult as applyResult, detectEmbeddableUrl } from './insertResult';
import { useEditorEffects } from './editor-effects/useEditorEffects';
import { EditorView } from './editor-view/EditorView';
import type { EditorBlock } from './schema';
import type { InsertContentResult } from '../../content/InsertContentModal';
import type { PageEditorBodyProps } from './page-editor/types';
import '@blocknote/mantine/style.css';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/react/style.css';

/** Compose stable editor state, native interactions, persistence and feature views. */
export function EditorInner(props: PageEditorBodyProps) {
    const { t } = useTranslation();
    const runtime = useEditorRuntime(props);
    const { editor, schema, tableId, editorReady, isParsing, loadError } = runtime;
    const editorWrapperRef = useRef<HTMLDivElement | null>(null);
    const [isCitePickerOpen, setIsCitePickerOpen] = useState(false);
    const insert = useInsertionRequest();
    const links = useLinkPaste(editor, props.idToTitle);
    const icons = useInlineIcon(editor);
    const handleSave = useEditorPersistence({ ...props, editor, editorReady, isParsing: isParsing || loadError !== null });
    const commands = useLinkCommands({ editor, handleSave, onRefreshNotes: props.onRefreshNotes });
    const generated = useGeneratedContent(editor, schema, handleSave);
    const capturePageViewAnchor = useViewSection(editor, props.applyViewSectionRef);
    const getNoteHeadings = useNoteHeadings();
    const normalizedLinkableNotes = useLinkableNotes(props.idToTitle, props.aliasIndex, props.contextValue.registry);
    const applyInsertResult = useCallback((result: InsertContentResult, anchor?: EditorBlock) => { applyResult(editor, result, anchor); }, [editor]);
    const applyInsertResultRef = useRef<typeof applyInsertResult | null>(null);
    useLayoutEffect(() => { applyInsertResultRef.current = applyInsertResult; return () => { applyInsertResultRef.current = null; }; }, [applyInsertResult]);
    usePlusShortcut(editor, insert.requestInsertContent, applyInsertResultRef);
    const navigation = useEditorEffects({
        ...runtime, ...props, editorWrapperRef, applyInsertResultRef,
        requestInsertContent: insert.requestInsertContent, setLinkPasteCtx: links.setLinkPasteCtx, setIsCitePickerOpen,
    });
    const providerValue = {
        ...props.contextValue, requestInsertContent: insert.requestInsertContent,
        registerEmbedNav: navigation.registerEmbedNav, exitEmbedToEditor: navigation.exitEmbedToEditor,
    };
    // Unknown input must not expose an empty editable document that could be autosaved.
    if (loadError) throw loadError;
    if (isParsing || !editorReady) return <div className="flex items-center justify-center h-[500px] text-[var(--text-tertiary)]/60"><Loader2 className="animate-spin mr-2" size={20} /> {t('editor.loading_editor')}</div>;
    return <EditorView {...props} {...insert} {...links} {...icons} {...commands} {...generated}
        editor={editor} t={t} tableId={tableId} editorWrapperRef={editorWrapperRef} providerValue={providerValue}
        normalizedLinkableNotes={normalizedLinkableNotes} allTables={readMenuTables(props.contextValue.allTables)}
        applyInsertResult={applyInsertResult} getNoteHeadings={getNoteHeadings} formatNoteDisambiguator={formatNoteDisambiguator}
        capturePageViewAnchor={capturePageViewAnchor} isCitePickerOpen={isCitePickerOpen} setIsCitePickerOpen={setIsCitePickerOpen}
        loadContacts={fetchContacts} detectEmbeddableUrl={detectEmbeddableUrl} />;
}
