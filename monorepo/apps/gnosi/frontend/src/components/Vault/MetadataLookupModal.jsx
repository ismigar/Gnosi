import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { Search, X, Loader2, Check } from 'lucide-react';
import { toast } from '../../lib/toast';
import { LABEL_TO_ZOTERO_TYPE, ZOTERO_TYPE_LABELS, ZOTERO_TO_CSL_TYPE } from './zoteroSchema';
import { isFieldRelevantForType } from './recursosZoteroMapping';
import { validateIdentifier } from './identifierValidators';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

/**
 * Normalitza un valor d'"Item Type" del lookup (pot venir com a clau Zotero
 * canònica `journalArticle` o com a label traduït `Article de revista
 * acadèmica`) a la clau canònica. Retorna null si no es reconeix.
 */
function resolveZoteroType(raw) {
    if (!raw || typeof raw !== 'string') return null;
    if (raw in ZOTERO_TO_CSL_TYPE) return raw;          // ja canònica
    for (const loc of Object.keys(LABEL_TO_ZOTERO_TYPE)) {
        const zot = LABEL_TO_ZOTERO_TYPE[loc][raw];
        if (zot) return zot;
    }
    return null;
}

/**
 * Modal d'enriquiment de metadades a partir de DOI / ISBN / arXiv / PMID / URL.
 *
 * Flow:
 *   1. L'usuari clica "Omplir metadades" al panell Propietats d'una pàgina
 *      de Recursos (botó renderitzat al `BlockEditor`).
 *   2. El modal s'obre detectant identificadors als camps actuals
 *      (DOI > arXiv > ISBN > URL — mateixa prioritat que el backend).
 *      L'usuari pot canviar el valor o forçar un identificador concret.
 *   3. Clica "Cerca" → POST a `/api/vault/lookup-metadata`.
 *   4. Mostra una taula amb cada camp detectat:
 *        - checkbox (defaut: marcat només si l'actual està buit)
 *        - nom del camp
 *        - valor actual (gris)
 *        - valor proposat (negre)
 *   5. "Aplica selecció" → callback amb el patch de camps seleccionats.
 *      El crida `onApply({fieldName: newValue, ...})` perquè el caller
 *      ja té handleMetaChange o el PATCH backend.
 *
 * Mai escriu res per si sol; sempre confirmació de l'usuari.
 */
const SOURCE_LABELS = {
    crossref: 'CrossRef (DOI)',
    openlibrary: 'Open Library (ISBN)',
    arxiv: 'arXiv (preprint)',
    pubmed: 'PubMed (PMID)',
    web: 'Zotero translation-server (web)',
    url: 'Open Graph / meta tags (URL)',
};

// Mapeig de l'idioma de la UI (react-i18next: ca / es / en / fr, o variants
// regionals com en-US) al codi de locale de `ZOTERO_TYPE_LABELS`. Mateix patró
// que `GNOSI_TO_ZOTERO_LOCALE` a ZoteroReaderTab. Si l'idioma no hi és, fallback
// a 'en-US' (sempre present al schema). Vegeu build_constants.py::LOCALES.
const UI_LANG_TO_ZOTERO_LOCALE = {
    ca: 'ca-AD',
    es: 'es-ES',
    en: 'en-US',
    fr: 'fr-FR',
};

/** Retorna el label traduït del tipus Zotero segons l'idioma actiu de la UI.
 *  Cau a la clau canònica (`zoteroType`) si el tipus no té label al locale. */
function zoteroTypeLabel(zoteroType, uiLanguage) {
    if (!zoteroType) return null;
    const base = String(uiLanguage || 'ca').split('-')[0];
    const locale = UI_LANG_TO_ZOTERO_LOCALE[base] || 'en-US';
    return ZOTERO_TYPE_LABELS[locale]?.[zoteroType]
        || ZOTERO_TYPE_LABELS['en-US']?.[zoteroType]
        || zoteroType;
}

