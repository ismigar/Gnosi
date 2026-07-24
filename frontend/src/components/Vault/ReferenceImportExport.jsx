/**
 * ReferenceImportExport.jsx
 *
 * Import/export controls for references (BibTeX/RIS) for a
 * Resources table. Import creates pages (with a generated Citation Key if needed) via
 * `POST /api/vault/import-references`; export downloads a .bib/.ris via
 * `GET /api/vault/export-references`.
 *
 * It is shown only when `tableId` is defined (the caller decides whether to show it
 * only for tables with a `Citation Key` column).
 */
import React, { useCallback, useRef, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { Upload, Download, Loader2, ChevronDown } from 'lucide-react';
import { toast } from '../../lib/toast';

export function ReferenceImportExport({ tableId, onImported }) {
    const { t } = useTranslation();
    const fileRef = useRef(null);
    const [busy, setBusy] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);

    const handleImport = useCallback(async (e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // allows reselecting the same file
        if (!file || !tableId) return;
        setBusy(true);
        try {
            const fd = new FormData();
            fd.append('file', file);
            const r = await axios.post(
                `/api/vault/import-references?table_id=${encodeURIComponent(tableId)}&fmt=auto`,
                fd,
                { headers: { 'Content-Type': 'multipart/form-data' } },
            );
            const d = r.data || {};
            // Main toast — net count of additions vs detected duplicates.
            toast.success(t('references_io.imported', {
                defaultValue: `${d.created || 0} referències importades · ${d.skipped || 0} ja existien`,
                created: d.created || 0,
                skipped: d.skipped || 0,
            }));
            // Breakdown of the reason for duplicates (new in #42 / PR #3):
            // citation_key / DOI / ISBN / normalized title. Separate toast
            // (success) because avoiding duplicates is a positive outcome.
            const s = d.skip_summary || {};
            const reasons = [];
            if (s.citation_key) reasons.push(`${s.citation_key} per clau`);
            if (s.doi) reasons.push(`${s.doi} per DOI`);
            if (s.isbn) reasons.push(`${s.isbn} per ISBN`);
            if (s.title) reasons.push(`${s.title} per títol`);
            if (reasons.length > 0) {
                toast.success(t('references_io.import_skip_breakdown', {
                    defaultValue: `Duplicats detectats: ${reasons.join(' · ')}`,
                    breakdown: reasons.join(' · '),
                }));
            }
            if ((d.errors || []).length) {
                toast.error(t('references_io.import_partial', {
                    defaultValue: `${d.errors.length} entrades amb error`,
                    count: d.errors.length,
                }));
            }
            onImported?.();
        } catch (err) {
            console.error('import-references failed:', err?.message);
            toast.error(t('references_io.import_failed', { defaultValue: "Error importing the file" }));
        } finally {
            setBusy(false);
        }
    }, [tableId, onImported, t]);

    const handleExport = useCallback(async (fmt) => {
        setMenuOpen(false);
        if (!tableId) return;
        setBusy(true);
        try {
            const r = await axios.get(
                `/api/vault/export-references?table_id=${encodeURIComponent(tableId)}&fmt=${fmt}`,
                { responseType: 'blob' },
            );
            const ext = fmt === 'bibtex' ? 'bib' : 'ris';
            const url = URL.createObjectURL(r.data);
            const a = document.createElement('a');
            a.href = url;
            a.download = `recursos.${ext}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('export-references failed:', err?.message);
            toast.error(t('references_io.export_failed', { defaultValue: "Error exporting" }));
        } finally {
            setBusy(false);
        }
    }, [tableId, t]);

    if (!tableId) return null;

    const btnCls = 'flex items-center gap-1.5 px-2 py-1 text-xs rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50 transition-colors';

    return (
        <div className="flex items-center gap-1">
            <input
                ref={fileRef}
                type="file"
                accept=".bib,.ris,application/x-bibtex,application/x-research-info-systems,text/plain"
                className="hidden"
                onChange={handleImport}
            />
            <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className={btnCls}
                title={t('references_io.import_title', { defaultValue: "Import references (.bib / .ris)" })}
            >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {t('references_io.import', { defaultValue: "Import" })}
            </button>
            <div className="relative">
                <button
                    type="button"
                    onClick={() => setMenuOpen((o) => !o)}
                    disabled={busy}
                    className={btnCls}
                    title={t('references_io.export_title', { defaultValue: "Export references" })}
                >
                    <Download size={13} />
                    {t('references_io.export', { defaultValue: "Export" })}
                    <ChevronDown size={11} />
                </button>
                {menuOpen && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                        <div className="absolute right-0 mt-1 z-50 min-w-[130px] rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg py-1">
                            <button
                                type="button"
                                onClick={() => handleExport('bibtex')}
                                className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                            >
                                BibTeX (.bib)
                            </button>
                            <button
                                type="button"
                                onClick={() => handleExport('ris')}
                                className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                            >
                                RIS (.ris)
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default ReferenceImportExport;
