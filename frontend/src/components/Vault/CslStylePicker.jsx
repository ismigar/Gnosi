import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from '../../shared/api/legacy-http';
import { useTranslation } from 'react-i18next';
import { Search, BookText, Upload, Loader2, Check } from 'lucide-react';
import { toast } from '../../lib/toast';
import { fetchAvailableStyles, invalidateAvailableStylesCache } from './cslEngine';

/**
 * CSL style picker with search and upload.
 *
 * Props:
 *   - value (string)         id of the currently chosen style
 *   - onChange (string→void) callback when the user picks a style
 *   - readOnly (bool)        disables the upload (keeps search)
 *
 * UX:
 *   - Search input (filters by id and label)
 *   - Scrollable list with radio buttons; click selects
 *   - "Upload new file (.csl)" button → file input → POST /api/vault/csl/styles
 *   - Success/error toast + list refresh after a successful upload
 *
 * Renders no modal — it's an embeddable component. The caller decides
 * whether it goes inside a dropdown, a Settings section, or its own panel.
 */
export function CslStylePicker({ value, onChange, readOnly = false }) {
    const { t } = useTranslation();
    const [styles, setStyles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [query, setQuery] = useState('');
    const fileRef = useRef(null);

    const loadStyles = useCallback(async (force = false) => {
        setLoading(true);
        try {
            const s = await fetchAvailableStyles({ force });
            setStyles(s);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadStyles(false); }, [loadStyles]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return styles;
        return styles.filter((s) =>
            s.id.toLowerCase().includes(q) ||
            String(s.label || '').toLowerCase().includes(q)
        );
    }, [styles, query]);

    const handleUpload = useCallback(async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('file', file);
            const r = await axios.post('/api/vault/csl/styles', fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            toast.success(t('csl_picker.uploaded', {
                defaultValue: `Estil "${r.data?.title || r.data?.id}" disponible`,
                title: r.data?.title || r.data?.id,
            }));
            invalidateAvailableStylesCache();
            await loadStyles(true);
            if (r.data?.id) onChange?.(r.data.id);
        } catch (err) {
            const detail = err?.response?.data?.detail || err?.message || t('common.unknown', "unknown");
            toast.error(t('csl_picker.upload_failed', {
                defaultValue: `Error uploading style: ${detail}`,
                detail,
            }));
        } finally {
            setUploading(false);
        }
    }, [loadStyles, onChange, t]);

    return (
        <div className="flex flex-col gap-2 w-full">
            <div className="flex items-center gap-2">
                <Search size={14} className="text-[var(--text-tertiary)]" />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('csl_picker.search_placeholder', { defaultValue: "Search style…" })}
                    className="flex-1 px-2 py-1 text-sm rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                />
            </div>
            <div
                className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)]/30 overflow-y-auto"
                style={{ maxHeight: 240 }}
            >
                {loading && (
                    <div className="px-3 py-4 flex items-center justify-center gap-2 text-xs text-[var(--text-tertiary)]">
                        <Loader2 size={12} className="animate-spin" />
                        {t('csl_picker.loading', { defaultValue: "Loading…" })}
                    </div>
                )}
                {!loading && filtered.length === 0 && (
                    <div className="px-3 py-4 text-center text-xs text-[var(--text-tertiary)] italic">
                        {query
                            ? t('csl_picker.no_match', { defaultValue: "No style matches this filter" })
                            : t('csl_picker.empty', { defaultValue: "No styles in the catalog" })}
                    </div>
                )}
                {!loading && filtered.map((s) => {
                    const selected = s.id === value;
                    return (
                        <button
                            key={s.id}
                            type="button"
                            onClick={() => onChange?.(s.id)}
                            className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-[var(--bg-hover)] transition-colors ${
                                selected ? 'bg-[var(--gnosi-primary)]/10' : ''
                            }`}
                        >
                            <BookText size={12} className={selected ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                            <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                                    {s.label}
                                </div>
                                <div className="text-[10px] font-mono text-[var(--text-tertiary)] truncate">
                                    {s.id}
                                </div>
                            </div>
                            {selected && <Check size={12} className="text-[var(--gnosi-primary)] shrink-0" />}
                        </button>
                    );
                })}
            </div>
            {!readOnly && (
                <div className="flex items-center gap-2">
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".csl,application/xml,text/xml"
                        className="hidden"
                        onChange={handleUpload}
                    />
                    <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        disabled={uploading}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                    >
                        {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                        {t('csl_picker.upload', { defaultValue: "Upload new .csl style" })}
                    </button>
                    <span className="text-[10px] text-[var(--text-tertiary)] italic">
                        {t('csl_picker.upload_hint', {
                            defaultValue: "Official catalog: github.com/citation-style-language/styles",
                        })}
                    </span>
                </div>
            )}
        </div>
    );
}

export default CslStylePicker;
