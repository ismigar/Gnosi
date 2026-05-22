import { useRef, useState, useMemo } from 'react';
import { FileText, X, Plus, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FilesystemPickerModal } from '../FilesystemPickerModal';
import { filenameFromTarget } from '../../lib/fileResource';

const STORAGE_LABELS = {
    assets:     'Assets',
    biblioteca: 'Biblioteca',
    free:       'Lliure',
};

/**
 * Interpola un patró de nom (ex: "{Authors} - {Any} - {Títol}") amb els valors
 * de la fila. Els camps buits/inexistents s'ometen i es netegen els separadors
 * penjats. La sanitització final del nom la fa el backend. (No exportat.)
 */
// Formata un autor {nom, cognom1, cognom2} segons l'accessor del token del patró:
//   .cognom → "Cognom1 Cognom2"; .nom → "Nom"; cap/altre → "Nom Cognom1 Cognom2".
function formatAuthorToken(a, accessor) {
    if (!a || typeof a !== 'object') return '';
    const cognoms = [a.cognom1, a.cognom2].map(s => (s || '').trim()).filter(Boolean).join(' ');
    const nom = (a.nom || '').trim();
    if (accessor === 'cognom1') return (a.cognom1 || '').trim();
    if (accessor === 'cognom2') return (a.cognom2 || '').trim();
    if (accessor === 'cognom' || accessor === 'cognoms') return cognoms;
    if (accessor === 'nom') return nom;
    return [nom, cognoms].filter(Boolean).join(' ');
}

function interpolateNamePattern(pattern, meta = {}) {
    if (!pattern || typeof pattern !== 'string') return '';
    let out = pattern.replace(/\{([^{}]+)\}/g, (_, token) => {
        const [rawField, accessor] = token.trim().split('.');
        const v = meta?.[(rawField || '').trim()];
        if (v === undefined || v === null) return '';
        // Camp autoria: array d'objectes {nom, cognom1, cognom2} → format per accessor.
        if (Array.isArray(v) && v.some(a => a && typeof a === 'object' && ('cognom1' in a || 'cognom2' in a || 'nom' in a))) {
            return v.map(a => formatAuthorToken(a, (accessor || '').trim())).filter(Boolean).join(', ');
        }
        const s = Array.isArray(v) ? v.join(', ') : String(v);
        return s.trim();
    });
    out = out
        .replace(/\s{2,}/g, ' ')
        .replace(/\s*-\s*-\s*/g, ' - ')
        .replace(/^[\s\-–—_]+|[\s\-–—_]+$/g, '')
        .replace(/[<>:"/\\|?*]/g, '')
        .trim();
    return out;
}

/**
 * FileAttachmentField — camp de tipus `files` (multi-fitxer). El comportament
 * es declara a l'esquema (`file_mode`) i el formulari d'inserció és específic
 * del mode (a diferència del modal genèric "/+"):
 *   - 'link'   → un "+" obre el selector de fitxers local i enllaça (sense còpia).
 *   - 'upload' → un "+" puja el fitxer a `storageFolder` (amb `namePattern`); si
 *                la carpeta és 'free', primer tria la carpeta destí.
 *
 * Cada acció AFEGEIX un fitxer a la llista (no reemplaça); cada fitxer té el seu
 * propi botó per treure'l. `value` pot ser string (1 fitxer) o array (≥2);
 * `onChange` emet '' (buit), el string sol (1) o l'array (≥2) per no canviar el
 * format dels camps d'un sol fitxer.
 *
 * Props: tableId, propertyName, fileMode ('link'|'upload'), storageFolder,
 * namePattern, rowMetadata, value (string|array), onChange(newValue), apiFetch.
 */
export function FileAttachmentField({ tableId, propertyName, fileMode = 'upload', storageFolder = 'assets', namePattern = '', rowMetadata = {}, value, onChange, apiFetch }) {
    const { t } = useTranslation();
    const fileInputRef = useRef(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // Picker del sistema d'arxius (navega el disc via /api/system/browse, que
    // funciona dins del contenidor Docker).
    const [pickerState, setPickerState] = useState(null);
    const openPicker = (mode) => new Promise((resolve) => setPickerState({ mode, resolve }));

    const isLink = fileMode === 'link';
    const isFree = storageFolder === 'free';

    // Normalitza el valor a una llista de strings crus (conserva el format
    // original de cada entrada: path, URL servida o `[nom](target)`).
    const entries = useMemo(() => {
        const list = Array.isArray(value) ? value : (value == null ? [] : [value]);
        return list.map(v => String(v ?? '')).filter(v => v.trim() !== '');
    }, [value]);

    // Emet mantenint compatibilitat: buit → '', un de sol → string, ≥2 → array.
    const emit = (next) => {
        const clean = next.map(v => String(v ?? '')).filter(v => v.trim() !== '');
        onChange(clean.length === 0 ? '' : (clean.length === 1 ? clean[0] : clean));
    };
    const appendValue = (raw) => emit([...entries, raw]);
    const removeAt = (idx) => emit(entries.filter((_, i) => i !== idx));

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
                appendValue((await res.json()).path);
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
                appendValue(data.url || data.path);
            }
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
            appendValue((await res.json()).path);
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
            {/* Fitxers actuals — cada un amb el seu botó per treure'l */}
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

            {/* Un sol "+" → acció específica del mode configurat a l'esquema */}
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
