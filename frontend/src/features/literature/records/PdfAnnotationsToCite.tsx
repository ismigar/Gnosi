import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Highlighter, Quote, Copy, Loader2 } from 'lucide-react';
import { logError } from '../../../shared/notifications/notifyError';
import { toast } from '../../../shared/notifications/toast';
import {
    fetchPdfAnnotations,
    type PdfAnnotation,
} from '../../../shared/api/citations';


export interface PdfAnnotationsToCiteProps {
    readonly citationKey?: string | null;
    readonly readOnly?: boolean;
    readonly sourceUri?: string | null;
}


interface AnnotationState {
    readonly annotations: PdfAnnotation[];
    readonly sourceUri: string;
}

/**
 * List of PDF annotations for a Resource with a "copy as citation" action.
 *
 * UX:
 *   Loads the persisted annotations via `GET /api/vault/pdf-annotations?source_uri=...`
 *   (same endpoint as the integrated zotero-reader viewer — the format is already
 *   canonical Zotero: highlights with `text`, pageIndex, color, etc.).
 *
 *   For each highlight/note it shows:
 *     - Highlight color (chip)
 *     - Captured text (truncated with expansion on hover)
 *     - Page number
 *     - "Copy as quote markdown" button that puts on the clipboard:
 *
 *       > [text captured from the annotation]
 *       >
 *       > — [@citation_key], p. {page}
 *
 *       The user pastes it into the document; on render the `[@key]` resolves to
 *       a citation via CiteInline like any other Vault citation.
 *
 * Props:
 *   - sourceUri (string): PDF identifier (canonical file:// URL).
 *     Without this, the component loads nothing and warns.
 *   - citationKey (string): key of the owning Resource, to generate the citation.
 *     If missing, the quote is copied with a `[@?]` marker for the user
 *     to fill in later.
 *   - readOnly (bool): hides the action buttons (still shows the list).
 *
 * Pending integration (see `docs/dev_memory/directives/pdf_quote_capture.md`):
 *   - Detect `sourceUri` from the current Resources page (field
 *     `attachment_path` or `URL` pointing to a local PDF).
 *   - Wire it into the Properties panel or a new tab in the BlockEditor.
 *   - Optional: click-and-drag the quote into the document (drag & drop API)
 *     instead of copy/paste.
 */
export function PdfAnnotationsToCite({
    sourceUri,
    citationKey,
    readOnly = false,
}: PdfAnnotationsToCiteProps) {
    const { t } = useTranslation();
    const [annotationState, setAnnotationState] = useState<AnnotationState>({
        annotations: [],
        sourceUri: '',
    });
    const [copyingId, setCopyingId] = useState<number | null>(null);
    const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const loading = Boolean(sourceUri) && annotationState.sourceUri !== sourceUri;

    useEffect(() => {
        if (!sourceUri) return undefined;
        const controller = new AbortController();
        const loadAnnotations = async (): Promise<void> => {
            try {
                const data = await fetchPdfAnnotations(sourceUri, controller.signal);
                setAnnotationState({ annotations: data, sourceUri });
            } catch (error) {
                if (controller.signal.aborted) return;
                logError('pdf-annotations-load', error);
                setAnnotationState({ annotations: [], sourceUri });
            }
        };
        void loadAnnotations();
        return () => {
            controller.abort();
        };
    }, [sourceUri]);

    useEffect(() => () => {
        if (copyResetRef.current !== null) clearTimeout(copyResetRef.current);
    }, []);

    const highlights = useMemo(
        () => (annotationState.sourceUri === sourceUri
            ? annotationState.annotations
            : []
        ).filter((annotation) => (
            annotation.type === 'highlight' || annotation.type === 'note'
        )).filter((annotation) => annotation.text || annotation.comment),
        [annotationState, sourceUri],
    );

    const copyAsQuote = useCallback(async (ann: PdfAnnotation): Promise<void> => {
        const text = (ann.text || ann.comment || '').trim();
        if (!text) return;
        const page = ` p. ${String(ann.page + 1)}`;
        const cite = citationKey ? `[@${citationKey}]` : '[@?]';
        const quote = `> ${text}\n>\n> — ${cite}${page}\n`;
        try {
            await navigator.clipboard.writeText(quote);
            setCopyingId(ann.id);
            if (copyResetRef.current !== null) clearTimeout(copyResetRef.current);
            copyResetRef.current = setTimeout(() => {
                setCopyingId(null);
                copyResetRef.current = null;
            }, 1200);
            toast.success(t('pdf_quotes.copied', {
                defaultValue: "Quote copied to the clipboard. Paste it into the document.",
            }));
        } catch {
            toast.error(t('pdf_quotes.copy_failed', { defaultValue: "Error copying the quote" }));
        }
    }, [citationKey, t]);

    if (!sourceUri) {
        return (
            <div className="text-xs text-[var(--text-tertiary)] italic px-2 py-3">
                {t('pdf_quotes.no_source', {
                    defaultValue: "No PDF associated with this Resource (attachment_path field or URL).",
                })}
            </div>
        );
    }

    return (
        <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)]/30 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)]/50">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                    <Highlighter size={12} className="text-[var(--gnosi-primary)]/70" />
                    {t('pdf_quotes.title', { defaultValue: "PDF highlights" })}
                    <span className="font-normal text-[var(--text-tertiary)]">({highlights.length})</span>
                </div>
                {loading && <Loader2 size={12} className="animate-spin text-[var(--text-tertiary)]" />}
            </div>
            <div className="max-h-[360px] overflow-y-auto divide-y divide-[var(--border-primary)]/40">
                {!loading && highlights.length === 0 && (
                    <div className="px-3 py-4 text-center text-xs text-[var(--text-tertiary)] italic">
                        {t('pdf_quotes.empty', { defaultValue: "No highlights with text yet." })}
                    </div>
                )}
                {highlights.map((ann) => {
                    const text = (ann.text || ann.comment || '').trim();
                    return (
                        <div key={ann.id} className="px-3 py-2 flex items-start gap-2 hover:bg-[var(--bg-hover)]/40">
                            <div
                                className="w-1 self-stretch rounded shrink-0"
                                style={{ background: ann.color || '#ffd54f' }}
                            />
                            <div className="flex-1 min-w-0">
                                <p className="text-xs text-[var(--text-primary)] line-clamp-3">{text}</p>
                                <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                                    {t('pdf_quotes.page_label', { defaultValue: 'p.' })} {ann.page + 1}
                                </p>
                            </div>
                            {!readOnly && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        void copyAsQuote(ann);
                                    }}
                                    className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] hover:bg-[var(--bg-primary)] transition-colors"
                                    title={t('pdf_quotes.copy_quote', { defaultValue: "Copy as markdown quote" })}
                                >
                                    {copyingId === ann.id
                                        ? <Quote size={12} className="text-[var(--gnosi-primary)]" />
                                        : <Copy size={12} />}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default PdfAnnotationsToCite;
