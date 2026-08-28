import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, LayoutDashboard, Calendar, History, Sparkles, Share2 } from 'lucide-react';
import Column from '../components/social/Column';
import Composer from '../components/social/Composer';
import AddStreamModal from '../components/social/AddStreamModal';
import ContentCalendar from './ContentCalendar';
import PostHistory from './PostHistory';
import { PublishSocialModal } from '../components/Vault/PublishSocialModal';
import { AppHeader } from '../components/AppHeader';
import {
    useSocialFeeds,
    useSocialStreams,
    useUpdateSocialStreams,
} from '../shared/api/useSocialData';

const DEFAULT_STREAMS = [
    { id: "mastodon-home", title: "Mastodon Home", icon: "🐘", network: "mastodon" },
    { id: "bluesky-home", title: "Bluesky Home", icon: "🦋", network: "bluesky" },
    { id: "scheduled", title: "Programats", icon: "📅", network: "scheduled" },
];

const TABS = [
    { id: 'dashboard', labelKey: 'social.tab_dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'calendar',  labelKey: 'social.tab_calendar', label: 'Calendari',  icon: Calendar },
    { id: 'history',   labelKey: 'social.tab_history', label: 'Historial',  icon: History },
];

const SocialDashboard = () => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState('dashboard');
    const [showComposer, setShowComposer] = useState(false);
    const [showAIComposer, setShowAIComposer] = useState(false);
    const [showAddStream, setShowAddStream] = useState(false);
    const streamsQuery = useSocialStreams();
    const columns = streamsQuery.data || DEFAULT_STREAMS;
    const feedQueries = useSocialFeeds(columns);
    const updateStreams = useUpdateSocialStreams();
    const streamData = Object.fromEntries(
        columns.map((column, index) => [column.id, feedQueries[index]?.data || []]),
    );
    const loading = streamsQuery.isLoading || feedQueries.some(query => query.isLoading);

    const saveStreams = async (newColumns) => {
        try {
            await updateStreams.mutateAsync(newColumns);
        } catch (e) {
            console.error('Error saving streams:', e);
        }
    };

    const handleAddStream = (newStream) => {
        const updated = [...columns, newStream];
        saveStreams(updated);
    };

    const handleDeleteStream = (streamId) => {
        const updated = columns.filter(col => col.id !== streamId);
        saveStreams(updated);
    };

    const handleRefreshStream = (streamId) => {
        const index = columns.findIndex(column => column.id === streamId);
        if (index >= 0) feedQueries[index]?.refetch();
    };

    return (
        <div className="h-full flex flex-col bg-[var(--bg-primary)] relative overflow-hidden">
            <AppHeader icon={Share2} title={t('home.module_social_title', 'Social media')}>
                <div className="social-header-actions">
                    <nav className="social-header-tabs" aria-label={t('social.section_navigation', 'Social sections')}>
                        {TABS.map(({ id, label, labelKey, icon: Icon }) => (
                            <button
                                key={id}
                                onClick={() => setActiveTab(id)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                                    activeTab === id
                                        ? 'bg-[var(--sidebar-item-active)] text-[var(--sidebar-item-active-text)]'
                                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                                }`}
                            >
                                <Icon size={15} strokeWidth={1.8} />
                                <span>{labelKey ? t(labelKey, label) : label}</span>
                            </button>
                        ))}
                    </nav>

                    {activeTab === 'dashboard' && (
                        <div className="social-header-primary-actions">
                            <button
                                onClick={() => setShowAIComposer(true)}
                                className="gnosi-button gnosi-button--secondary"
                            >
                                <Sparkles size={16} />
                                <span>{t('social.with_ai', "With AI")}</span>
                            </button>
                            <button
                                onClick={() => setShowComposer(v => !v)}
                                className="gnosi-button gnosi-button--primary"
                            >
                                <Plus size={16} />
                                <span>{showComposer ? t('common.close', "Close") : t('social.new_post', "New post")}</span>
                            </button>
                        </div>
                    )}
                </div>
            </AppHeader>

            {/* Contingut */}
            <div className="flex-1 overflow-hidden relative z-0">
                {activeTab === 'dashboard' && (
                    <div className="h-full flex flex-col p-6 max-md:p-4 overflow-hidden">
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
                                    {t('social.streams_loading', "Loading streams...")}
                                </div>
                            ) : (
                                <div className="flex gap-6 h-full pb-4 overflow-x-auto snap-x">
                                    {columns.map(col => (
                                        <Column
                                            key={col.id}
                                            id={col.id}
                                            title={col.title}
                                            icon={col.icon}
                                            network={col.network}
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
                                        <span className="font-medium">{t('social.add_stream', "Add stream")}</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'calendar' && <ContentCalendar />}
                {activeTab === 'history'  && <PostHistory />}
            </div>

            <PublishSocialModal
                isOpen={showAIComposer}
                onClose={() => setShowAIComposer(false)}
                onPublished={() => {
                    setShowAIComposer(false);
                    feedQueries.forEach(query => query.refetch());
                }}
            />
        </div>
    );
};

export default SocialDashboard;
