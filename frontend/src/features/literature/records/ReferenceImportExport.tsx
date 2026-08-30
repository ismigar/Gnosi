import { useCallback, useRef, useState, type ChangeEvent } from 'react';
import { ChevronDown, Download, LibraryBig, Loader2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { toast } from '../../../shared/notifications/toast';
import { vaultPath } from '../../../shared/routing/vaultRouting';
import {
    exportReferences,
    importReferences,
    type ReferenceExportFormat,
} from '../../../shared/api/citation-io';
import { downloadBlob } from '../../../shared/platform/download';
import {
    duplicateReferenceBreakdown,
    referenceExportFilename,
} from './reference-import-export/referenceImportModel';


export interface ReferenceImportExportProps {
    readonly onImported?: () => void;
    readonly tableId?: string | null;
}


const buttonClass = 'flex items-center gap-1.5 px-2 py-1 text-xs rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50 transition-colors';


export function ReferenceImportExport({
    onImported,
    tableId,
}: ReferenceImportExportProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const fileRef = useRef<HTMLInputElement | null>(null);
    const [busy, setBusy] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);

    const handleImport = useCallback(async (
        event: ChangeEvent<HTMLInputElement>,
    ): Promise<void> => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || !tableId) return;
        setBusy(true);
        try {
            const result = await importReferences(file, { format: 'auto', tableId });
            toast.success(t('references_io.imported', {
                created: result.created,
                defaultValue: `${String(result.created)} referències importades · ${String(result.skipped)} ja existien`,
                skipped: result.skipped,
            }));
            const reasons = duplicateReferenceBreakdown(result);
            if (reasons.length > 0) {
                const breakdown = reasons.join(' · ');
                toast.success(t('references_io.import_skip_breakdown', {
                    breakdown,
                    defaultValue: `Duplicats detectats: ${breakdown}`,
                }));
            }
            if (result.errors.length > 0) {
                toast.error(t('references_io.import_partial', {
                    count: result.errors.length,
                    defaultValue: `${String(result.errors.length)} entrades amb error`,
                }));
            }
            onImported?.();
        } catch {
            toast.error(t('references_io.import_failed', {
                defaultValue: 'Error importing the file',
            }));
        } finally {
            setBusy(false);
        }
    }, [onImported, t, tableId]);

    const handleExport = useCallback(async (
        format: ReferenceExportFormat,
    ): Promise<void> => {
        setMenuOpen(false);
        if (!tableId) return;
        setBusy(true);
        try {
            const blob = await exportReferences({ format, tableId });
            downloadBlob(blob, referenceExportFilename(format));
        } catch {
            toast.error(t('references_io.export_failed', {
                defaultValue: 'Error exporting',
            }));
        } finally {
            setBusy(false);
        }
    }, [t, tableId]);

    if (!tableId) return null;
    return <div className="flex items-center gap-1">
        <button
            aria-label={t('literature.title')}
            className={buttonClass}
            onClick={() => { void navigate(vaultPath('resources')); }}
            type="button"
        ><LibraryBig size={13} />{t('literature.title')}</button>
        <input
            accept=".bib,.ris,application/x-bibtex,application/x-research-info-systems,text/plain"
            className="hidden"
            onChange={(event) => { void handleImport(event); }}
            ref={fileRef}
            type="file"
        />
        <button
            aria-label={t('references_io.import_title', { defaultValue: 'Import references (.bib / .ris)' })}
            className={buttonClass}
            disabled={busy}
            onClick={() => { fileRef.current?.click(); }}
            type="button"
        >
            {busy ? <Loader2 className="animate-spin" size={13} /> : <Upload size={13} />}
            {t('references_io.import', { defaultValue: 'Import' })}
        </button>
        <div className="relative">
            <button
                aria-label={t('references_io.export_title', { defaultValue: 'Export references' })}
                className={buttonClass}
                disabled={busy}
                onClick={() => { setMenuOpen((open) => !open); }}
                type="button"
            ><Download size={13} />{t('references_io.export', { defaultValue: 'Export' })}<ChevronDown size={11} /></button>
            {menuOpen ? <>
                <div className="fixed inset-0 z-40" onClick={() => { setMenuOpen(false); }} />
                <div className="absolute right-0 z-50 mt-1 min-w-[130px] rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] py-1 shadow-lg">
                    <button className="w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]" onClick={() => { void handleExport('bibtex'); }} type="button">BibTeX (.bib)</button>
                    <button className="w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]" onClick={() => { void handleExport('ris'); }} type="button">RIS (.ris)</button>
                </div>
            </> : null}
        </div>
    </div>;
}


export default ReferenceImportExport;
