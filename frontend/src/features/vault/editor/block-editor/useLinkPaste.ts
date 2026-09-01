import { useCallback, useEffect, useState } from 'react';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { fetchLinkPreview } from '../../../../shared/api/links';
import { compactUrlLabel } from '../contextualLinkPasteUtils';
import type { ContextualLinkPasteMode } from '../ContextualLinkPasteMenu';
import type { GnosiEditor } from './schema';
import type { LinkPasteContext } from './editor-effects/types';

export function useLinkPaste(editor: GnosiEditor, idToTitle: Readonly<Record<string, string>>) {
    const [linkCardCtx, setLinkCardCtx] = useState<{ editor: GnosiEditor } | null>(null);
    const [linkPasteCtx, setLinkPasteCtx] = useState<LinkPasteContext | null>(null);
    const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
    useEffect(() => {
        const url = linkPasteCtx?.url;
        if (!url || linkPasteCtx.internalPageId) return;
        let cancelled = false;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => { controller.abort(); }, 4000);
        void fetchLinkPreview(url, controller.signal).then(response => {
            if (!cancelled) setPreview({ url, title: (response.title || '').trim() });
        }).catch(() => { /* hostname fallback keeps mention insertion available */ })
            .finally(() => { window.clearTimeout(timeout); });
        return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout); };
    }, [linkPasteCtx?.internalPageId, linkPasteCtx?.url]);
    const doLinkCard = (raw: string) => {
        const context = linkCardCtx; setLinkCardCtx(null);
        const url = raw.trim();
        if (url && /^https?:\/\//i.test(url) && context) insertOrUpdateBlockForSlashMenu(context.editor, { type: 'linkcard', props: { url } });
    };
    const closeContextualLinkPaste = useCallback(() => {
        setLinkPasteCtx(null); try { editor.focus(); } catch { /* unmounted editor */ }
    }, [editor]);
    const applyContextualLinkPaste = useCallback((mode: ContextualLinkPasteMode) => {
        const context = linkPasteCtx; if (!context?.url) return;
        setLinkPasteCtx(null);
        try {
            const anchor = editor.getBlock(context.anchorBlockId);
            if (anchor) editor.setTextCursorPosition(anchor.id, 'start');
            if (mode === 'bookmark') insertOrUpdateBlockForSlashMenu(editor, { type: 'linkcard', props: { url: context.url } });
            else if (mode === 'embed') insertOrUpdateBlockForSlashMenu(editor, { type: 'embed', props: { url: context.url, caption: '' } });
            else if (mode === 'mention' && context.internalPageId) editor.insertInlineContent([{ type: 'wikilink', props: { target: context.internalPageId, title: idToTitle[context.internalPageId] || context.internalPageId } }]);
            else {
                const title = preview?.url === context.url ? preview.title : '';
                const label = mode === 'mention' ? title || compactUrlLabel(context.url) : context.url;
                editor.insertInlineContent([{ type: 'link', href: context.url, content: [{ type: 'text', text: label, styles: {} }] }]);
            }
            editor.focus();
        } catch (error) { console.error('contextual link paste failed', error); }
    }, [editor, idToTitle, linkPasteCtx, preview]);
    return { linkCardCtx, setLinkCardCtx, linkPasteCtx, setLinkPasteCtx, doLinkCard, closeContextualLinkPaste, applyContextualLinkPaste };
}
