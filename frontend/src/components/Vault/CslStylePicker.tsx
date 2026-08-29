import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { BookText, Check, Loader2, Search, Upload } from 'lucide-react';

import { toast } from '../../lib/toast';
import { uploadCslStyle } from '../../shared/api/citation-io';
import {
    fetchAvailableStyles,
    invalidateAvailableStylesCache,
    type CslStyleOption,
} from './cslEngine';

export interface CslStylePickerProps {
    readonly onChange?: (styleId: string) => void;
    readonly readOnly?: boolean;
    readonly value?: string;
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

export function CslStylePicker({
    value,
    onChange,
    readOnly = false,
}: CslStylePickerProps) {
    const { t } = useTranslation();
    const [styles, setStyles] = useState<CslStyleOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [query, setQuery] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);

    const loadStyles = useCallback(async (force = false): Promise<void> => {
        try {
            const available = await fetchAvailableStyles({ force });
            setStyles(available);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadStyles(false);
    }, [loadStyles]);

    const filtered = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) return styles;
        return styles.filter((style) => (
            style.id.toLowerCase().includes(normalizedQuery)
            || style.label.toLowerCase().includes(normalizedQuery)
        ));
    }, [query, styles]);

    const handleUpload = useCallback(async (
        event: ChangeEvent<HTMLInputElement>,
    ): Promise<void> => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setUploading(true);
        try {
            const uploaded = await uploadCslStyle(file);
            const title = uploaded.title || uploaded.id;
            toast.success(t('csl_picker.uploaded', {
                defaultValue: `Estil "${title}" disponible`,
                title,
            }));
            invalidateAvailableStylesCache();
            setLoading(true);
            await loadStyles(true);
            if (uploaded.id) onChange?.(uploaded.id);
        } catch (error: unknown) {
            const detail = errorMessage(
                error,
                t('common.unknown', { defaultValue: "unknown" }),
            );
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
                    onChange={(event) => {
                        setQuery(event.target.value);
                    }}
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
                {!loading && filtered.map((style) => {
                    const selected = style.id === value;
                    return (
                        <button
                            key={style.id}
                            type="button"
                            onClick={() => {
                                onChange?.(style.id);
                            }}
                            className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-[var(--bg-hover)] transition-colors ${
                                selected ? 'bg-[var(--gnosi-primary)]/10' : ''
                            }`}
                        >
                            <BookText
                                size={12}
                                className={selected
                                    ? 'text-[var(--gnosi-primary)]'
                                    : 'text-[var(--text-tertiary)]'}
                            />
                            <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                                    {style.label}
                                </div>
                                <div className="text-[10px] font-mono text-[var(--text-tertiary)] truncate">
                                    {style.id}
                                </div>
                            </div>
                            {selected && (
                                <Check
                                    size={12}
                                    className="text-[var(--gnosi-primary)] shrink-0"
                                />
                            )}
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
                        onChange={(event) => {
                            void handleUpload(event);
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => {
                            fileRef.current?.click();
                        }}
                        disabled={uploading}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                    >
                        {uploading
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Upload size={12} />}
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
