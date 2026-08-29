import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Clock, Search, Trash2, Undo2 } from 'lucide-react';

import i18n from '../../i18n';
import { logError } from '../../lib/notifyError';
import { toast } from '../../lib/toast';
import {
    emptyVaultTrash,
    fetchVaultTrash,
    purgeVaultTrashPage,
    restoreVaultPage,
    type VaultTrashEntry,
} from '../../shared/api/vaults';
import { ConfirmModal } from '../ConfirmModal';


export interface VaultTrashViewProps {
    readonly onAfterChange?: () => void;
}


interface PurgeTarget {
    readonly id: string;
    readonly title?: string | null;
}


function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}


function getErrorStatus(error: unknown): unknown {
    if (!isUnknownRecord(error)) return undefined;
    if (error.status === 409) return error.status;
    const response = error.response;
    return isUnknownRecord(response) ? response.status : undefined;
}


function fmtDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString(i18n.language, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return iso;
    }
}


function fmtBytes(bytes: number | null | undefined): string {
    if (!bytes || bytes <= 0) return '';
    const units = ['B', 'kB', 'MB', 'GB'] as const;
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex] ?? 'B'}`;
}


export function VaultTrashView({ onAfterChange }: VaultTrashViewProps) {
    const { t } = useTranslation();
    const [items, setItems] = useState<ReadonlyArray<VaultTrashEntry>>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [retentionDays, setRetentionDays] = useState(90);
    const [confirmEmptyAll, setConfirmEmptyAll] = useState(false);
    const [purgeTarget, setPurgeTarget] = useState<PurgeTarget | null>(null);

    const fetchTrash = useCallback(async (): Promise<void> => {
        setLoading(true);
        try {
            const trash = await fetchVaultTrash();
            setItems(trash.items);
            setRetentionDays(trash.retention_days);
        } catch (error: unknown) {
            logError('vault-trash.load', error);
            toast.error(t('trash.load_error', 'Could not load the trash'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        let mounted = true;
        void fetchVaultTrash()
            .then((trash) => {
                if (!mounted) return;
                setItems(trash.items);
                setRetentionDays(trash.retention_days);
            })
            .catch((error: unknown) => {
                if (!mounted) return;
                logError('vault-trash.load', error);
                toast.error(t('trash.load_error', 'Could not load the trash'));
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });
        return () => {
            mounted = false;
        };
    }, [t]);

    const filtered = useMemo(() => {
        if (!searchTerm) return items;
        const needle = searchTerm.toLowerCase();
        return items.filter((item) =>
            (item.title || '').toLowerCase().includes(needle)
            || item.id.toLowerCase().includes(needle)
            || (item.original_path || '').toLowerCase().includes(needle)
        );
    }, [items, searchTerm]);

    const handleRestore = async (id: string): Promise<void> => {
        try {
            await restoreVaultPage(id);
            toast.success(t('success.page_restored'));
            await fetchTrash();
            onAfterChange?.();
        } catch (error: unknown) {
            if (getErrorStatus(error) === 409) {
                toast.error(t(
                    'trash.restore_conflict_error',
                    'A file already exists at the original destination',
                ));
            } else {
                logError('vault-trash.restore', error);
                toast.error(t('errors.restore_page'));
            }
        }
    };

    const executePurge = async (): Promise<void> => {
        if (!purgeTarget) return;
        const { id } = purgeTarget;
        try {
            await purgeVaultTrashPage(id);
            toast.success(t('trash.purge_success', 'Permanently deleted'));
            setPurgeTarget(null);
            await fetchTrash();
            onAfterChange?.();
        } catch (error: unknown) {
            logError('vault-trash.purge', error);
            toast.error(t('trash.purge_error', 'Could not purge'));
            setPurgeTarget(null);
        }
    };

    const handleEmptyAll = async (): Promise<void> => {
        try {
            const { purged_count, failed_count } = await emptyVaultTrash();
            if (failed_count > 0) {
                toast.error(t(
                    'trash.empty_all_partial_error',
                    'Trash partially emptied: {{purged}} deleted, {{failed}} failed',
                    { purged: purged_count, failed: failed_count },
                ));
            } else {
                toast.success(t('trash.empty_all_success', {
                    count: purged_count,
                    defaultValue: 'Trash emptied ({{count}} items)',
                }));
            }
            setConfirmEmptyAll(false);
            await fetchTrash();
            onAfterChange?.();
        } catch (error: unknown) {
            logError('vault-trash.empty', error);
            toast.error(t('trash.empty_all_error', 'Could not empty the trash'));
        }
    };

    return (
        <div className="w-full h-full overflow-y-auto bg-[var(--bg-secondary)] flex flex-col">
            <div className="px-6 pt-8 pb-4 max-w-4xl w-full mx-auto">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                        <Trash2 size={28} className="text-[var(--text-secondary)]" />
                        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
                            {t('trash.title', 'Trash')}
                        </h1>
                    </div>
                    {items.length > 0 && (
                        <button
                            type="button"
                            onClick={() => { setConfirmEmptyAll(true); }}
                            className="px-3 py-1.5 text-sm font-medium rounded-md border border-red-500/40 text-red-500 hover:bg-red-500/10"
                        >
                            {t('trash.empty_all_button', 'Empty trash')}
                        </button>
                    )}
                </div>
                <p className="text-sm text-[var(--text-tertiary)] mb-6">
                    {t(
                        'trash.retention_notice',
                        'Deleted pages are automatically removed after {{days}} days.',
                        { days: retentionDays },
                    )}
                </p>

                <div className="relative mb-4">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                    <input
                        type="text"
                        placeholder={t(
                            'trash.search_placeholder',
                            'Search the trash by title, id or original path…',
                        )}
                        value={searchTerm}
                        onChange={(event) => { setSearchTerm(event.target.value); }}
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-md bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--gnosi-primary)]"
                    />
                </div>

                {loading && (
                    <div className="text-center py-12 text-[var(--text-tertiary)]">
                        {t('common.loading', 'Loading...')}
                    </div>
                )}
                {!loading && filtered.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)]">
                        <Trash2 size={48} className="mb-4 text-[var(--bg-tertiary)]" strokeWidth={1} />
                        <p>
                            {items.length === 0
                                ? t('trash.empty_state', 'The trash is empty.')
                                : t('trash.no_search_results', 'No results for the search.')}
                        </p>
                    </div>
                )}
                {!loading && filtered.length > 0 && (
                    <ul className="flex flex-col gap-2">
                        {filtered.map((item) => {
                            const daysRemaining = item.days_remaining;
                            const urgent = daysRemaining !== null
                                && daysRemaining !== undefined
                                && daysRemaining <= 7;
                            return (
                                <li
                                    key={item.id}
                                    className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-4 py-3 flex items-center gap-4 hover:border-[var(--gnosi-primary)]/40 transition-colors"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-base font-medium text-[var(--text-primary)] truncate">
                                                {item.title || t('common.untitled', 'Untitled')}
                                            </h3>
                                            {urgent && (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-500 bg-red-500/10 border border-red-500/20 rounded px-1.5 py-0.5">
                                                    <AlertTriangle size={10} />
                                                    {t('trash.days_remaining_badge', '{{count}}d', {
                                                        count: daysRemaining,
                                                    })}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-tertiary)]">
                                            <span className="flex items-center gap-1">
                                                <Clock size={12} />
                                                {t('trash.deleted_at', 'Deleted {{date}}', {
                                                    date: fmtDate(item.deleted_at),
                                                })}
                                            </span>
                                            {item.original_path && (
                                                <span className="truncate" title={item.original_path}>
                                                    {item.original_path}
                                                </span>
                                            )}
                                            {item.size_bytes ? <span>{fmtBytes(item.size_bytes)}</span> : null}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => { void handleRestore(item.id); }}
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md bg-[var(--gnosi-primary)] text-white hover:opacity-90"
                                            title={t('trash.restore_button', 'Restore')}
                                        >
                                            <Undo2 size={12} />
                                            {' '}
                                            {t('trash.restore_button', 'Restore')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setPurgeTarget({
                                                    id: item.id,
                                                    title: item.title,
                                                });
                                            }}
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-red-500/30 text-red-500 hover:bg-red-500/10"
                                            title={t('trash.purge_tooltip', 'Delete permanently')}
                                        >
                                            <Trash2 size={12} />
                                            {' '}
                                            {t('trash.purge_button', 'Purge')}
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
                onClose={() => { setConfirmEmptyAll(false); }}
                onConfirm={handleEmptyAll}
                title={t('trash.empty_all_confirm_title', 'Empty the trash?')}
                message={t('trash.empty_all_confirm_message', {
                    count: items.length,
                    defaultValue: '{{count}} items will be permanently deleted. This action cannot be undone.',
                })}
                confirmText={t('trash.empty_all_confirm_button', 'Empty')}
            />

            <ConfirmModal
                isOpen={purgeTarget !== null}
                onClose={() => { setPurgeTarget(null); }}
                onConfirm={executePurge}
                title={t('trash.purge_confirm_title', 'Delete permanently?')}
                message={purgeTarget
                    ? t(
                        'trash.purge_confirm_message',
                        '"{{title}}" will be permanently deleted and cannot be recovered.',
                        { title: purgeTarget.title || purgeTarget.id },
                    )
                    : ''}
                confirmText={t('common.delete', 'Delete')}
            />
        </div>
    );
}


export default VaultTrashView;
