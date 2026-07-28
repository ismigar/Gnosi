import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/**
 * FootnoteInline
 * Obsidian-style inline footnote. The mark is a clickable superscript; the
 * note text is stored in `props.content` and edited in a popover. The visible
 * number is calculated based on the order of appearance within the document (the
 * Markdown serialization renumbers with `[^N]` and appends the definitions at the bottom).
 *
 * The popover is rendered with `createPortal` on `body` to avoid being clipped or
 * displaced by ancestors with `transform` (see feedback_fixed_portal_animated_ancestor).
 */

// Collects the ids of all footnotes in the document in order to calculate the
// number for this one. Cheap: it's only called when the node itself renders.
const footnoteNumber = (editor, id) => {
    const ids = [];
    const walk = (blocks) => {
        for (const b of blocks || []) {
            if (Array.isArray(b?.content)) {
                for (const it of b.content) {
                    if (it?.type === 'footnote') ids.push(it.props?.id || '');
                }
            }
            if (Array.isArray(b?.children) && b.children.length) walk(b.children);
        }
    };
    try { walk(editor?.document || []); } catch { /* noop */ }
    const idx = ids.indexOf(id);
    return idx >= 0 ? idx + 1 : ids.length + 1;
};

export default function FootnoteInline({ inlineContent, updateInlineContent, editor }) {
    const { t } = useTranslation();
    const id = inlineContent?.props?.id || '';
    const text = String(inlineContent?.props?.content || '');
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(text);
    const markRef = useRef(null);
    const popRef = useRef(null);
    const [coords, setCoords] = useState(null);

    const num = footnoteNumber(editor, id);

    useEffect(() => { setDraft(text); }, [text]);

    // Positions the popover under the mark (viewport coordinates: position fixed).
    useLayoutEffect(() => {
        if (!open || !markRef.current) return;
        const r = markRef.current.getBoundingClientRect();
        setCoords({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 340) });
    }, [open]);

    const save = useCallback(() => {
        try { updateInlineContent({ type: 'footnote', props: { id, content: draft } }); } catch { /* noop */ }
        setOpen(false);
    }, [draft, id, updateInlineContent]);

    // Closes (saving) when clicking outside the popover and the mark.
    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => {
            if (popRef.current?.contains(e.target) || markRef.current?.contains(e.target)) return;
            save();
        };
        document.addEventListener('mousedown', onDown, true);
        return () => document.removeEventListener('mousedown', onDown, true);
    }, [open, save]);

    return (
        <span className="bn-footnote">
            <sup
                ref={markRef}
                contentEditable={false}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
                title={text || t('footnote.tooltip_hint', "Footnote (click to edit)")}
                className="mx-0.5 cursor-pointer select-none rounded px-1 text-[0.7em] font-semibold text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10"
            >
                [{num}]
            </sup>
            {open && coords && createPortal(
                <div
                    ref={popRef}
                    data-gnosi-portal="footnote"
                    style={{ position: 'fixed', top: coords.top, left: coords.left, width: 320, zIndex: 'var(--z-popover)' }}
                    className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 shadow-xl"
                >
                    <div className="mb-1 text-xs font-semibold text-[var(--text-tertiary)]">{t('footnote.label_numbered', "Footnote [{{num}}]", { num })}</div>
                    <textarea
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') { e.preventDefault(); save(); }
                            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); }
                        }}
                        placeholder={t('footnote.placeholder', "Write the note text…")}
                        className="h-24 w-full resize-y rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                    />
                    <div className="mt-1 flex justify-end">
                        <button
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); save(); }}
                            className="rounded px-2 py-1 text-xs font-medium text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10"
                        >
                            {t('common.save', "Save")}
                        </button>
                    </div>
                </div>,
                document.body,
            )}
        </span>
    );
}
