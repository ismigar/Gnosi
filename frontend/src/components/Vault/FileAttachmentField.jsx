import { useRef, useState } from 'react';
import { Upload, Link2, FolderOpen, FileText, X, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FilesystemPickerModal } from '../FilesystemPickerModal';

const STORAGE_LABELS = {
    assets:    'Assets',
    biblioteca: 'Biblioteca',
    free:      'Lliure',
};

/**
 * FileAttachmentField — gestiona adjunts per camps de tipus `files`.
 *
 * Props:
 *   tableId        — ID de la taula (per a l'upload)
 *   propertyName   — Nom del camp
 *   storageFolder  — 'assets' | 'biblioteca' | 'free'
 *   value          — Valor actual (string de ruta o URL)
 *   onChange       — callback(newValue: string)
 *   apiFetch       — funció autenticada per fer crides API
 */
export function FileAttachmentField({ tableId, propertyName, storageFolder = 'assets', value, onChange, apiFetch }) {
    const { t } = useTranslation();
    const fileInputRef = useRef(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // Picker del sistema d'arxius (navega el disc via /api/system/browse, que
    // funciona dins del contenidor Docker). Substitueix els antics
    // /pick-folder i /pick-file, que cridaven `osascript` — no disponible al
    // contenidor. `pickerState` porta el mode i el `resolve` de la promesa
    // que espera el path triat.
    const [pickerState, setPickerState] = useState(null);

    const openPicker = (mode) => new Promise((resolve) => {
        setPickerState({ mode, resolve });
    });

    const isFree = storageFolder === 'free';
    const hasValue = Boolean(value);
    const fileName = value ? value.split('/').pop().split('\\').pop() : '';
    const isLocalPath = value && !value.startsWith('/api/') && !value.startsWith('http');
    const displayUrl = value && !isLocalPath ? value : null;

    const handleUpload = async (file) => {
        if (!file) return;

        try {
            if (isFree) {
                // Variant A (Free): primer tria carpeta de destinació amb el
                // navegador del sistema d'arxius.
                const folderPath = await openPicker('folder');
                if (!folderPath) return; // cancel·lat
                setLoading(true);
                setError('');

                const formData = new FormData();
                formData.append('file', file);
                formData.append('dest_folder', folderPath);

                const res = await apiFetch(
                    `/api/vault/upload-property-file?table_id=${encodeURIComponent(tableId)}&property_name=${encodeURIComponent(propertyName)}&storage_folder=free`,
                    { method: 'POST', body: formData }
                );
                if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Error pujant fitxer');
                const data = await res.json();
                onChange(data.path);
            } else {
                // Variant A (Assets / Biblioteca)
                setLoading(true);
                setError('');
                const formData = new FormData();
                formData.append('file', file);
                const res = await apiFetch(
                    `/api/vault/upload-property-file?table_id=${encodeURIComponent(tableId)}&property_name=${encodeURIComponent(propertyName)}&storage_folder=${storageFolder}`,
                    { method: 'POST', body: formData }
                );
                if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Error pujant fitxer');
                const data = await res.json();
                onChange(data.url || data.path);
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleLinkExisting = async () => {
        // Variant B: selecciona fitxer existent sense copiar-lo. El picker
        // navega el disc via /api/system/browse (funciona dins Docker).
        const path = await openPicker('file');
        if (!path) return; // cancel·lat
        setLoading(true);
        setError('');
        try {
            const res = await apiFetch('/api/vault/link-existing-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_path: path }),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Error enllaçant fitxer');
            const data = await res.json();
            onChange(data.path);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-1.5">
            {/* Valor actual */}
            {hasValue && (
                <div className="flex items-center gap-2 text-xs bg-[var(--bg-secondary)] rounded-lg px-2.5 py-1.5 border border-[var(--border-primary)]">
                    <FileText size={13} className="text-[var(--gnosi-primary)] shrink-0" />
                    {displayUrl ? (
                        <a href={displayUrl} target="_blank" rel="noreferrer" className="truncate text-[var(--gnosi-primary)] hover:underline flex-1">
                            {fileName}
                        </a>
                    ) : (
                        <span className="truncate text-[var(--text-secondary)] flex-1" title={value}>{fileName}</span>
                    )}
                    <button
                        type="button"
                        onClick={() => onChange('')}
                        className="text-[var(--text-tertiary)] hover:text-red-500 transition-colors shrink-0"
                        title={t('common.remove', 'Eliminar')}
                    >
                        <X size={13} />
                    </button>
                </div>
            )}

            {/* Botons d'acció */}
            <div className="flex gap-1.5">
                {/* Variant A: pujar fitxer */}
                <button
                    type="button"
                    disabled={loading}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors disabled:opacity-50"
                    title={isFree
                        ? t('files.upload_choose_folder', 'Puja i tria carpeta de destinació')
                        : t('files.upload_to', 'Puja a {{folder}}', { folder: STORAGE_LABELS[storageFolder] })}
                >
                    {loading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    {isFree
                        ? t('files.upload_free', 'Puja...')
                        : `→ ${STORAGE_LABELS[storageFolder]}`}
                </button>

                {/* Variant B: enllaçar fitxer existent (sempre disponible) */}
                <button
                    type="button"
                    disabled={loading}
                    onClick={handleLinkExisting}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors disabled:opacity-50"
                    title={t('files.link_existing', 'Enllaça un fitxer ja existent al teu ordinador (sense copiar)')}
                >
                    <Link2 size={13} />
                    {t('files.link', 'Enllaça')}
                </button>

                {/* Indicador de carpeta configurada */}
                <span className="ml-auto flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                    <FolderOpen size={11} />
                    {STORAGE_LABELS[storageFolder]}
                </span>
            </div>

            <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }}
            />

            {error && (
                <p className="text-[11px] text-red-500 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1">{error}</p>
            )}

            <FilesystemPickerModal
                isOpen={Boolean(pickerState)}
                mode={pickerState?.mode || 'file'}
                onClose={() => { pickerState?.resolve?.(null); setPickerState(null); }}
                onSelect={(absolutePath) => { pickerState?.resolve?.(absolutePath); setPickerState(null); }}
            />
        </div>
    );
}
