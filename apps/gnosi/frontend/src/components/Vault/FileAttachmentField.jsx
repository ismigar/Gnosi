import { useRef, useState, useMemo } from 'react';
import { FileText, X, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InsertContentModal } from './InsertContentModal';
import { filenameFromTarget, fileTargetKey, canonicalStorageFolder } from '../../lib/fileResource';

const STORAGE_LABELS = {
    assets:  'Assets',
    library: 'Library',
};

/**
 * FileAttachmentField — a field of type `files` (multi-file). The "+" opens the
 * unified [[InsertContentModal]], the SAME entry point the grid uses
 * (`VaultTable.openMediaPicker`), passing the field's config as `fileField` so
 * the modal restricts its tabs to what `file_mode` allows and routes the
 * upload/link through the property endpoints (destination `storageFolder`,
 * renaming by `namePattern`):
 *   - 'link'   → only "Disc local": links the file in place (no copy).
 *   - 'upload' → "Puja" + "Disc local": uploads to `storageFolder`.
 *
 * It must NOT open a bare `<input type=file>`: that shows the OS dialog
 * directly, skipping the in-app modal (Vault / local disk / URL), and it was
 * the only `files` surface that behaved differently from the grid.
 *
 * Each action ADDS a file to the list (it doesn't replace); each file has its
 * own button to remove it. `value` can be a string (1 file) or an array (≥2);
 * `onChange` emits '' (empty), the plain string (1), or the array (≥2) so as not to change the
 * format of single-file fields.
 *
 * Props: tableId, propertyName, fileMode ('link'|'upload'), storageFolder,
 * namePattern, rowMetadata, value (string|array), onChange(newValue).
 */
export function FileAttachmentField({ tableId, propertyName, fileMode = 'upload', storageFolder = 'assets', namePattern = '', rowMetadata = {}, value, onChange }) {
    const { t } = useTranslation();
    const [error, setError] = useState('');
    const [pickerOpen, setPickerOpen] = useState(false);

    const isLink = fileMode === 'link';
    const storage = canonicalStorageFolder(storageFolder);
    const isFree = storage === 'free';

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

    const addTitle = isLink
        ? t('files.link_existing', 'Enllaça un fitxer local (sense copiar)')
        : (isFree
            ? t('files.upload_choose_folder', 'Puja i tria la carpeta de destinació')
            : t('files.upload_to', 'Puja a {{folder}}', { folder: STORAGE_LABELS[storage] || STORAGE_LABELS.assets }));

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

            {/* A single "+" → the unified insert modal, scoped to this field */}
            <button
                type="button"
                onClick={() => { setError(''); setPickerOpen(true); }}
                className="flex items-center justify-center w-7 h-7 rounded-lg border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:border-[var(--gnosi-primary)]/50 hover:text-[var(--gnosi-primary)] transition-colors disabled:opacity-50"
                title={addTitle}
            >
                <Plus size={15} />
            </button>

            {error && (
                <p className="text-[11px] text-red-500 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1">{error}</p>
            )}

            <InsertContentModal
                open={pickerOpen}
                tableId={tableId || ''}
                fileField={{ propertyName, storageFolder: storage, namePattern, fileMode }}
                rowMetadata={rowMetadata}
                onClose={() => setPickerOpen(false)}
                onInsert={(result) => {
                    // Multi-upload returns `urls`; a single insertion returns `url`.
                    // The modal already uploaded/linked through the property
                    // endpoints, so what arrives is the final stored form
                    // (served URL for Assets, portable path for Library).
                    const raws = Array.isArray(result?.urls) && result.urls.length
                        ? result.urls
                        : [result?.url].filter(Boolean);
                    if (raws.length) appendValues(raws);
                }}
            />
        </div>
    );
}
