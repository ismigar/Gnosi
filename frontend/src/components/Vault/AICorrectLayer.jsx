import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Sparkles, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '../ConfirmModal';
import { correctAiContent } from '../../shared/api/ai';

/**
 * AICorrectLayer
 * "Correct with AI": a floating button over the selection (corrects the selection or the
 * current paragraph) and correction of the whole page via the
 * `gnosi:ai-correct-page` event. Reuses `POST /api/ai/correct`.
 */
export default function AICorrectLayer({ editor, lang }) {
    const { t } = useTranslation();
    const [btn, setBtn] = useState(null);   // {top,left} of the selection button
    const [busy, setBusy] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const busyRef = useRef(false);

    const view = useCallback(() => editor?.prosemirrorView || null, [editor]);

    const callCorrect = useCallback(async (text, scope) => {
        const data = await correctAiContent({
            text,
            language: lang || undefined,
            scope,
        });
        return (data?.corrected || '').trim();
    }, [lang]);

    // Corrects the selection (or the current paragraph if the selection is empty).
    const correctSelection = useCallback(async () => {
        const v = view();
        if (!v || busyRef.current) return;
        const { state } = v;
        const sel = state.selection;
        let from = sel.from;
        let to = sel.to;
        if (sel.empty) {
            const $f = sel.$from;
            from = $f.start();
            to = $f.end();
        }
        const text = state.doc.textBetween(from, to, '\n').trim();
        if (!text) return;
        setBtn(null);
        busyRef.current = true; setBusy(true);
        try {
            const corrected = await callCorrect(text, sel.empty ? 'block' : 'selection');
            if (corrected && corrected !== text) {
                const vv = view();
                vv.dispatch(vv.state.tr.insertText(corrected, from, to));
                vv.focus();
                toast.success(t('ai_correct.text_corrected', "Text corrected"));
            } else {
                toast(t('ai_correct.no_correction', "No correction needed"));
            }
        } catch (err) {
            toast.error(err instanceof Error && err.message
                ? err.message
                : t('ai_correct.selection_error', "Could not correct"));
        } finally {
            busyRef.current = false; setBusy(false);
        }
    }, [view, callCorrect, t]);

    // Corrects the entire page (markdown → AI → blocks).
    const correctPage = useCallback(async () => {
        if (!editor || busyRef.current) return;
        busyRef.current = true; setBusy(true);
        const tid = toast.loading(t('ai_correct.correcting_page', "Correcting the page with AI…"));
        try {
            const md = await editor.blocksToMarkdownLossy(editor.document);
            if (!md.trim()) { toast.dismiss(tid); return; }
            const corrected = await callCorrect(md, 'page');
            if (!corrected) { toast.dismiss(tid); return; }
            const newBlocks = await editor.tryParseMarkdownToBlocks(corrected);
            editor.replaceBlocks(editor.document, newBlocks);
            toast.success(t('ai_correct.page_corrected', "Page corrected"), { id: tid });
        } catch (err) {
            toast.error(err instanceof Error && err.message
                ? err.message
                : t('ai_correct.page_error', "Could not correct the page"), { id: tid });
        } finally {
            busyRef.current = false; setBusy(false);
        }
    }, [editor, callCorrect, t]);

    // Listens for the page-correction request (from the editor header):
    // opens the confirmation modal (an action that replaces all the content).
    useEffect(() => {
        const h = () => setConfirmOpen(true);
        window.addEventListener('gnosi:ai-correct-page', h);
        return () => window.removeEventListener('gnosi:ai-correct-page', h);
    }, []);

    // Shows the floating button when there is a selection within the editor.
    useEffect(() => {
        if (!editor) return undefined;
        const onUp = () => {
            setTimeout(() => {
                if (busyRef.current) return;
                const s = window.getSelection();
                if (!s || s.isCollapsed || !s.toString().trim()) { setBtn(null); return; }
                const anchor = s.anchorNode;
                const el = anchor?.nodeType === 3 ? anchor.parentElement : anchor;
                if (!el?.closest?.('.ProseMirror')) { setBtn(null); return; }
                if (el.closest('[data-gnosi-portal]')) return;
                const rect = s.getRangeAt(0).getBoundingClientRect();
                setBtn({ top: rect.top - 38, left: rect.left + rect.width / 2 + 8 });
            }, 10);
        };
        document.addEventListener('mouseup', onUp);
        document.addEventListener('keyup', onUp);
        return () => {
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('keyup', onUp);
        };
    }, [editor]);

    return (
        <>
            {btn && !busy && createPortal(
                <button
                    data-gnosi-portal="ai-correct-btn"
                    onMouseDown={(e) => { e.preventDefault(); correctSelection(); }}
                    style={{ position: 'fixed', top: btn.top, left: btn.left, zIndex: 'var(--z-popover)' }}
                    className="flex items-center gap-1 rounded-full bg-[var(--gnosi-primary)] px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:opacity-90"
                >
                    <Sparkles size={14} /> {t('ai_correct.button', "Correct (AI)")}
                </button>, document.body)}

            {busy && createPortal(
                <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 'var(--z-notification)' }}
                    className="flex items-center gap-2 rounded-lg bg-[var(--gnosi-primary)] px-3 py-2 text-sm text-white shadow-xl">
                    <Loader2 size={16} className="animate-spin" /> {t('ai_correct.correcting', "Correcting with AI…")}
                </div>, document.body)}

            <ConfirmModal
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={async () => { setConfirmOpen(false); await correctPage(); }}
                title={t('ai_correct.confirm_title', "Correct the whole page with AI")}
                message={t('ai_correct.confirm_message', "The page content will be replaced with the corrected version. You can undo it with Ctrl/Cmd+Z.")}
                confirmText={t('ai_correct.confirm_button', "Correct")}
                cancelText={t('common.cancel', "Cancel")}
                isDestructive={false}
            />
        </>
    );
}
