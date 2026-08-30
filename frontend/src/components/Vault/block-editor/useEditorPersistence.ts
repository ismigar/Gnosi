import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { patchVaultPage } from '../../../shared/api/vaults';
import { notifyError, logError } from '../../../lib/notifyError';
import { blocksToRichMarkdown } from '../markdown-mapper';
import { inFlightSaves } from '../editorState';
import { extractOutgoingPageLinks } from './outgoingLinks';
import type { MarkdownCodeEditorProps, CodeEditorMetadata } from './codeTypes';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export interface PersistenceEditor {
    readonly document: unknown;
    readonly onChange: (listener: () => void) => (() => void) | { remove: () => void } | undefined;
}
export interface EditorPersistenceOptions {
    readonly editor: PersistenceEditor;
    readonly noteFilename: string;
    readonly isParsing: boolean;
    readonly editorReady: boolean;
    readonly metadataRef: RefObject<CodeEditorMetadata>;
    readonly setSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
    readonly onUpdate?: MarkdownCodeEditorProps['onUpdate'];
    readonly onOutgoingLinksChange?: MarkdownCodeEditorProps['onOutgoingLinksChange'];
    readonly idToTitle?: MarkdownCodeEditorProps['idToTitle'];
}

/** Track exactly the promise whose completion is allowed to clear the cache. */
function savePage(id: string, content: string, metadata: CodeEditorMetadata, untitled: string) {
    const data = { title: metadata.title || untitled, content, metadata };
    const promise = patchVaultPage(id, data);
    inFlightSaves.set(id, { content, metadata, promise, timestamp: Date.now() });
    return { data, promise };
}
function clearOwnSave(id: string, promise: Promise<unknown>): void {
    if (inFlightSaves.get(id)?.promise === promise) inFlightSaves.delete(id);
}

export function useEditorPersistence({ editor, noteFilename, isParsing, editorReady, metadataRef, setSaveStatus, onUpdate, onOutgoingLinksChange, idToTitle }: EditorPersistenceOptions) {
    const { t } = useTranslation();
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const outgoingSignatureRef = useRef('');
    // This is a data ref, deliberately read at flush time, not a DOM ref.
    const readMetadata = useCallback(() => metadataRef.current, [metadataRef]);
    const handleSave = useCallback(async () => {
        if (!noteFilename || isParsing || !editorReady) return;
        try {
            setSaveStatus('saving');
            const { data, promise } = savePage(noteFilename, blocksToRichMarkdown(editor.document), readMetadata(), t('editor.untitled'));
            await promise;
            clearOwnSave(noteFilename, promise);
            setSaveStatus('saved');
            onUpdate?.(noteFilename, data.content, { title: data.title, metadata: data.metadata });
            if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
            setTimeout(() => { setSaveStatus(previous => previous === 'saved' ? 'idle' : previous); }, 3000);
        } catch (error) {
            notifyError('autosave', error, t('editor.autosave_error'));
            setSaveStatus('error');
        }
    }, [editor, editorReady, isParsing, readMetadata, noteFilename, onUpdate, setSaveStatus, t]);

    useEffect(() => {
        if (isParsing) return;
        const subscription = editor.onChange(() => {
            if (onOutgoingLinksChange) {
                const links = extractOutgoingPageLinks(blocksToRichMarkdown(editor.document), idToTitle, noteFilename);
                const signature = links.map(link => `${link.id || ''}\u0000${link.title}`).join('\u0001');
                if (signature !== outgoingSignatureRef.current) {
                    outgoingSignatureRef.current = signature;
                    onOutgoingLinksChange(links);
                }
            }
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(() => { void handleSave(); }, 700);
        });
        return () => {
            if (typeof subscription === 'function') subscription();
            else subscription?.remove();
            if (!saveTimerRef.current) return;
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
            const { data, promise } = savePage(noteFilename, blocksToRichMarkdown(editor.document), readMetadata(), t('editor.untitled'));
            void promise.then(() => {
                onUpdate?.(noteFilename, data.content, { title: data.title, metadata: data.metadata });
            }).finally(() => {
                if (inFlightSaves.get(noteFilename)?.promise === promise) {
                    setTimeout(() => { clearOwnSave(noteFilename, promise); }, 1000);
                }
            }).catch((error: unknown) => { logError('unmount-save', error); });
        };
    }, [editor, handleSave, idToTitle, isParsing, readMetadata, noteFilename, onOutgoingLinksChange, onUpdate, t]);

    return handleSave;
}
