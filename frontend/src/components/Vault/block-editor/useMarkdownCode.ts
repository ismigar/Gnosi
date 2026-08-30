import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { patchVaultPage } from '../../../shared/api/vaults';
import { toast } from '../../../lib/toast';
import { logError, notifyError } from '../../../lib/notifyError';
import { autoGrowTextarea } from './domSizing';
import { extractOutgoingPageLinks } from './outgoingLinks';
import { codeContent, type MarkdownCodeEditorProps, type MarkdownDraft } from './codeTypes';
import { inFlightSaves } from '../editorState';

export function useMarkdownCode({
    noteFilename, initialContent, metadata, idToTitle, onUpdate, onRefreshNotes, onOutgoingLinksChange,
}: MarkdownCodeEditorProps) {
    const { t } = useTranslation();
    const source = codeContent(initialContent);
    const [draft, setDraft] = useState<MarkdownDraft>(() => ({ source, text: source, dirty: false }));
    // Synchronize a clean draft during rendering, not after paint. Dirty edits
    // deliberately ignore stale save echoes. The owning component is keyed by page.
    if (!draft.dirty && draft.source !== source) setDraft({ source, text: source, dirty: false });
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const latestDraft = useRef(draft);
    const lastSavedText = useRef<string | null>(null);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const save = useCallback(async (text: string, { silent = true } = {}): Promise<boolean> => {
        if (!noteFilename) return false;
        const data = { title: metadata?.title || t('editor.untitled'), content: text, metadata: metadata || {} };
        try {
            const promise = patchVaultPage(noteFilename, data);
            // A mode switch mounts the visual editor before the parent receives
            // the saved response. Publish the draft synchronously for that handoff.
            inFlightSaves.set(noteFilename, { content: text, metadata: data.metadata, promise, timestamp: Date.now() });
            await promise;
            lastSavedText.current = text;
            onUpdate?.(noteFilename, text, { metadata: data.metadata, title: data.title });
            onRefreshNotes?.();
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
    }, [noteFilename, metadata, onUpdate, onRefreshNotes, t]);
    const latestSave = useRef(save);
    useLayoutEffect(() => {
        latestSave.current = save;
        latestDraft.current = draft;
    }, [save, draft]);
    useEffect(() => { autoGrowTextarea(textareaRef.current); }, [draft.text]);

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

    const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
        const text = event.target.value;
        setDraft(previous => ({ ...previous, dirty: true, text }));
        onOutgoingLinksChange?.(extractOutgoingPageLinks(text, idToTitle, noteFilename || ''));
    };
    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            void save(draft.text, { silent: false });
        }
    };
    return { text: draft.text, textareaRef, onChange, onKeyDown,
        ariaLabel: t('editor.markdown_mode'), placeholder: t('editor.markdown_empty_placeholder') };
}
