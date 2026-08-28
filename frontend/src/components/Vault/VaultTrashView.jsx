import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import axios from '../../shared/api/legacy-http';
import { Trash2, Undo2, Clock, Search, AlertTriangle } from 'lucide-react';
import { toast } from '../../lib/toast';
import { ConfirmModal } from '../ConfirmModal';
import i18n from '../../i18n';

function fmtDate(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString(i18n.language, {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return iso;
    }
}

function fmtBytes(bytes) {
    if (!bytes || bytes <= 0) return '';
    const units = ['B', 'kB', 'MB', 'GB'];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function VaultTrashView({ onAfterChange }) {
    const { t } = useTranslation();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [retentionDays, setRetentionDays] = useState(90);
    const [confirmEmptyAll, setConfirmEmptyAll] = useState(false);
    // Entry pending individual purge: { id, title } or null.
    const [purgeTarget, setPurgeTarget] = useState(null);

    const fetchTrash = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/vault/trash');
            setItems(res.data?.items || []);
            setRetentionDays(res.data?.retention_days || 90);
        } catch (err) {
            console.error('Error loading trash:', err);
            toast.error(t('trash.load_error', "Could not load the trash"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => { fetchTrash(); }, [fetchTrash]);

    const filtered = useMemo(() => {
        if (!searchTerm) return items;
        const needle = searchTerm.toLowerCase();
        return items.filter(it =>
            String(it.title || '').toLowerCase().includes(needle)
            || String(it.id || '').toLowerCase().includes(needle)
            || String(it.original_path || '').toLowerCase().includes(needle)
        );
    }, [items, searchTerm]);

    const handleRestore = async (id) => {
        try {
            await axios.post(`/api/vault/pages/${id}/restore`);
            toast.success(t('success.page_restored'));
            await fetchTrash();
            onAfterChange?.();
        } catch (err) {
            if (err?.response?.status === 409) {
                toast.error(t('trash.restore_conflict_error', "A file already exists at the original destination"));
            } else {
                console.error('Error restoring:', err);
                toast.error(t('errors.restore_page'));
            }
        }
    };

    // Confirmation is handled by ConfirmModal (the app's modal, not the
    // native `window.confirm` —which Chrome may suppress after several
    // dialogs, leaving the purge undone).
    const executePurge = async () => {
        if (!purgeTarget) return;
        const { id } = purgeTarget;
        try {
            await axios.delete(`/api/vault/trash/${id}`);
            toast.success(t('trash.purge_success', "Permanently deleted"));
            setPurgeTarget(null);
            await fetchTrash();
            onAfterChange?.();
        } catch (err) {
            console.error('Error purging:', err);
            toast.error(t('trash.purge_error', "Could not purge"));
            setPurgeTarget(null);
        }
    };

    // Empty the whole trash in ONE single request to the server. Previously
    // N concurrent `DELETE /trash/{id}` calls were fired from the client, which
    // were exhausting the DB connection pool (QueuePool timeout → 500 hidden
    // by `Promise.allSettled` → the trash wasn't being emptied). See the endpoint
    // `DELETE /api/vault/trash`.
    const handleEmptyAll = async () => {
        try {
            const res = await axios.delete('/api/vault/trash');
            const { purged_count = 0, failed_count = 0 } = res.data || {};
            if (failed_count > 0) {
                toast.error(t('trash.empty_all_partial_error', "Trash partially emptied: {{purged}} deleted, {{failed}} failed", { purged: purged_count, failed: failed_count }));
            } else {
                toast.success(t('trash.empty_all_success', { count: purged_count, defaultValue: "Trash emptied ({{count}} items)" }));
            }
            setConfirmEmptyAll(false);
            await fetchTrash();
            onAfterChange?.();
        } catch (err) {
            console.error('Error emptying:', err);
            toast.error(t('trash.empty_all_error', "Could not empty the trash"));
        }
    };

    return (
        <div className="w-full h-full overflow-y-auto bg-[var(--bg-secondary)] flex flex-col">
            <div className="px-6 pt-8 pb-4 max-w-4xl w-full mx-auto">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                        <Trash2 size={28} className="text-[var(--text-secondary)]" />
                        <h1 className="text-2xl font-bold text-[var(--text-primary)]">{t('trash.title', "Trash")}</h1>
                    </div>
                    {items.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setConfirmEmptyAll(true)}
                            className="px-3 py-1.5 text-sm font-medium rounded-md border border-red-500/40 text-red-500 hover:bg-red-500/10"
                        >
                            {t('trash.empty_all_button', "Empty trash")}
                        </button>
                    )}
                </div>
                <p className="text-sm text-[var(--text-tertiary)] mb-6">
                    {t('trash.retention_notice', "Deleted pages are automatically removed after {{days}} days.", { days: retentionDays })}
                </p>

                <div className="relative mb-4">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                    <input
                        type="text"
                        placeholder={t('trash.search_placeholder', "Search the trash by title, id or original path…")}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-md bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--gnosi-primary)]"
                    />
                </div>

                {loading && (
                    <div className="text-center py-12 text-[var(--text-tertiary)]">{t('common.loading', "Loading...")}</div>
                )}
                {!loading && filtered.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)]">
                        <Trash2 size={48} className="mb-4 text-[var(--bg-tertiary)]" strokeWidth={1} />
                        <p>{items.length === 0 ? t('trash.empty_state', "The trash is empty.") : t('trash.no_search_results', "No results for the search.")}</p>
                    </div>
                )}
                {!loading && filtered.length > 0 && (
                    <ul className="flex flex-col gap-2">
                        {filtered.map((it) => {
                            const daysRemaining = it.days_remaining;
                            const urgent = daysRemaining !== null && daysRemaining <= 7;
                            return (
                                <li
                                    key={it.id}
                                    className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-4 py-3 flex items-center gap-4 hover:border-[var(--gnosi-primary)]/40 transition-colors"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-base font-medium text-[var(--text-primary)] truncate">
                                                {it.title || t('common.untitled', "Untitled")}
                                            </h3>
                                            {urgent && (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-500 bg-red-500/10 border border-red-500/20 rounded px-1.5 py-0.5">
                                                    <AlertTriangle size={10} />
                                                    {t('trash.days_remaining_badge', '{{count}}d', { count: daysRemaining })}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-tertiary)]">
                                            <span className="flex items-center gap-1">
                                                <Clock size={12} />
                                                {t('trash.deleted_at', "Deleted {{date}}", { date: fmtDate(it.deleted_at) })}
                                            </span>
                                            {it.original_path && (
                                                <span className="truncate" title={it.original_path}>
                                                    {it.original_path}
                                                </span>
                                            )}
                                            {it.size_bytes ? <span>{fmtBytes(it.size_bytes)}</span> : null}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => handleRestore(it.id)}
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md bg-[var(--gnosi-primary)] text-white hover:opacity-90"
                                            title={t('trash.restore_button', "Restore")}
                                        >
                                            <Undo2 size={12} /> {t('trash.restore_button', "Restore")}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPurgeTarget({ id: it.id, title: it.title })}
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-red-500/30 text-red-500 hover:bg-red-500/10"
                                            title={t('trash.purge_tooltip', "Delete permanently")}
                                        >
                                            <Trash2 size={12} /> {t('trash.purge_button', "Purge")}
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            <ConfirmModal
                isOpen={confirmEmptyAll}
                onClose={() => setConfirmEmptyAll(false)}
                onConfirm={handleEmptyAll}
                title={t('trash.empty_all_confirm_title', "Empty the trash?")}
                message={t('trash.empty_all_confirm_message', { count: items.length, defaultValue: "{{count}} items will be permanently deleted. This action cannot be undone." })}
                confirmText={t('trash.empty_all_confirm_button', "Empty")}
            />

            <ConfirmModal
                isOpen={!!purgeTarget}
                onClose={() => setPurgeTarget(null)}
                onConfirm={executePurge}
                title={t('trash.purge_confirm_title', "Delete permanently?")}
                message={purgeTarget
                    ? t('trash.purge_confirm_message', '"{{title}}" will be permanently deleted and cannot be recovered.', { title: purgeTarget.title || purgeTarget.id })
                    : ''}
                confirmText={t('common.delete', "Delete")}
            />
        </div>
    );
}

export default VaultTrashView;
