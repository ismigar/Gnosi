import React from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, Calendar, ExternalLink } from 'lucide-react';
import i18n from '../i18n';
import { useSocialPostHistory } from '../shared/api/useSocialData';

const PostHistory = () => {
    const { t } = useTranslation();
    const historyQuery = useSocialPostHistory();
    const history = [...(historyQuery.data || [])].reverse();
    const loading = historyQuery.isLoading;
    const isRefreshing = historyQuery.isFetching && !loading;

    const formatDate = (isoString) => {
        // Unpublished posts (pending/failed/cancelled) come with
        // `published_at` empty (the backend returns `"" `); without this guard,
        // `new Date("")`/`new Date(null)` gave "Invalid Date" or the epoch (1970).
        if (!isoString) return '—';
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleString(i18n.language, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getStatusConfig = (status) => {
        const configs = {
            success: { bg: 'bg-green-500/10', text: 'text-green-400', icon: CheckCircle, label: t('social.status_published', "Published") },
            failed: { bg: 'bg-red-500/10', text: 'text-red-400', icon: XCircle, label: t('common.error', 'Error') },
            pending: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', icon: Clock, label: t('dashboard.status_pending', "Pending") }
        };
        return configs[status] || configs.pending;
    };

    return (
        <div className="h-full overflow-y-auto p-6">
            <div className="flex justify-end mb-4 shrink-0">
                <button
                    onClick={() => historyQuery.refetch()}
                    className={`p-2 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-primary)] transition-all ${isRefreshing ? 'animate-spin' : ''}`}
                    title={t('common.refresh', "Refresh")}
                >
                    <RefreshCw size={18} />
                </button>
            </div>
            <div className="max-w-3xl mx-auto space-y-6 pb-12">
                {loading ? (
                    <div className="flex flex-col justify-center items-center h-64 text-zinc-500 gap-4">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                        <span>{t('social.history_loading', "Loading history...")}</span>
                    </div>
                ) : history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-12 text-zinc-500 bg-white/5 rounded-2xl border border-white/5">
                        <div className="text-4xl mb-4 opacity-50">📜</div>
                        <p>{t('social.history_empty', "No posts in the history yet.")}</p>
                    </div>
                ) : (
                    history.map((post, idx) => {
                        const statusConfig = getStatusConfig(post.status);
                        const StatusIcon = statusConfig.icon;

                        return (
                            <div
                                key={post.id || idx}
                                className="glass-card rounded-xl border border-white/5 p-5 relative overflow-hidden group hover:bg-white/5 transition-all"
                            >
                                {/* Status Stripe */}
                                <div className={`absolute left-0 top-0 bottom-0 w-1 ${statusConfig.bg.replace('/10', '/50')}`} />

                                <div className="flex justify-between items-start mb-3 pl-2">
                                    <div className="flex items-center gap-2 text-sm text-zinc-500">
                                        <Calendar size={14} />
                                        {formatDate(post.published_at)}
                                    </div>
                                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${statusConfig.bg} ${statusConfig.text}`}>
                                        <StatusIcon size={14} />
                                        <span>{statusConfig.label}</span>
                                    </div>
                                </div>

                                <p className="text-zinc-200 mb-4 whitespace-pre-wrap pl-2 leading-relaxed text-sm">
                                    {post.content}
                                </p>

                                <div className="flex justify-between items-end pl-2">
                                    <div className="flex gap-2 flex-wrap">
                                        {post.networks.map(net => (
                                            <span
                                                key={net}
                                                className="px-2 py-1 bg-black/20 border border-white/5 rounded-md text-[10px] uppercase font-bold tracking-wider text-zinc-400"
                                            >
                                                {net}
                                            </span>
                                        ))}
                                    </div>

                                    {post.error && (
                                        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 px-3 py-1.5 rounded-lg max-w-[50%]">
                                            <AlertTriangle size={14} className="shrink-0" />
                                            <span className="truncate">{post.error}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default PostHistory;
