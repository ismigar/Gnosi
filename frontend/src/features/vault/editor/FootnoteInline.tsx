import { useCallback, useEffect, useRef, useState } from 'react';
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
interface FootnoteContentItem {
    readonly props?: { readonly id?: string | null };
    readonly type?: string;
}

interface FootnoteDocumentBlock {
    readonly children?: readonly FootnoteDocumentBlock[];
    readonly content?: readonly FootnoteContentItem[] | string;
}

interface FootnoteEditor {
    readonly document?: readonly FootnoteDocumentBlock[];
}

interface FootnoteInlineContent {
    readonly props?: {
        readonly content?: string | null;
        readonly id?: string | null;
    };
}

interface FootnoteUpdate {
    readonly props: {
        readonly content: string;
        readonly id: string;
    };
    readonly type: 'footnote';
}

export interface FootnoteInlineProps {
    readonly editor?: FootnoteEditor | null;
    readonly inlineContent?: FootnoteInlineContent | null;
    readonly updateInlineContent: (content: FootnoteUpdate) => unknown;
}

interface PopoverCoordinates {
    readonly left: number;
    readonly top: number;
}

function footnoteNumber(editor: FootnoteEditor | null | undefined, id: string): number {
    const ids: string[] = [];
    const walk = (blocks: readonly FootnoteDocumentBlock[]): void => {
        for (const block of blocks) {
            const content = block.content;
            if (content && typeof content !== 'string') {
                for (const item of content) {
                    if (item.type === 'footnote') ids.push(item.props?.id || '');
                }
            }
            if (block.children?.length) walk(block.children);
        }
    };
    try { walk(editor?.document ?? []); } catch { /* noop */ }
    const idx = ids.indexOf(id);
    return idx >= 0 ? idx + 1 : ids.length + 1;
}

export default function FootnoteInline({
    inlineContent,
    updateInlineContent,
    editor,
}: FootnoteInlineProps) {
    const { t } = useTranslation();
    const id = inlineContent?.props?.id || '';
    const text = inlineContent?.props?.content || '';
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(text);
    const markRef = useRef<HTMLElement>(null);
    const popRef = useRef<HTMLDivElement>(null);
    const [coords, setCoords] = useState<PopoverCoordinates | null>(null);

    const num = footnoteNumber(editor, id);

    useEffect(() => {
        let active = true;
        queueMicrotask(() => {
            if (active) setDraft(text);
        });
        return () => {
            active = false;
        };
    }, [text]);

    const save = useCallback(() => {
        try { updateInlineContent({ type: 'footnote', props: { id, content: draft } }); } catch { /* noop */ }
        setOpen(false);
    }, [draft, id, updateInlineContent]);

    // Closes (saving) when clicking outside the popover and the mark.
    useEffect(() => {
        if (!open) return undefined;
        const onDown = (event: MouseEvent): void => {
            if (!(event.target instanceof Node)) return;
            if (popRef.current?.contains(event.target) || markRef.current?.contains(event.target)) return;
            save();
        };
        document.addEventListener('mousedown', onDown, true);
        return () => {
            document.removeEventListener('mousedown', onDown, true);
        };
    }, [open, save]);

    const togglePopover = (): void => {
        if (!open && markRef.current) {
            const rect = markRef.current.getBoundingClientRect();
            setCoords({
                top: rect.bottom + 6,
                left: Math.min(rect.left, window.innerWidth - 340),
            });
        }
        setOpen((value) => !value);
    };

    return (
        <span className="bn-footnote">
            <sup
                ref={markRef}
                contentEditable={false}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    togglePopover();
                }}
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
                        onChange={(event) => {
                            setDraft(event.target.value);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') { event.preventDefault(); save(); }
                            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); save(); }
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
