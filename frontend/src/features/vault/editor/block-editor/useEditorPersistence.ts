import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useRequestContext } from '../../../../shared/hooks/useRequestContext';
import { recordPersonalNoteEdit } from '../../../../shared/records/personalNoteEdits';
import type { RequestContext } from '../../../../shared/api/request-context';
import { patchEditedPage } from '../patchEditedPage';
import { GnosiApiError } from '../../../../shared/api/errors';
import { notifyError, logError } from '../../../../shared/notifications/notifyError';
import { blocksToRichMarkdown } from '../../../../shared/editor/markdown-mapper';
import { SAVED_FEEDBACK_DURATION_MS } from '../../../../shared/editor/SavedFeedback';
import { inFlightSaves } from '../editorState';
import { extractOutgoingPageLinks } from './outgoingLinks';
import type { MarkdownCodeEditorProps, CodeEditorMetadata } from './codeTypes';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export interface EditorChangeInfo {
    readonly getChanges: () => readonly { readonly source: { readonly type: string } }[];
}
export interface PersistenceEditor {
    readonly document: unknown;
    readonly onChange: (listener: (editor?: unknown, info?: EditorChangeInfo) => void) => (() => void) | { remove: () => void } | undefined;
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
    readonly isEditable?: boolean;
    readonly isPersonalChange?: (info?: EditorChangeInfo) => boolean;
    readonly metadataRef: RefObject<CodeEditorMetadata>;
    readonly setSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
    readonly onUpdate?: MarkdownCodeEditorProps['onUpdate'];
    readonly onOutgoingLinksChange?: MarkdownCodeEditorProps['onOutgoingLinksChange'];
    readonly idToTitle?: MarkdownCodeEditorProps['idToTitle'];
    readonly registerSave?: MarkdownCodeEditorProps['registerSave'];
}

/** Track exactly the promise whose completion is allowed to clear the cache. */
function savePage(scope: RequestContext, id: string, content: string, metadata: CodeEditorMetadata, untitled: string) {
    const data = { title: metadata.title || untitled, content, metadata };
    const promise = patchEditedPage(scope, id, data);
    inFlightSaves.set(id, { content, metadata, promise, timestamp: Date.now() });
    return { data, promise };
}
function clearOwnSave(id: string, promise: Promise<unknown>): void {
    if (inFlightSaves.get(id)?.promise === promise) inFlightSaves.delete(id);
}

