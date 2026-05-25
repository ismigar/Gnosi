/**
 * ReferenceImportExport.jsx
 *
 * Controls d'importació/exportació de referències (BibTeX/RIS) per a una taula
 * de Recursos. L'import crea pàgines (amb Citation Key generat si cal) via
 * `POST /api/vault/import-references`; l'export baixa un .bib/.ris via
 * `GET /api/vault/export-references`.
 *
 * Es mostra només quan `tableId` està definit (el caller decideix mostrar-lo
 * només per a taules amb columna `Citation Key`).
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
        e.target.value = ''; // permet re-seleccionar el mateix fitxer
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
            toast.success(t('references_io.imported', {
                defaultValue: `${d.created || 0} referències importades · ${d.skipped || 0} ja existien`,
                created: d.created || 0,
                skipped: d.skipped || 0,
            }));
            if ((d.errors || []).length) {
                toast.error(t('references_io.import_partial', {
                    defaultValue: `${d.errors.length} entrades amb error`,
                    count: d.errors.length,
                }));
            }
            onImported?.();
        } catch (err) {
            console.error('import-references failed:', err?.message);
            toast.error(t('references_io.import_failed', { defaultValue: 'Error important el fitxer' }));
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
            toast.error(t('references_io.export_failed', { defaultValue: 'Error exportant' }));
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
                title={t('references_io.import_title', { defaultValue: 'Importar referències (.bib / .ris)' })}
            >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {t('references_io.import', { defaultValue: 'Importar' })}
            </button>
            <div className="relative">
                <button
                    type="button"
                    onClick={() => setMenuOpen((o) => !o)}
                    disabled={busy}
                    className={btnCls}
                    title={t('references_io.export_title', { defaultValue: 'Exportar referències' })}
                >
                    <Download size={13} />
                    {t('references_io.export', { defaultValue: 'Exportar' })}
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
