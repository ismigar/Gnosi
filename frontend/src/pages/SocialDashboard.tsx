import { useState } from 'react';
import {
  Calendar,
  History,
  LayoutDashboard,
  Plus,
  Share2,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AppHeader } from '../components/AppHeader';
import { PublishSocialModal } from '../components/Vault/PublishSocialModal';
import AddStreamModal from '../components/social/AddStreamModal';
import Column from '../components/social/Column';
import Composer from '../components/social/Composer';
import type { SocialPost, SocialStream } from '../shared/api/social';
import {
  useSocialFeeds,
  useSocialStreams,
  useUpdateSocialStreams,
} from '../shared/api/useSocialData';
import ContentCalendar from './ContentCalendar';
import PostHistory from './PostHistory';


const DEFAULT_STREAMS: SocialStream[] = [
  { icon: '🐘', id: 'mastodon-home', network: 'mastodon', title: 'Mastodon Home' },
  { icon: '🦋', id: 'bluesky-home', network: 'bluesky', title: 'Bluesky Home' },
  { icon: '📅', id: 'scheduled', network: 'scheduled', title: 'Programats' },
];


type SocialTabId = 'calendar' | 'dashboard' | 'history';


interface SocialTab {
  readonly icon: LucideIcon;
  readonly id: SocialTabId;
  readonly label: string;
  readonly labelKey: string;
}


const TABS: readonly SocialTab[] = [
  { icon: LayoutDashboard, id: 'dashboard', label: 'Dashboard', labelKey: 'social.tab_dashboard' },
  { icon: Calendar, id: 'calendar', label: 'Calendari', labelKey: 'social.tab_calendar' },
  { icon: History, id: 'history', label: 'Historial', labelKey: 'social.tab_history' },
];


export default function SocialDashboard() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SocialTabId>('dashboard');
  const [showComposer, setShowComposer] = useState(false);
  const [showAiComposer, setShowAiComposer] = useState(false);
  const [showAddStream, setShowAddStream] = useState(false);
  const streamsQuery = useSocialStreams();
  const columns = streamsQuery.data ?? DEFAULT_STREAMS;
  const feedQueries = useSocialFeeds(columns);
  const updateStreams = useUpdateSocialStreams();
  const streamData = columns.reduce<Record<string, SocialPost[]>>(
    (data, column, index) => {
      data[column.id] = feedQueries.at(index)?.data ?? [];
      return data;
    },
    {},
  );
  const loading = streamsQuery.isLoading
    || feedQueries.some((query) => query.isLoading);

  const saveStreams = async (streams: SocialStream[]): Promise<void> => {
    try {
      await updateStreams.mutateAsync(streams);
    } catch (error: unknown) {
      console.error('Error saving streams:', error);
    }
  };

  const handleAddStream = (stream: SocialStream): void => {
    void saveStreams([...columns, stream]);
  };

  const handleDeleteStream = (streamId: string): void => {
    void saveStreams(columns.filter((column) => column.id !== streamId));
  };

  const handleRefreshStream = (streamId: string): void => {
    const index = columns.findIndex((column) => column.id === streamId);
    if (index >= 0) void feedQueries.at(index)?.refetch();
  };

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)] relative overflow-hidden">
      <AppHeader icon={Share2} title={t('home.module_social_title', 'Social media')}>
        <div className="social-header-actions">
          <nav aria-label={t('social.section_navigation', 'Social sections')} className="social-header-tabs">
            {TABS.map(({ icon: Icon, id, label, labelKey }) => (
              <button
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${activeTab === id
                  ? 'bg-[var(--sidebar-item-active)] text-[var(--sidebar-item-active-text)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                }`}
                key={id}
                onClick={() => {
                  setActiveTab(id);
                }}
              >
                <Icon size={15} strokeWidth={1.8} />
                <span>{t(labelKey, label)}</span>
              </button>
            ))}
          </nav>
          {activeTab === 'dashboard' && (
            <div className="social-header-primary-actions">
              <button className="gnosi-button gnosi-button--secondary" onClick={() => { setShowAiComposer(true); }}>
                <Sparkles size={16} />
                <span>{t('social.with_ai', 'With AI')}</span>
              </button>
              <button className="gnosi-button gnosi-button--primary" onClick={() => { setShowComposer((visible) => !visible); }}>
                <Plus size={16} />
                <span>{showComposer ? t('common.close', 'Close') : t('social.new_post', 'New post')}</span>
              </button>
            </div>
          )}
        </div>
      </AppHeader>
      <div className="flex-1 overflow-hidden relative z-0">
        {activeTab === 'dashboard' && (
          <div className="h-full flex flex-col p-6 max-md:p-4 overflow-hidden">
            <AddStreamModal
              isOpen={showAddStream}
              onAdd={handleAddStream}
              onClose={() => { setShowAddStream(false); }}
            />
            {showComposer && (
              <div className="mb-6 animate-in slide-in-from-top-4 duration-300 fade-in shrink-0">
                <div className="max-w-2xl mx-auto"><Composer /></div>
              </div>
            )}
            <div className="flex-1 overflow-hidden">
              {loading && Object.keys(streamData).length === 0 ? (
                <div className="flex justify-center items-center h-64 text-[var(--text-secondary)] animate-pulse">
                  {t('social.streams_loading', 'Loading streams...')}
                </div>
              ) : (
                <div className="flex gap-6 h-full pb-4 overflow-x-auto snap-x">
                  {columns.map((column) => (
                    <Column
                      icon={column.icon}
                      key={column.id}
                      network={column.network}
                      onDelete={() => { handleDeleteStream(column.id); }}
                      onRefresh={() => { handleRefreshStream(column.id); }}
                      posts={streamData[column.id] ?? []}
                      title={column.title}
                    />
                  ))}
                  <button
                    className="min-w-[320px] h-full border-2 border-dashed border-[var(--border-primary)] rounded-2xl flex flex-col items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--gnosi-blue)]/40 hover:bg-[var(--bg-secondary)]/50 transition-all gap-2 group shrink-0"
                    onClick={() => { setShowAddStream(true); }}
                  >
                    <div className="w-12 h-12 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center group-hover:bg-[var(--bg-tertiary)] transition-colors">
                      <Plus size={24} />
                    </div>
                    <span className="font-medium">{t('social.add_stream', 'Add stream')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {activeTab === 'calendar' && <ContentCalendar />}
        {activeTab === 'history' && <PostHistory />}
      </div>
      <PublishSocialModal
        isOpen={showAiComposer}
        onClose={() => { setShowAiComposer(false); }}
        onPublished={() => {
          setShowAiComposer(false);
          feedQueries.forEach((query) => { void query.refetch(); });
        }}
      />
    </div>
  );
}
