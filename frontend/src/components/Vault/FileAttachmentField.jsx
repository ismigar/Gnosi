import { useRef, useState, useMemo } from 'react';
import { FileText, X, Plus, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FilesystemPickerModal } from '../FilesystemPickerModal';
import { filenameFromTarget, interpolateNamePattern, fileTargetKey } from '../../lib/fileResource';

const STORAGE_LABELS = {
    assets:     'Assets',
    library: 'Library',
    free:       'Lliure',
};

/**
 * FileAttachmentField — a field of type `files` (multi-file). The behavior
 * is declared in the schema (`file_mode`) and the insertion form is specific
 * to the mode (unlike the generic "/+" modal):
 *   - 'link'   → a "+" opens the local file picker and links it (no copy).
 *   - 'upload' → a "+" uploads the file to `storageFolder` (using `namePattern`); if
 *                the folder is 'free', it first chooses the destination folder.
 *
 * Each action ADDS a file to the list (it doesn't replace); each file has its
 * own button to remove it. `value` can be a string (1 file) or an array (≥2);
 * `onChange` emits '' (empty), the plain string (1), or the array (≥2) so as not to change the
 * format of single-file fields.
 *
 * Props: tableId, propertyName, fileMode ('link'|'upload'), storageFolder,
 * namePattern, rowMetadata, value (string|array), onChange(newValue), apiFetch.
 */
