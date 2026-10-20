import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { useTranslation } from 'react-i18next';
import { patchVaultPage, type VaultPage } from '../../../../shared/api/vaults';
import { blocksToRichMarkdown, richMarkdownToBlocks } from '../../../../shared/editor/markdown-mapper';
import { VaultEditorContext, type VaultEditorContextValue } from '../../../../shared/editor/VaultEditorContext';
import { useTheme } from '../../../../shared/hooks/useTheme';
import { GnosiApiError } from '../../../../shared/api/errors';
import { notifyError } from '../../../../shared/notifications/notifyError';
import { createEditorSchema, type GnosiEditor } from './schema';
import { readEditorBlocks } from './blockValues';
import { transclusionRange, replaceTransclusion } from './transclusionDocument';
import { useMediaUpload } from './useMediaUpload';
import type { CodeEditorMetadata } from './codeTypes';
import { resolveBlockNoteDictionary } from '../locales/registry';
import '@blocknote/mantine/style.css';
import '@blocknote/react/style.css';

export function TransclusionContent({ page, section, context }: {
    page: VaultPage; section: string; context: VaultEditorContextValue;
}) {
    const { t, i18n } = useTranslation();
    const { effectiveTheme } = useTheme();
    const [schema] = useState(() => createEditorSchema(context));
    const metadataRef = useRef<CodeEditorMetadata>({ ...page.metadata, title: typeof page.title === 'string' ? page.title : '' });
    const editorRef = useRef<GnosiEditor | null>(null);
    const uploadFile = useMediaUpload(typeof page.metadata.table_id === 'string' ? page.metadata.table_id : '', metadataRef, editorRef);
    const editor = useCreateBlockNote({ schema, uploadFile, dictionary: resolveBlockNoteDictionary(i18n.resolvedLanguage || i18n.language) });
    useLayoutEffect(() => { editorRef.current = editor; }, [editor]);
    const [ready, setReady] = useState(false);
    const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
    const [loadError, setLoadError] = useState(() => transclusionRange(page.content, section) === null);
    const editable = context.isEditable !== false;
    const state = useRef({ source: page.content, etag: page.etag, saved: '', pending: '', busy: false, blocked: false });
    const mounted = useRef(true);

    useEffect(() => {
        let cancelled = false;
        const range = transclusionRange(page.content, section);
        if (!range) return;
        void richMarkdownToBlocks(page.content.slice(range.start, range.end), editor).then(parsed => {
            if (cancelled) return;
            const blocks = readEditorBlocks(parsed, schema);
            if (blocks.length) editor.replaceBlocks(editor.document, blocks);
            state.current.saved = state.current.pending = blocksToRichMarkdown(editor.document);
            setReady(true);
        }).catch(() => { if (!cancelled) setLoadError(true); });
        return () => { cancelled = true; };
    }, [editor, page.content, schema, section]);

    const flush = useCallback(async () => {
        const current = state.current;
        if (current.busy || current.blocked || current.pending === current.saved || !editable) return;
        current.busy = true;
        if (mounted.current) setStatus('saving');
        try {
            while (current.pending !== current.saved) {
                const snapshot = current.pending;
                const range = transclusionRange(current.source, section);
                if (!range) throw new Error('Transclusion section no longer exists');
                const content = replaceTransclusion(current.source, range, snapshot);
                const result = await patchVaultPage(page.id, { content, expected_etag: current.etag });
                current.source = result.content;
                // A missing revision must never fall back to an unguarded write.
                if (!result.etag) throw new Error('Missing page revision');
                current.etag = result.etag;
                current.saved = snapshot;
            }
            if (mounted.current) setStatus('saved');
        } catch (error) {
            const conflict = error instanceof GnosiApiError && error.status === 409;
            current.blocked = true;
            if (mounted.current) setStatus(conflict ? 'conflict' : 'error');
            notifyError('transclusion-save', error, t(conflict ? 'editor.transclusion_conflict' : 'editor.autosave_error'));
        } finally { current.busy = false; }
    }, [editable, page.id, section, t]);

    useEffect(() => {
        mounted.current = true;
        if (!ready || !editable) return () => { mounted.current = false; };
        let timer: ReturnType<typeof setTimeout> | undefined;
        const unsubscribe = editor.onChange(() => {
            state.current.pending = blocksToRichMarkdown(editor.document);
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { void flush(); }, 700);
        });
        return () => {
            mounted.current = false;
            unsubscribe();
            if (timer) clearTimeout(timer);
            void flush();
        };
    }, [editable, editor, ready, flush]);

    if (loadError) return <div role="alert">{t(section ? 'editor.section_not_found' : 'editor.preview_load_error')}</div>;
    if (!ready) return <div>{t('editor.loading_editor')}</div>;
    return <VaultEditorContext.Provider value={context}>
        <div onKeyDown={event => {
            event.stopPropagation();
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                void flush();
            }
        }} onPaste={event => { event.stopPropagation(); }} onClick={event => { event.stopPropagation(); }}>
            <BlockNoteView editor={editor} editable={editable} theme={effectiveTheme} />
        </div>
        <div className="text-xs text-[var(--text-tertiary)] mt-2" role="status" aria-live="polite">
            {status === 'saving' && t('editor.saving')}
            {status === 'saved' && t('editor.saved')}
            {status === 'conflict' && t('editor.transclusion_conflict')}
            {status === 'error' && <button type="button" onClick={() => { state.current.blocked = false; void flush(); }}>{t('common.retry')}</button>}
        </div>
    </VaultEditorContext.Provider>;
}
