import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { patchVaultPage } from '../../../../shared/api/vaults';
import { GnosiApiError } from '../../../../shared/api/errors';
import { notifyError, logError } from '../../../../shared/notifications/notifyError';
import { blocksToRichMarkdown } from '../../../../shared/editor/markdown-mapper';
import { inFlightSaves } from '../editorState';
import { extractOutgoingPageLinks } from './outgoingLinks';
import type { MarkdownCodeEditorProps, CodeEditorMetadata } from './codeTypes';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export interface PersistenceEditor {
    readonly document: unknown;
    readonly onChange: (listener: () => void) => (() => void) | { remove: () => void } | undefined;
}

const TRANSIENT_RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 30000, 60000] as const;

function transientRetryDelay(error: unknown, attempt: number): number | null {
    if (!(error instanceof GnosiApiError) || error.status !== 503) return null;
    const configuredDelay = TRANSIENT_RETRY_DELAYS_MS[attempt];
    if (configuredDelay === undefined) return null;
    const retryAfterSeconds = Number(error.response.headers.get('retry-after'));
    const serverDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : 0;
    return Math.max(configuredDelay, serverDelay);
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
    const transientRetryRef = useRef(0);
    const outgoingSignatureRef = useRef('');
    const contentRef = useRef<{
        editor: PersistenceEditor;
        noteFilename: string;
        saved: string;
        observed: string;
    } | null>(null);
    // This is a data ref, deliberately read at flush time, not a DOM ref.
    const readMetadata = useCallback(() => metadataRef.current, [metadataRef]);
    const handleSave = useCallback(async function persistCurrentPage(force = true) {
        if (!noteFilename || isParsing || !editorReady) return;
        try {
            const content = blocksToRichMarkdown(editor.document);
            const tracked = contentRef.current;
            if (!force && tracked?.editor === editor && tracked.noteFilename === noteFilename
                && content === tracked.saved && !inFlightSaves.has(noteFilename)) return;
            setSaveStatus('saving');
            const { data, promise } = savePage(noteFilename, content, readMetadata(), t('editor.untitled'));
            await promise;
            clearOwnSave(noteFilename, promise);
            if (tracked?.editor === editor && tracked.noteFilename === noteFilename) tracked.saved = data.content;
            transientRetryRef.current = 0;
            setSaveStatus('saved');
            onUpdate?.(noteFilename, data.content, { title: data.title, metadata: data.metadata });
            setTimeout(() => { setSaveStatus(previous => previous === 'saved' ? 'idle' : previous); }, 3000);
        } catch (error) {
            const retryDelay = transientRetryDelay(error, transientRetryRef.current);
            if (retryDelay !== null) {
                transientRetryRef.current += 1;
                setSaveStatus('saving');
                if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
                saveTimerRef.current = setTimeout(() => {
                    saveTimerRef.current = null;
                    void persistCurrentPage(force);
                }, retryDelay);
                return;
            }
            transientRetryRef.current = 0;
            notifyError('autosave', error, t('editor.autosave_error'));
            setSaveStatus('error');
        }
    }, [editor, editorReady, isParsing, readMetadata, noteFilename, onUpdate, setSaveStatus, t]);

    useEffect(() => {
        if (isParsing || !editorReady || !noteFilename) return;
        // Compare serialized content, not block ids or editor change events:
        // rendering/normalization can emit events without changing the page.
        if (contentRef.current?.editor !== editor || contentRef.current.noteFilename !== noteFilename) {
            const content = blocksToRichMarkdown(editor.document);
            contentRef.current = { editor, noteFilename, saved: content, observed: content };
        }
        const tracked = contentRef.current;
        const subscription = editor.onChange(() => {
            const content = blocksToRichMarkdown(editor.document);
            if (content === tracked.observed) return;
            tracked.observed = content;
            transientRetryRef.current = 0;
            if (onOutgoingLinksChange) {
                const links = extractOutgoingPageLinks(content, idToTitle, noteFilename);
                const signature = links.map(link => `${link.id || ''}\u0000${link.title}`).join('\u0001');
                if (signature !== outgoingSignatureRef.current) {
                    outgoingSignatureRef.current = signature;
                    onOutgoingLinksChange(links);
                }
            }
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
            if (content === tracked.saved && !inFlightSaves.has(noteFilename)) return;
            saveTimerRef.current = setTimeout(() => {
                saveTimerRef.current = null;
                void handleSave(false);
            }, 700);
        });
        return () => {
            if (typeof subscription === 'function') subscription();
            else subscription?.remove();
            if (!saveTimerRef.current) return;
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
            const content = blocksToRichMarkdown(editor.document);
            if (content === tracked.saved && !inFlightSaves.has(noteFilename)) return;
            const { data, promise } = savePage(noteFilename, content, readMetadata(), t('editor.untitled'));
            void promise.then(() => {
                tracked.saved = data.content;
                onUpdate?.(noteFilename, data.content, { title: data.title, metadata: data.metadata });
            }).finally(() => {
                if (inFlightSaves.get(noteFilename)?.promise === promise) {
                    setTimeout(() => { clearOwnSave(noteFilename, promise); }, 1000);
                }
            }).catch((error: unknown) => { logError('unmount-save', error); });
        };
    }, [editor, editorReady, handleSave, idToTitle, isParsing, readMetadata, noteFilename, onOutgoingLinksChange, onUpdate, t]);

    return handleSave;
}