export const MetadataLookupModal = ({
    isOpen,
    onClose,
    onApply,
    onCreate,
    mode = 'enrich',
    currentMetadata = {},
}) => {
    const { t, i18n } = useTranslation();
    // Estat: identificadors editables + selecció + resposta
    const [doi, setDoi] = useState('');
    const [isbn, setIsbn] = useState('');
    const [arxivId, setArxivId] = useState('');
    const [pmid, setPmid] = useState('');
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null); // { source, identifier, suggested, error }
    const [selectedFields, setSelectedFields] = useState({}); // { fieldName: bool }
    const firstInputRef = useRef(null);
    const pdfInputRef = useRef(null);
    const panelRef = useRef(null);

    // Post-processat comú d'una resposta (lookup per identificador o per PDF):
    // desa el resultat i pre-marca els camps que ara estan buits.
    const populateFromResult = useCallback((data) => {
        const sug = data?.suggested || {};
        // Mode 'create' (alta des del menú Nou de la taula): sense pas de
        // confirmació — en tenir dades, crea la fitxa directament i tanca.
        // El `suggested` ja porta `Citation Key` generada pel backend.
        if (mode === 'create') {
            if (data?.error || Object.keys(sug).length === 0) {
                toast.error(data?.error || t('metadata_lookup.no_data', {
                    defaultValue: 'No s\'ha trobat cap dada.',
                }));
                return;
            }
            onCreate?.(sug);
            onClose?.();
            return;
        }
        setResult(data);
        const newSel = {};
        Object.keys(sug).forEach((k) => {
            const current = currentMetadata?.[k];
            const isEmpty = current === null || current === undefined || current === '' || (Array.isArray(current) && current.length === 0);
            newSel[k] = isEmpty;
        });
        setSelectedFields(newSel);
        if (data?.error) toast.error(data.error);
    }, [currentMetadata, mode, onCreate, onClose, t]);

    // Detectar identificadors actuals al obrir
    useEffect(() => {
        if (!isOpen) return;
        setDoi(String(currentMetadata?.DOI || '').trim());
        setIsbn(String(currentMetadata?.ISBN || '').trim());
        setArxivId('');
        setPmid(String(currentMetadata?.PMID || '').trim());
        setUrl(String(currentMetadata?.URL || '').trim());
        setResult(null);
        setSelectedFields({});
        const id = requestAnimationFrame(() => {
            try { firstInputRef.current?.focus(); } catch { /* ignore */ }
        });
        return () => cancelAnimationFrame(id);
    }, [isOpen, currentMetadata]);

    const handleSearch = useCallback(async () => {
        const payload = {
            doi: doi.trim() || undefined,
            isbn: isbn.trim() || undefined,
            arxiv: arxivId.trim() || undefined,
            pmid: pmid.trim() || undefined,
            url: url.trim() || undefined,
        };
        if (!payload.doi && !payload.isbn && !payload.arxiv && !payload.pmid && !payload.url) {
            toast.error(t('metadata_lookup.no_identifier', {
                defaultValue: 'Cal un DOI, ISBN, arXiv id, PMID o URL',
            }));
            return;
        }
        setLoading(true);
        try {
            const onlyUrl = payload.url && !payload.doi && !payload.isbn && !payload.arxiv && !payload.pmid;
            let r;
            if (onlyUrl) {
                // Captura web rica via Zotero translation-server; si no respon,
                // fallback als meta tags (Open Graph/Highwire) de /lookup-metadata.
                r = await axios.post('/api/vault/translate-url', { url: payload.url });
                const sug = r.data?.suggested;
                if (r.data?.error && (!sug || Object.keys(sug).length === 0)) {
                    r = await axios.post('/api/vault/lookup-metadata', payload);
                }
            } else {
                r = await axios.post('/api/vault/lookup-metadata', payload);
            }
            populateFromResult(r.data);
        } catch (err) {
            console.error('lookup failed:', err?.message);
            toast.error(t('metadata_lookup.fetch_failed', {
                defaultValue: 'Error consultant fonts externes',
            }));
        } finally {
            setLoading(false);
        }
    }, [doi, isbn, arxivId, pmid, url, populateFromResult, t]);

    // P4: reconeixement des d'un PDF (extreu DOI/arXiv → lookup).
    const handlePdfUpload = useCallback(async (e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // permet re-seleccionar el mateix fitxer
        if (!file) return;
        setLoading(true);
        try {
            const fd = new FormData();
            fd.append('file', file);
            const r = await axios.post('/api/vault/recognize-pdf', fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            populateFromResult(r.data);
        } catch (err) {
            console.error('pdf recognize failed:', err?.message);
            toast.error(t('metadata_lookup.pdf_failed', {
                defaultValue: 'Error reconeixent el PDF',
            }));
        } finally {
            setLoading(false);
        }
    }, [populateFromResult, t]);

    const handleApply = useCallback(() => {
        const sug = result?.suggested || {};
        const patch = {};
        for (const [k, v] of Object.entries(sug)) {
            if (selectedFields[k]) patch[k] = v;
        }
        if (Object.keys(patch).length === 0) {
            toast.error(t('metadata_lookup.nothing_selected', {
                defaultValue: 'Cap camp seleccionat',
            }));
            return;
        }
        try {
            onApply?.(patch);
            toast.success(t('metadata_lookup.applied', {
                defaultValue: `${Object.keys(patch).length} camps actualitzats`,
                count: Object.keys(patch).length,
            }));
            onClose?.();
        } catch (err) {
            console.error('apply failed:', err?.message);
            toast.error(t('metadata_lookup.apply_failed', {
                defaultValue: 'Error aplicant els canvis',
            }));
        }
    }, [result, selectedFields, onApply, onClose, t]);

    const handleKeyDown = useCallback((e) => {
        // L'Esc el gestiona useModalKeyboard (captura, robust). Aquí només
        // mantenim Enter=cerca mentre encara no hi ha resultat.
        if (e.key === 'Enter' && !e.shiftKey && !loading && !result) {
            e.preventDefault();
            handleSearch();
        }
    }, [loading, result, handleSearch]);

    const portalEl = useMemo(() => {
        if (typeof document === 'undefined') return null;
        let el = document.getElementById('metadata-lookup-root');
        if (!el) {
            el = document.createElement('div');
            el.id = 'metadata-lookup-root';
            document.body.appendChild(el);
        }
        return el;
    }, []);

    // Dades derivades del resultat. Es calculen ABANS del primer `return`
    // condicional perquè el `useMemo` de sota és un hook: per la regla dels
    // hooks de React no pot quedar després d'un early return. Si hi quedés, en
    // obrir el modal (isOpen false→true) es renderitzarien més hooks que al
    // render anterior → "Rendered more hooks than during the previous render".
    const sug = result?.suggested || {};
    const fieldEntries = Object.entries(sug);
    // L2: agrupa entries per rellevància segons el tipus Zotero del resultat.
    // `Item Type` no apareix a la taula (es mostra com a badge al header).
    // Si no es reconeix el tipus, tot va a "altres" (la taula es renderitza
    // com una sola secció, sense capçalera de grup).
    const zoteroType = resolveZoteroType(sug['Item Type']);
    const { relevantEntries, otherEntries } = useMemo(() => {
        const rel = [], oth = [];
        for (const [k, v] of fieldEntries) {
            if (k === 'Item Type') continue;
            if (zoteroType && isFieldRelevantForType(k, zoteroType)) rel.push([k, v]);
            else oth.push([k, v]);
        }
        return { relevantEntries: rel, otherEntries: oth };
    }, [fieldEntries, zoteroType]);

    // Esc + focus-trap centralitzats al hook canònic (abans de l'early-return
    // per no introduir hooks condicionals). NO passem onConfirm: l'Enter
    // d'aquest modal el gestiona handleKeyDown (Enter=cerca quan no hi ha
    // resultat).
    useModalKeyboard({ isOpen, onClose, containerRef: panelRef, trapFocus: true });

    if (!isOpen || !portalEl) return null;

    // PR #5: validació format dels identificadors. Si el valor és buit la
    // validació no s'aplica (no tots els camps són obligatoris). Si té
    // format invàlid, mostrem hint sota l'input + bloquem la cerca per
    // estalviar el roundtrip.
    const vDoi = validateIdentifier('doi', doi);
    const vIsbn = validateIdentifier('isbn', isbn);
    const vArxiv = validateIdentifier('arxiv', arxivId);
    const vPmid = validateIdentifier('pmid', pmid);
    const vUrl = validateIdentifier('url', url);
    const allValid = vDoi.valid && vIsbn.valid && vArxiv.valid && vPmid.valid && vUrl.valid;
    const hasIdentifier = !!(doi.trim() || isbn.trim() || arxivId.trim() || pmid.trim() || url.trim());
    const canSearch = hasIdentifier && allValid;
    const inputCls = (valid) =>
        `px-2 py-1.5 text-sm rounded-md border bg-[var(--bg-primary)] outline-none transition-colors ${
            valid
                ? 'border-[var(--border-primary)] focus:border-[var(--gnosi-primary)]'
                : 'border-red-500 focus:border-red-600'
        }`;
    const hintCls = "text-[10px] text-red-500 mt-0.5";

    const allSelected = fieldEntries.length > 0 && fieldEntries.every(([k]) => selectedFields[k]);
    // Label del tipus Zotero en l'idioma actiu de la UI (abans sempre ca-AD).
    const typeLabel = zoteroTypeLabel(zoteroType, i18n?.language);

    return ReactDOM.createPortal(
        <div
            className="fixed inset-0 z-[9999] flex items-start justify-center pt-16 bg-black/40"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
            onKeyDown={handleKeyDown}
        >
            <div
                ref={panelRef}
                className="w-full max-w-3xl rounded-xl shadow-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] overflow-hidden max-h-[85vh] flex flex-col"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-secondary)] shrink-0">
                    <Search size={18} className="text-[var(--text-tertiary)]" />
                    <div className="flex-1 text-sm font-medium text-[var(--text-primary)]">
                        {mode === 'create'
                            ? t('metadata_lookup.create_title', { defaultValue: 'Crear des d\'una font' })
                            : t('metadata_lookup.title', { defaultValue: 'Omplir metadades' })}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                        title={t('common.close', { defaultValue: 'Tanca' })}
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="px-4 py-3 border-b border-[var(--border-secondary)] grid grid-cols-2 gap-3 shrink-0">
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">DOI</span>
                        <input
                            ref={firstInputRef}
                            type="text"
                            value={doi}
                            onChange={(e) => setDoi(e.target.value)}
                            placeholder="10.xxxx/xxxxx"
                            className={inputCls(vDoi.valid)}
                            aria-invalid={!vDoi.valid}
                        />
                        {!vDoi.valid && <span className={hintCls}>{vDoi.hint}</span>}
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">ISBN</span>
                        <input
                            type="text"
                            value={isbn}
                            onChange={(e) => setIsbn(e.target.value)}
                            placeholder="978…"
                            className={inputCls(vIsbn.valid)}
                            aria-invalid={!vIsbn.valid}
                        />
                        {!vIsbn.valid && <span className={hintCls}>{vIsbn.hint}</span>}
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">arXiv id</span>
                        <input
                            type="text"
                            value={arxivId}
                            onChange={(e) => setArxivId(e.target.value)}
                            placeholder="2103.00020"
                            className={inputCls(vArxiv.valid)}
                            aria-invalid={!vArxiv.valid}
                        />
                        {!vArxiv.valid && <span className={hintCls}>{vArxiv.hint}</span>}
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">PMID</span>
                        <input
                            type="text"
                            value={pmid}
                            onChange={(e) => setPmid(e.target.value)}
                            placeholder="29083320"
                            className={inputCls(vPmid.valid)}
                            aria-invalid={!vPmid.valid}
                        />
                        {!vPmid.valid && <span className={hintCls}>{vPmid.hint}</span>}
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">URL</span>
                        <input
                            type="text"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://…"
                            className={inputCls(vUrl.valid)}
                            aria-invalid={!vUrl.valid}
                        />
                        {!vUrl.valid && <span className={hintCls}>{vUrl.hint}</span>}
                    </label>
                </div>

                <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border-secondary)] shrink-0">
                    <button
                        type="button"
                        onClick={handleSearch}
                        disabled={loading || !canSearch}
                        title={
                            !hasIdentifier
                                ? t('metadata_lookup.need_identifier', { defaultValue: 'Cal un DOI, ISBN, arXiv id, PMID o URL' })
                                : !allValid
                                    ? t('metadata_lookup.fix_invalid', { defaultValue: 'Corregeix els camps en vermell abans de cercar' })
                                    : ''
                        }
                        className="px-3 py-1.5 rounded-md bg-[var(--gnosi-primary)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {loading && <Loader2 size={14} className="animate-spin" />}
                        {t('metadata_lookup.search', { defaultValue: 'Cerca' })}
                    </button>
                    <input
                        ref={pdfInputRef}
                        type="file"
                        accept="application/pdf,.pdf"
                        className="hidden"
                        onChange={handlePdfUpload}
                    />
                    <button
                        type="button"
                        onClick={() => pdfInputRef.current?.click()}
                        disabled={loading}
                        className="px-3 py-1.5 rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] text-sm font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"
                    >
                        {t('metadata_lookup.from_pdf', { defaultValue: 'Detectar des d\'un PDF' })}
                    </button>
                    {result?.source && (
                        <span className="text-xs text-[var(--text-tertiary)]">
                            {t('metadata_lookup.source_label', { defaultValue: 'Font' })}: <strong className="text-[var(--text-secondary)]">{SOURCE_LABELS[result.source] || result.source}</strong>
                            {result.identifier && (
                                <> · <code className="text-[10px] bg-[var(--bg-secondary)] px-1 rounded">{result.identifier}</code></>
                            )}
                            {typeLabel && (
                                <> · {t('metadata_lookup.type_label', { defaultValue: 'Tipus' })}: <strong className="text-[var(--text-secondary)]">{typeLabel}</strong></>
                            )}
                        </span>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto">
                    {result && fieldEntries.length === 0 && !loading && (
                        <div className="px-4 py-8 text-center text-sm text-[var(--text-tertiary)]">
                            {result.error || t('metadata_lookup.no_data', { defaultValue: 'No s\'ha trobat cap dada.' })}
                        </div>
                    )}
                    {fieldEntries.length > 0 && (
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)] uppercase">
                                <tr>
                                    <th className="px-3 py-2 text-left w-8">
                                        <input
                                            type="checkbox"
                                            checked={allSelected}
                                            onChange={(e) => {
                                                const v = e.target.checked;
                                                const next = {};
                                                fieldEntries.forEach(([k]) => { next[k] = v; });
                                                setSelectedFields(next);
                                            }}
                                        />
                                    </th>
                                    <th className="px-3 py-2 text-left">{t('metadata_lookup.field', { defaultValue: 'Camp' })}</th>
                                    <th className="px-3 py-2 text-left">{t('metadata_lookup.current', { defaultValue: 'Actual' })}</th>
                                    <th className="px-3 py-2 text-left">{t('metadata_lookup.proposed', { defaultValue: 'Proposat' })}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(() => {
                                    // Helper local: una fila amb checkbox + actual + proposat.
                                    const renderRow = ([k, v]) => {
                                        const current = currentMetadata?.[k];
                                        const currentStr = current == null || current === '' ? '' : String(current);
                                        const proposed = v == null ? '' : String(v);
                                        const isDifferent = currentStr !== proposed;
                                        return (
                                            <tr key={k} className="border-t border-[var(--border-secondary)] hover:bg-[var(--bg-hover)]">
                                                <td className="px-3 py-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={!!selectedFields[k]}
                                                        onChange={(e) => setSelectedFields((prev) => ({ ...prev, [k]: e.target.checked }))}
                                                    />
                                                </td>
                                                <td className="px-3 py-2 font-medium text-[var(--text-primary)] align-top">{k}</td>
                                                <td className="px-3 py-2 text-[var(--text-tertiary)] align-top break-words max-w-xs">
                                                    {currentStr || <em className="opacity-60">{t('common.empty', { defaultValue: 'buit' })}</em>}
                                                </td>
                                                <td className={`px-3 py-2 align-top break-words max-w-md ${isDifferent ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-tertiary)]'}`}>
                                                    {proposed}
                                                </td>
                                            </tr>
                                        );
                                    };
                                    // Cas A: tipus reconegut → dues seccions amb separadors.
                                    // Cas B: sense tipus o sense rellevants → llista plana (compat).
                                    const grouped = zoteroType && relevantEntries.length > 0;
                                    return (
                                        <>
                                            {grouped && (
                                                <tr className="bg-[var(--bg-secondary)]/40">
                                                    <td colSpan={4} className="px-3 py-1.5 text-[11px] font-semibold uppercase text-[var(--text-secondary)] tracking-wide">
                                                        {t('metadata_lookup.relevant_for', { defaultValue: 'Camps del tipus' })}
                                                        <span className="ml-1 text-[var(--text-tertiary)] font-normal normal-case">({relevantEntries.length})</span>
                                                    </td>
                                                </tr>
                                            )}
                                            {relevantEntries.map(renderRow)}
                                            {grouped && otherEntries.length > 0 && (
                                                <tr className="bg-[var(--bg-secondary)]/40">
                                                    <td colSpan={4} className="px-3 py-1.5 text-[11px] font-semibold uppercase text-[var(--text-tertiary)] tracking-wide">
                                                        {t('metadata_lookup.other_fields', { defaultValue: 'Altres camps' })}
                                                        <span className="ml-1 font-normal normal-case">({otherEntries.length}) — el tipus no els porta nativament</span>
                                                    </td>
                                                </tr>
                                            )}
                                            {otherEntries.map(renderRow)}
                                        </>
                                    );
                                })()}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="px-4 py-3 border-t border-[var(--border-secondary)] flex items-center justify-end gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1.5 rounded-md text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    >
                        {t('common.cancel', { defaultValue: 'Cancel·la' })}
                    </button>
                    <button
                        type="button"
                        onClick={handleApply}
                        disabled={!result || fieldEntries.length === 0}
                        className="px-3 py-1.5 rounded-md bg-[var(--gnosi-primary)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                    >
                        <Check size={14} />
                        {t('metadata_lookup.apply', { defaultValue: 'Aplica selecció' })}
                    </button>
                </div>
            </div>
        </div>,
        portalEl,
    );
};

export default MetadataLookupModal;
