import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { Hash, Search, ChevronRight, ChevronDown, FileText, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../lib/toast';

/**
 * Obsidian-style Tags page: an index of every tag in the vault with
 * a count, expandable to see (and open) the pages that contain them.
 */
export function VaultTagsView({ onPageSelect }) {
    const { t } = useTranslation();
    const [tags, setTags] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [expanded, setExpanded] = useState(() => new Set());

    const fetchTags = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/vault/tags');
            setTags(res.data?.tags || []);
        } catch (err) {
            console.error('Error carregant els tags:', err);
            toast.error(t('errors.tags_load', { defaultValue: 'No s\'han pogut carregar els tags' }));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => { fetchTags(); }, [fetchTags]);

    const filtered = useMemo(() => {
        if (!searchTerm) return tags;
        const needle = searchTerm.toLowerCase();
        return tags.filter(tg => String(tg.name || '').toLowerCase().includes(needle));
    }, [tags, searchTerm]);

    const toggle = (name) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name); else next.add(name);
            return next;
        });
    };

    const totalPages = useMemo(
        () => tags.reduce((acc, tg) => acc + (tg.count || 0), 0),
        [tags]
    );

    return (
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[var(--bg-primary)]">
            <div className="px-6 pt-6 pb-4 border-b border-[var(--border-primary)]">
                <div className="flex items-center gap-2 mb-1">
                    <Hash size={20} className="text-amber-500" />
                    <h1 className="text-xl font-bold text-[var(--text-primary)]">
                        {t('sidebar.tags', 'Etiquetes')}
                    </h1>
                </div>
                <p className="text-sm text-[var(--text-tertiary)]">
                    {t('tags.summary', {
                        defaultValue: '{{tags}} etiquetes · {{pages}} referències',
                        tags: tags.length,
                        pages: totalPages,
                    })}
                </p>
                <div className="mt-3 relative max-w-md">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder={t('tags.search_placeholder', 'Cerca etiquetes…')}
                        className="w-full pl-9 pr-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/30"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
                {loading ? (
                    <div className="flex items-center justify-center py-16 text-[var(--text-tertiary)]">
                        <Loader2 size={20} className="animate-spin mr-2" />
                        {t('common.loading', 'Carregant…')}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)]">
                        <Hash size={32} className="mb-2 opacity-40" />
                        <p className="text-sm">
                            {searchTerm
                                ? t('tags.no_match', 'Cap etiqueta coincideix')
                                : t('tags.empty', 'Encara no hi ha etiquetes. Afegeix-ne via la propietat «tags».')}
                        </p>
                    </div>
                ) : (
                    <div className="max-w-2xl mx-auto space-y-1">
                        {filtered.map((tg) => {
                            const isOpen = expanded.has(tg.name);
                            return (
                                <div key={tg.name} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => toggle(tg.name)}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-secondary)] transition-colors"
                                    >
                                        {isOpen
                                            ? <ChevronDown size={14} className="text-[var(--text-tertiary)] shrink-0" />
                                            : <ChevronRight size={14} className="text-[var(--text-tertiary)] shrink-0" />}
                                        <Hash size={13} className="text-amber-500 shrink-0" />
                                        <span className="text-sm font-medium text-[var(--text-primary)] truncate flex-1">{tg.name}</span>
                                        <span className="text-[10px] font-semibold text-[var(--text-tertiary)] bg-[var(--bg-primary)] px-1.5 py-0.5 rounded-full border border-[var(--border-primary)]/60 shrink-0">
                                            {tg.count}
                                        </span>
                                    </button>
                                    {isOpen && (
                                        <div className="border-t border-[var(--border-primary)] py-1">
                                            {(tg.pages || []).map((pg) => (
                                                <button
                                                    key={pg.id}
                                                    type="button"
                                                    onClick={() => onPageSelect?.(pg.id)}
                                                    className="w-full flex items-center gap-2 px-3 py-1.5 pl-9 text-left hover:bg-[var(--bg-secondary)] transition-colors"
                                                >
                                                    <FileText size={13} className="text-[var(--text-tertiary)] shrink-0" />
                                                    <span className="text-sm text-[var(--text-secondary)] truncate">
                                                        {pg.title || t('common.untitled', 'Sense títol')}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

export default VaultTagsView;