export function FileAttachmentField({ tableId, propertyName, fileMode = 'upload', storageFolder = 'assets', namePattern = '', rowMetadata = {}, value, onChange, apiFetch }) {
    const { t } = useTranslation();
    const fileInputRef = useRef(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // File-system picker (browses the disk via /api/system/browse, which
    // works inside the Docker container).
    const [pickerState, setPickerState] = useState(null);
    const openPicker = (mode) => new Promise((resolve) => setPickerState({ mode, resolve }));

    const isLink = fileMode === 'link';
    const isFree = storageFolder === 'free';

    // Normalizes the value into a list of raw strings (preserves the format
    // original of each entry: path, served URL, or `[nom](target)`).
    const entries = useMemo(() => {
        const list = Array.isArray(value) ? value : (value == null ? [] : [value]);
        return list.map(v => String(v ?? '')).filter(v => v.trim() !== '');
    }, [value]);

    // Current value for emissions: a long upload must not clobber
    // changes made in the meantime (stale closure over `entries`).
    const entriesRef = useRef(entries);
    entriesRef.current = entries;

    // Emits while keeping compatibility: empty → '', a single one → string, ≥2 → array.
    const emit = (next) => {
        const clean = next.map(v => String(v ?? '')).filter(v => v.trim() !== '');
        onChange(clean.length === 0 ? '' : (clean.length === 1 ? clean[0] : clean));
    };
    // Adds while DEDUPLICATING using the canonical key (unifies file://, absolute path,
    // ~/, and the served URL of the same file): repeating a link doesn't duplicate entries.
    const appendValues = (raws) => {
        const current = entriesRef.current;
        const seen = new Set(current.map(fileTargetKey));
        const adds = [];
        for (const raw of raws) {
            const text = String(raw ?? '').trim();
            if (!text) continue;
            const key = fileTargetKey(text);
            if (seen.has(key)) continue;
            seen.add(key);
            adds.push(text);
        }
        if (adds.length === 0) {
            setError(t('files.duplicate', 'Aquest fitxer ja és a la llista.'));
            return;
        }
        emit([...current, ...adds]);
    };
    const removeAt = (idx) => emit(entriesRef.current.filter((_, i) => i !== idx));

    const resolvedName = namePattern ? interpolateNamePattern(namePattern, rowMetadata) : '';
    const nameQuery = resolvedName ? `&target_name=${encodeURIComponent(resolvedName)}` : '';

    const handleUpload = async (file) => {
        if (!file) return;
        try {
            if (isFree) {
                const folderPath = await openPicker('folder');
                if (!folderPath) return; // cancel·lat
                setLoading(true); setError('');
                const formData = new FormData();
                formData.append('file', file);
                formData.append('dest_folder', folderPath);
                const res = await apiFetch(
                    `/api/vault/upload-property-file?table_id=${encodeURIComponent(tableId)}&property_name=${encodeURIComponent(propertyName)}&storage_folder=free${nameQuery}`,
                    { method: 'POST', body: formData },
                );
                if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Error pujant fitxer');
                appendValues([(await res.json()).path]);
            } else {
                setLoading(true); setError('');
                const formData = new FormData();
                formData.append('file', file);
                const res = await apiFetch(
                    `/api/vault/upload-property-file?table_id=${encodeURIComponent(tableId)}&property_name=${encodeURIComponent(propertyName)}&storage_folder=${storageFolder}${nameQuery}`,
                    { method: 'POST', body: formData },
                );
                if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Error pujant fitxer');
                const data = await res.json();
                appendValues([data.url || data.path]);
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    // Upload of MULTIPLE files at once (input `multiple`). Uploads all of them and does
    // a SINGLE `emit` with all of them added, to avoid the race of N consecutive emits
    // (each would read the same stale `entries` and only the last one would survive).
    const handleUploadFiles = async (fileList) => {
        const files = Array.from(fileList || []).filter(Boolean);
        if (files.length === 0) return;
        if (files.length === 1) { await handleUpload(files[0]); return; }
        try {
            let destFolder = null;
            if (isFree) {
                destFolder = await openPicker('folder');
                if (!destFolder) return; // cancel·lat
            }
            setLoading(true); setError('');
            const sf = isFree ? 'free' : storageFolder;
            const newRaws = [];
            for (const file of files) {
                const formData = new FormData();
                formData.append('file', file);
                if (isFree) formData.append('dest_folder', destFolder);
                const res = await apiFetch(
                    `/api/vault/upload-property-file?table_id=${encodeURIComponent(tableId)}&property_name=${encodeURIComponent(propertyName)}&storage_folder=${sf}${nameQuery}`,
                    { method: 'POST', body: formData },
                );
                if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Error pujant fitxer');
                const data = await res.json();
                newRaws.push(data.url || data.path);
            }
            appendValues(newRaws);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleLinkExisting = async () => {
        const path = await openPicker('file');
        if (!path) return; // cancel·lat
        setLoading(true); setError('');
        try {
            const res = await apiFetch('/api/vault/link-existing-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_path: path, target_name: resolvedName }),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Error enllaçant fitxer');
            // `url` carries the PORTABLE form (library/raw/~) when it exists;
            // `path` (absolute host path) is used as a last resort.
            const data = await res.json();
            appendValues([data.url || data.path]);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const addTitle = isLink
        ? t('files.link_existing', 'Enllaça un fitxer local (sense copiar)')
        : (isFree
            ? t('files.upload_choose_folder', 'Puja i tria la carpeta de destinació')
            : t('files.upload_to', 'Puja a {{folder}}', { folder: STORAGE_LABELS[storageFolder] }));

    return (
        <div className="space-y-1.5">
            {/* Current files — each with its own button to remove it */}
            {entries.map((entry, idx) => {
                const fileName = filenameFromTarget(entry);
                const isServed = entry.startsWith('/api/') || /^https?:\/\//i.test(entry);
                return (
                    <div key={`${idx}-${entry}`} className="flex items-center gap-2 text-xs bg-[var(--bg-secondary)] rounded-lg px-2.5 py-1.5 border border-[var(--border-primary)]">
                        <FileText size={13} className="text-[var(--gnosi-primary)] shrink-0" />
                        {isServed ? (
                            <a href={entry} target="_blank" rel="noreferrer" className="truncate text-[var(--gnosi-primary)] hover:underline flex-1">
                                {fileName}
                            </a>
                        ) : (
                            <span className="truncate text-[var(--text-secondary)] flex-1" title={entry}>{fileName}</span>
                        )}
                        <button
                            type="button"
                            onClick={() => removeAt(idx)}
                            className="text-[var(--text-tertiary)] hover:text-red-500 transition-colors shrink-0"
                            title={t('common.delete', 'Elimina')}
                        >
                            <X size={13} />
                        </button>
                    </div>
                );
            })}

            {/* A single "+" → action specific to the mode configured in the schema */}
            <button
                type="button"
                disabled={loading}
                onClick={() => { if (isLink) handleLinkExisting(); else fileInputRef.current?.click(); }}
                className="flex items-center justify-center w-7 h-7 rounded-lg border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:border-[var(--gnosi-primary)]/50 hover:text-[var(--gnosi-primary)] transition-colors disabled:opacity-50"
                title={addTitle}
            >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />}
            </button>

            <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => { handleUploadFiles(e.target.files); e.target.value = ''; }}
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
