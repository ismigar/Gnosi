import React, { useEffect, useMemo, useState, useCallback } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { Highlighter, Quote, Copy, Loader2 } from 'lucide-react';
import { toast } from '../../lib/toast';

/**
 * Llistat d'anotacions PDF d'un Recurs amb acció "copia com a cita".
 *
 * UX:
 *   Carrega les anotacions persistides via `GET /api/vault/pdf-annotations?source_uri=...`
 *   (mateix endpoint que el visor zotero-reader integrat — el format ja és
 *   canonical Zotero: highlights amb `text`, pageIndex, color, etc.).
 *
 *   Per cada highlight/note mostra:
 *     - Color de subratllat (chip)
 *     - Text capturat (truncat amb expansió on hover)
 *     - Número de pàgina
 *     - Botó "Copiar com a quote markdown" que posa al portaretalls:
 *
 *       > [text capturat de l'anotació]
 *       >
 *       > — [@citation_key], p. {page}
 *
 *       L'usuari el pega al document; al render el `[@key]` es resol a
 *       una cita via CiteInline com qualsevol altra cita Vault.
 *
 * Props:
 *   - sourceUri (string): identificador del PDF (file:// URL canonical).
 *     Sense això, el component no carrega res i avisa.
 *   - citationKey (string): clau del Recurs propietari, per generar la cita.
 *     Si falta, la quote es copia amb un marcador `[@?]` perquè l'usuari
 *     l'ompli després.
 *   - readOnly (bool): amaga els botons d'acció (encara mostra el llistat).
 *
 * Integració pendent (vegis `docs/dev_memory/directives/pdf_quote_capture.md`):
 *   - Detectar `sourceUri` a partir de la pàgina Recursos actual (camp
 *     `attachment_path` o `URL` que apunti a un PDF local).
 *   - Cablejar al panell Propietats o a una pestanya nova al BlockEditor.
 *   - Opcional: clic-i-arrossega de la quote al document (drag & drop API)
 *     en lloc de copy/paste.
 */
export function PdfAnnotationsToCite({ sourceUri, citationKey, readOnly = false }) {
    const { t } = useTranslation();
    const [annotations, setAnnotations] = useState([]);
    const [loading, setLoading] = useState(false);
    const [copyingId, setCopyingId] = useState(null);

    useEffect(() => {
        if (!sourceUri) {
            setAnnotations([]);
            return;
        }
        let cancelled = false;
        setLoading(true);
        axios.get('/api/vault/pdf-annotations', { params: { source_uri: sourceUri } })
            .then((r) => { if (!cancelled) setAnnotations(Array.isArray(r.data) ? r.data : []); })
            .catch((err) => {
                console.warn('PdfAnnotationsToCite: load failed', err?.message);
                if (!cancelled) setAnnotations([]);
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [sourceUri]);

    const highlights = useMemo(
        () => annotations.filter((a) => a.type === 'highlight' || a.type === 'note').filter((a) => (a.text || a.comment)),
        [annotations],
    );

    const copyAsQuote = useCallback(async (ann) => {
        const text = (ann.text || ann.comment || '').trim();
        if (!text) return;
        const page = (ann.page != null) ? ` p. ${ann.page + 1}` : '';
        const cite = citationKey ? `[@${citationKey}]` : '[@?]';
        const quote = `> ${text}\n>\n> — ${cite}${page}\n`;
        try {
            await navigator.clipboard.writeText(quote);
            setCopyingId(ann.id);
            setTimeout(() => setCopyingId(null), 1200);
            toast.success(t('pdf_quotes.copied', {
                defaultValue: 'Quote copiada al portaretalls. Pega-la al document.',
            }));
        } catch (err) {
            toast.error(t('pdf_quotes.copy_failed', { defaultValue: 'Error copiant la quote' }));
        }
    }, [citationKey, t]);

    if (!sourceUri) {
        return (
            <div className="text-xs text-[var(--text-tertiary)] italic px-2 py-3">
                {t('pdf_quotes.no_source', {
                    defaultValue: 'No hi ha PDF associat a aquest Recurs (camp attachment_path o URL).',
                })}
            </div>
        );
    }

    return (
        <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)]/30 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)]/50">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                    <Highlighter size={12} className="text-[var(--gnosi-primary)]/70" />
                    {t('pdf_quotes.title', { defaultValue: 'Subratllats del PDF' })}
                    <span className="font-normal text-[var(--text-tertiary)]">({highlights.length})</span>
                </div>
                {loading && <Loader2 size={12} className="animate-spin text-[var(--text-tertiary)]" />}
            </div>
            <div className="max-h-[360px] overflow-y-auto divide-y divide-[var(--border-primary)]/40">
                {!loading && highlights.length === 0 && (
                    <div className="px-3 py-4 text-center text-xs text-[var(--text-tertiary)] italic">
                        {t('pdf_quotes.empty', { defaultValue: 'Cap subratllat amb text encara.' })}
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
                                {ann.page != null && (
                                    <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                                        {t('pdf_quotes.page_label', { defaultValue: 'p.' })} {ann.page + 1}
                                    </p>
                                )}
                            </div>
                            {!readOnly && (
                                <button
                                    type="button"
                                    onClick={() => copyAsQuote(ann)}
                                    className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] hover:bg-[var(--bg-primary)] transition-colors"
                                    title={t('pdf_quotes.copy_quote', { defaultValue: 'Copia com a quote markdown' })}
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
