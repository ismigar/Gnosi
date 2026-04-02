import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, Calendar, ExternalLink } from 'lucide-react';
import { SocialLayout } from '../components/social/SocialLayout';

const PostHistory = () => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        setIsRefreshing(true);
        try {
            const res = await fetch('/api/social/history');
            if (res.ok) {
                const data = await res.json();
                setHistory(data.reverse()); // Show newest first
            }
        } catch (error) {
            console.error('Error fetching history:', error);
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    };

    const formatDate = (isoString) => {
        return new Date(isoString).toLocaleString('ca-ES', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getStatusConfig = (status) => {
        const configs = {
            success: { bg: 'bg-green-500/10', text: 'text-green-400', icon: CheckCircle, label: 'Publicat' },
            failed: { bg: 'bg-red-500/10', text: 'text-red-400', icon: XCircle, label: 'Error' },
            pending: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', icon: Clock, label: 'Pendent' }
        };
        return configs[status] || configs.pending;
    };

    const ActionButton = (
        <button
            onClick={fetchHistory}
            className={`p-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-all ${isRefreshing ? 'animate-spin' : ''}`}
            title="Refrescar"
        >
            <RefreshCw size={20} />
        </button>
    );

    return (
        <SocialLayout title="History" action={ActionButton}>
            <div className="max-w-3xl mx-auto space-y-6 pb-12">
                {loading ? (
                    <div className="flex flex-col justify-center items-center h-64 text-zinc-500 gap-4">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                        <span>Carregant historial...</span>
                    </div>
                ) : history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-12 text-zinc-500 bg-white/5 rounded-2xl border border-white/5">
                        <div className="text-4xl mb-4 opacity-50">📜</div>
                        <p>Encara no hi ha posts a l'historial.</p>
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
        </SocialLayout>
    );
};

export default PostHistory;
