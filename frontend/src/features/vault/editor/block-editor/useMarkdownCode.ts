import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { patchVaultPage } from '../../../../shared/api/vaults';
import { toast } from '../../../../shared/notifications/toast';
import { logError, notifyError } from '../../../../shared/notifications/notifyError';
import { extractOutgoingPageLinks } from './outgoingLinks';
import { codeContent, type MarkdownCodeEditorProps, type MarkdownDraft } from './codeTypes';
import { inFlightSaves } from '../editorState';

export function useMarkdownCode({
    noteFilename, initialContent, metadata, idToTitle, onUpdate, onRefreshNotes, onOutgoingLinksChange, readOnly, registerSave,
}: MarkdownCodeEditorProps) {
    const { t } = useTranslation();
    const source = codeContent(initialContent);
    const [draft, setDraft] = useState<MarkdownDraft>(() => ({ source, text: source, dirty: false }));
    // Synchronize a clean draft during rendering, not after paint. Dirty edits
    // deliberately ignore stale save echoes. The owning component is keyed by page.
    if (!draft.dirty && draft.source !== source) setDraft({ source, text: source, dirty: false });
    const latestDraft = useRef(draft);
    const latestSource = useRef(source);
    const saveQueue = useRef<Promise<unknown> | null>(null);
    const lastSavedText = useRef<string | null>(null);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const save = useCallback(async (text: string, { silent = true } = {}): Promise<boolean> => {
        if (!noteFilename || readOnly) return false;
        const data = { title: metadata?.title || t('editor.untitled'), content: text, metadata: metadata || {} };
        try {
            // Keep responses and disk writes ordered when typing continues
            // during a slow save. A failed write does not block a later retry.
            const persist = () => patchVaultPage(noteFilename, data);
            const promise = saveQueue.current ? saveQueue.current.then(persist, persist) : persist();
            saveQueue.current = promise;
            // A mode switch mounts the visual editor before the parent receives
            // the saved response. Publish the draft synchronously for that handoff.
            inFlightSaves.set(noteFilename, { content: text, metadata: data.metadata, promise, timestamp: Date.now() });
            await promise;
            lastSavedText.current = text;
            onUpdate?.(noteFilename, text, { metadata: data.metadata, title: data.title });
            onRefreshNotes?.();
            setDraft(previous => previous.text === text
                ? { source: latestSource.current, text, dirty: false } : previous);
            setTimeout(() => {
                if (inFlightSaves.get(noteFilename)?.promise === promise) inFlightSaves.delete(noteFilename);
            }, 1000);
            if (!silent) toast.success(t('editor.markdown_saved'));
            return true;
        } catch (error) {
            if (silent) logError('save-markdown', error);
            else notifyError('save-markdown', error, t('editor.markdown_save_error'));
            return false;
        }
    }, [noteFilename, metadata, onUpdate, onRefreshNotes, readOnly, t]);
    const latestSave = useRef(save);
    useLayoutEffect(() => {
        latestSave.current = save;
        latestDraft.current = draft;
        latestSource.current = source;
    }, [save, draft, source]);

    const flush = useCallback(async (): Promise<boolean> => {
        // Composer and similar operations must start from the latest settled
        // draft. Never report success while a pending save could overwrite them.
        for (let attempt = 0; attempt < 3; attempt += 1) {
            if (saveTimer.current !== null) { clearTimeout(saveTimer.current); saveTimer.current = null; }
            const pending = saveQueue.current;
            let failed = false;
            try { await pending; } catch { failed = true; }
            if (pending !== saveQueue.current) continue;
            const current = latestDraft.current;
            if (current.dirty && (failed || current.text !== lastSavedText.current)) {
                if (!await latestSave.current(current.text)) return false;
                continue;
            }
            return !failed;
        }
        return false;
    }, []);
    useLayoutEffect(() => {
        registerSave?.(flush);
        return () => { registerSave?.(null); };
    }, [flush, registerSave]);

    useEffect(() => {
        if (!draft.dirty) return;
        const timer = setTimeout(() => { void save(draft.text); }, 900);
        saveTimer.current = timer;
        return () => {
            clearTimeout(timer);
            if (saveTimer.current === timer) saveTimer.current = null;
        };
    }, [draft.text, draft.dirty, save]);

    useEffect(() => () => {
        if (saveTimer.current !== null) {
            clearTimeout(saveTimer.current);
            saveTimer.current = null;
        }
        const last = latestDraft.current;
        if (last.dirty && last.text !== lastSavedText.current) void latestSave.current(last.text);
    }, []);

    const onChange = (text: string) => {
        if (readOnly) return;
        setDraft(previous => ({ ...previous, dirty: true, text }));
        onOutgoingLinksChange?.(extractOutgoingPageLinks(text, idToTitle, noteFilename || ''));
    };
    const onSave = () => { void save(draft.text, { silent: false }); };
    return { text: draft.text, onChange, onSave,
        ariaLabel: t('editor.markdown_mode'), placeholder: t('editor.markdown_empty_placeholder') };
}
