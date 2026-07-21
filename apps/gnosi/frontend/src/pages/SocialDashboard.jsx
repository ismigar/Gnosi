import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, LayoutDashboard, Calendar, History, Sparkles } from 'lucide-react';
import { useActiveVaultName } from '../hooks/useActiveVaultName';
import Column from '../components/social/Column';
import Composer from '../components/social/Composer';
import AddStreamModal from '../components/social/AddStreamModal';
import ContentCalendar from './ContentCalendar';
import PostHistory from './PostHistory';
import { PublishSocialModal } from '../components/Vault/PublishSocialModal';

const DEFAULT_STREAMS = [
    { id: "mastodon-home", title: "Mastodon Home", icon: "🐘", network: "mastodon" },
    { id: "bluesky-home", title: "Bluesky Home", icon: "🦋", network: "bluesky" },
    { id: "scheduled", title: "Programats", icon: "📅", network: "scheduled" },
];

const TABS = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'calendar',  labelKey: 'social.tab_calendar', label: 'Calendari',  icon: Calendar },
    { id: 'history',   labelKey: 'social.tab_history', label: 'Historial',  icon: History },
];

const SocialDashboard = () => {
    const { t } = useTranslation();
    const activeVaultName = useActiveVaultName();
    const [activeTab, setActiveTab] = useState('dashboard');
    const [showComposer, setShowComposer] = useState(false);
    const [showAIComposer, setShowAIComposer] = useState(false);
    const [showAddStream, setShowAddStream] = useState(false);
    const [columns, setColumns] = useState(DEFAULT_STREAMS);
    const [streamData, setStreamData] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/social/streams')
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data) setColumns(data); })
            .catch(() => {});
    }, []);

    const saveStreams = async (newColumns) => {
        try {
            await fetch('/api/social/streams', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newColumns),
            });
        } catch (e) {
            console.error('Error saving streams:', e);
        }
    };

    const fetchStreamFeed = async (stream) => {
        try {
            const res = await fetch(`/api/social/feed/${stream.id}`);
            const data = res.ok ? await res.json() : [];
            setStreamData(prev => ({ ...prev, [stream.id]: data }));
        } catch {
            /* silent */
        }
    };

    useEffect(() => {
        const fetchAll = async () => {
            setLoading(true);
            await Promise.all(columns.map(col => fetchStreamFeed(col)));
            setLoading(false);
        };
        fetchAll();
    }, [columns]);

    const handleAddStream = (newStream) => {
        const updated = [...columns, newStream];
        setColumns(updated);
        saveStreams(updated);
    };

    const handleDeleteStream = (streamId) => {
        const updated = columns.filter(col => col.id !== streamId);
        setColumns(updated);
        saveStreams(updated);
        setStreamData(prev => {
            const next = { ...prev };
            delete next[streamId];
            return next;
        });
    };

    const handleRefreshStream = (streamId) => {
        const stream = columns.find(c => c.id === streamId);
        if (stream) fetchStreamFeed(stream);
    };

    return (
        <div className="h-full flex flex-col bg-[var(--bg-primary)] relative overflow-hidden">
            {/* Ambience effects */}
            <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-[var(--gnosi-blue)]/10 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-[var(--gnosi-primary)]/10 rounded-full blur-[100px] pointer-events-none" />

            {/* Header with tab bar */}
            <header className="h-14 px-4 flex items-center justify-between border-b border-[var(--border-primary)] shrink-0 relative z-10 bg-[var(--bg-primary)]/80 backdrop-blur-sm">
                <div className="flex items-center gap-1">
                    {TABS.map(({ id, label, labelKey, icon: Icon }) => (
                        <button
                            key={id}
                            onClick={() => setActiveTab(id)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                                activeTab === id
                                    ? 'bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)]'
                                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                            }`}
                        >
                            <Icon size={15} strokeWidth={1.8} />
                            <span>{labelKey ? t(labelKey, label) : label}</span>
                        </button>
                    ))}
                    <div className="h-4 w-px bg-[var(--border-primary)] mx-2" />
                    <span className="text-xs font-medium text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-2.5 py-1 rounded-md border border-[var(--border-primary)]">
                        Vault: {activeVaultName || '…'}
                    </span>
                </div>

                {activeTab === 'dashboard' && (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowAIComposer(true)}
                            className="flex items-center gap-2 border border-[var(--gnosi-primary)] text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 px-4 py-1.5 rounded-lg transition-all text-sm font-medium"
                        >
                            <Sparkles size={16} />
                            <span>{t('social.with_ai', 'Amb IA')}</span>
                        </button>
                        <button
                            onClick={() => setShowComposer(v => !v)}
                            className="flex items-center gap-2 bg-[var(--gnosi-blue)] hover:opacity-90 text-white px-4 py-1.5 rounded-lg transition-all shadow-lg text-sm font-medium"
                        >
                            <Plus size={16} />
                            <span>{showComposer ? t('common.close', 'Tanca') : t('social.new_post', 'Nou post')}</span>
                        </button>
                    </div>
                )}
            </header>

            {/* Contingut */}
            <main className="flex-1 overflow-hidden relative z-0">
                {activeTab === 'dashboard' && (
                    <div className="h-full flex flex-col p-6 overflow-hidden">
                        <AddStreamModal
                            isOpen={showAddStream}
                            onClose={() => setShowAddStream(false)}
                            onAdd={handleAddStream}
                        />

                        {showComposer && (
                            <div className="mb-6 animate-in slide-in-from-top-4 duration-300 fade-in shrink-0">
                                <div className="max-w-2xl mx-auto">
                                    <Composer />
                                </div>
                            </div>
                        )}

                        <div className="flex-1 overflow-hidden">
                            {loading && Object.keys(streamData).length === 0 ? (
                                <div className="flex justify-center items-center h-64 text-[var(--text-secondary)] animate-pulse">
                                    {t('social.streams_loading', 'Carregant streams...')}
                                </div>
                            ) : (
                                <div className="flex gap-6 h-full pb-4 overflow-x-auto snap-x">
                                    {columns.map(col => (
                                        <Column
                                            key={col.id}
                                            id={col.id}
                                            title={col.title}
                                            icon={col.icon}
                                            posts={streamData[col.id] || []}
                                            onDelete={() => handleDeleteStream(col.id)}
                                            onRefresh={() => handleRefreshStream(col.id)}
                                        />
                                    ))}

                                    <button
                                        onClick={() => setShowAddStream(true)}
                                        className="min-w-[320px] h-full border-2 border-dashed border-[var(--border-primary)] rounded-2xl flex flex-col items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--gnosi-blue)]/40 hover:bg-[var(--bg-secondary)]/50 transition-all gap-2 group shrink-0"
                                    >
                                        <div className="w-12 h-12 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center group-hover:bg-[var(--bg-tertiary)] transition-colors">
                                            <Plus size={24} />
                                        </div>
                                        <span className="font-medium">{t('social.add_stream', 'Afegir stream')}</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'calendar' && <ContentCalendar />}
                {activeTab === 'history'  && <PostHistory />}
            </main>

            <PublishSocialModal
                isOpen={showAIComposer}
                onClose={() => setShowAIComposer(false)}
                onPublished={() => { setShowAIComposer(false); columns.forEach(fetchStreamFeed); }}
            />
        </div>
    );
};

export default SocialDashboard;