export function useEditorPersistence({ editor, noteFilename, isParsing, editorReady, isEditable = true, isPersonalChange, metadataRef, setSaveStatus, onUpdate, onOutgoingLinksChange, idToTitle, registerSave }: EditorPersistenceOptions) {
    const { t } = useTranslation();
    const scope = useRequestContext();
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savedStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savedStatusScopeRef = useRef<object | null>(null);
    const cancelSavedStatusTimer = useCallback(() => {
        if (savedStatusTimerRef.current) clearTimeout(savedStatusTimerRef.current);
        savedStatusTimerRef.current = null;
    }, []);
    useLayoutEffect(() => {
        savedStatusScopeRef.current = {};
        return () => {
            savedStatusScopeRef.current = null;
            cancelSavedStatusTimer();
        };
    }, [cancelSavedStatusTimer, editor, noteFilename]);
    const transientRetryRef = useRef(0);
    const lastSaveFailedRef = useRef(false);
    const outgoingSignatureRef = useRef('');
    const contentRef = useRef<{
        editor: PersistenceEditor;
        noteFilename: string;
        saved: string;
        observed: string;
        personalEditAt?: number;
    } | null>(null);
    // This is a data ref, deliberately read at flush time, not a DOM ref.
    const readMetadata = useCallback(() => metadataRef.current, [metadataRef]);
    const handleSave = useCallback(async function persistCurrentPage(force = true) {
        if (!noteFilename || isParsing || !editorReady) return;
        const savedStatusScope = savedStatusScopeRef.current;
        lastSaveFailedRef.current = false;
        try {
            const content = blocksToRichMarkdown(editor.document);
            const tracked = contentRef.current;
            if (!force && tracked?.editor === editor && tracked.noteFilename === noteFilename
                && content === tracked.saved && !inFlightSaves.has(noteFilename)) return;
            cancelSavedStatusTimer();
            setSaveStatus('saving');
            const { data, promise } = savePage(scope, noteFilename, content, readMetadata(), t('editor.untitled'));
            const editedAt = tracked?.personalEditAt;
            try { recordPersonalNoteEdit(scope, await promise, editedAt); } finally { clearOwnSave(noteFilename, promise); }
            if (tracked && tracked.personalEditAt === editedAt) delete tracked.personalEditAt;
            if (tracked?.editor === editor && tracked.noteFilename === noteFilename) tracked.saved = data.content;
            transientRetryRef.current = 0;
            if (savedStatusScope && savedStatusScopeRef.current === savedStatusScope) {
                setSaveStatus('saved');
                cancelSavedStatusTimer();
                savedStatusTimerRef.current = setTimeout(() => {
                    savedStatusTimerRef.current = null;
                    setSaveStatus(previous => previous === 'saved' ? 'idle' : previous);
                }, SAVED_FEEDBACK_DURATION_MS);
            }
            onUpdate?.(noteFilename, data.content, { title: data.title, metadata: data.metadata });
        } catch (error) {
            lastSaveFailedRef.current = true;
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
    }, [cancelSavedStatusTimer, editor, editorReady, isParsing, readMetadata, noteFilename, onUpdate, scope, setSaveStatus, t]);

    const cancelPendingSave = useCallback(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
    }, []);
    const flush = useCallback(async () => {
        if (!noteFilename || isParsing || !editorReady) return false;
        for (let attempt = 0; attempt < 5; attempt += 1) {
            cancelPendingSave();
            const pending = inFlightSaves.get(noteFilename)?.promise;
            if (pending) {
                try { await pending; } catch { return false; }
                clearOwnSave(noteFilename, pending);
            }
            await handleSave(false);
            cancelPendingSave();
            if (lastSaveFailedRef.current) return false;
            if (!inFlightSaves.has(noteFilename) && contentRef.current?.saved === blocksToRichMarkdown(editor.document)) return true;
        }
        return false;
    }, [cancelPendingSave, editor, editorReady, handleSave, isParsing, noteFilename]);
    // Match the source editor's registration phase so the old mode cleans up
    // before the new mode publishes its save controller.
    useLayoutEffect(() => {
        registerSave?.(flush);
        return () => { registerSave?.(null); };
    }, [flush, registerSave]);

    useEffect(() => {
        if (isParsing || !editorReady || !noteFilename) return;
        // Compare serialized content, not block ids or editor change events:
        // rendering/normalization can emit events without changing the page.
        if (contentRef.current?.editor !== editor || contentRef.current.noteFilename !== noteFilename) {
            const content = blocksToRichMarkdown(editor.document);
            contentRef.current = { editor, noteFilename, saved: content, observed: content };
        }
        const tracked = contentRef.current;
        const subscription = editor.onChange((_editor, info) => {
            const content = blocksToRichMarkdown(editor.document);
            if (content === tracked.observed) return;
            tracked.observed = content;
            if (isEditable && (!isPersonalChange || isPersonalChange(info))) tracked.personalEditAt = Date.now();
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
            const { data, promise } = savePage(scope, noteFilename, content, readMetadata(), t('editor.untitled'));
            const editedAt = tracked.personalEditAt;
            void promise.then(page => {
                recordPersonalNoteEdit(scope, page, editedAt);
                tracked.saved = data.content;
                onUpdate?.(noteFilename, data.content, { title: data.title, metadata: data.metadata });
            }).finally(() => {
                if (inFlightSaves.get(noteFilename)?.promise === promise) {
                    setTimeout(() => { clearOwnSave(noteFilename, promise); }, 1000);
                }
            }).catch((error: unknown) => { logError('unmount-save', error); });
        };
    }, [editor, editorReady, handleSave, idToTitle, isEditable, isParsing, isPersonalChange, readMetadata, noteFilename, onOutgoingLinksChange, onUpdate, scope, t]);

    return handleSave;
}
