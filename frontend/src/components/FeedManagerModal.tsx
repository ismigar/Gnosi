import { useRef } from 'react';
import { Clock, Plus, Rss, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { ConfirmModal } from './ConfirmModal';
import {
    FeedAddView,
    FeedSchedulerView,
    FeedSourcesView,
} from './feed-manager/FeedManagerViews';
import { groupFeedSources } from './feed-manager/feedManagerModel';
import type { FeedManagerTab } from './feed-manager/feedManagerModel';
import { useFeedManagerController } from './feed-manager/useFeedManagerController';


export interface FeedManagerModalProps {
    readonly isOpen: boolean;
    readonly onClose: () => void;
    readonly onRefresh?: () => unknown;
}


export function FeedManagerModal({
    isOpen,
    onClose,
    onRefresh,
}: FeedManagerModalProps) {
    const { t } = useTranslation();
    const modalRef = useRef<HTMLDivElement | null>(null);
    const feedManager = useFeedManagerController({ isOpen, onRefresh });

    useModalKeyboard({
        containerRef: modalRef,
        isOpen,
        onClose,
        trapFocus: true,
    });

    if (!isOpen) return null;

    const sourceGroups = groupFeedSources(feedManager.sources);
    const tabs: ReadonlyArray<{
        readonly id: FeedManagerTab;
        readonly label: string;
        readonly icon: typeof Rss;
    }> = [
        {
            icon: Rss,
            id: 'sources',
            label: t('feed_manager.tab_sources', 'Sources'),
        },
        {
            icon: Plus,
            id: 'add',
            label: t('feed_manager.tab_add', 'Add'),
        },
        {
            icon: Clock,
            id: 'scheduler',
            label: t('feed_manager.tab_scheduler', 'Automatic'),
        },
    ];

    return (
        <div className="settings-overlay">
            <div
                ref={modalRef}
                className="feed-modal"
                role="dialog"
                aria-modal="true"
                aria-label={t('feed_manager.title', 'Feed Management')}
            >
                <div className="settings-modal__header">
                    <h2 className="settings-modal__title">
                        📡 {t('feed_manager.title', 'Feed Management')}
                    </h2>
                    <button
                        className="gnosi-close-btn"
                        onClick={onClose}
                        aria-label={t('common.close', 'Close')}
                    >
                        <X />
                    </button>
                </div>

                <div className="feed-tabs">
                    {tabs.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            className={`feed-tab ${feedManager.activeTab === id ? 'feed-tab--active' : ''}`}
                            onClick={() => {
                                feedManager.setActiveTab(id);
                            }}
                        >
                            <Icon size={16} />
                            <span>{label}</span>
                        </button>
                    ))}
                </div>

                <div className="feed-modal__content">
                    {feedManager.activeTab === 'sources' && (
                        <FeedSourcesView
                            loading={feedManager.loading}
                            newsletters={sourceGroups.newsletters}
                            onDelete={feedManager.deleteSource}
                            rss={sourceGroups.rss}
                            sourceCount={feedManager.sources.length}
                        />
                    )}
                    {feedManager.activeTab === 'add' && (
                        <FeedAddView
                            addLoading={feedManager.addLoading}
                            category={feedManager.newCategory}
                            name={feedManager.newName}
                            onCategoryChange={feedManager.setNewCategory}
                            onImportOpml={feedManager.importOpml}
                            onNameChange={feedManager.setNewName}
                            onSubmit={feedManager.submitFeed}
                            onUrlChange={feedManager.setNewUrl}
                            url={feedManager.newUrl}
                        />
                    )}
                    {feedManager.activeTab === 'scheduler' && (
                        <FeedSchedulerView
                            onRun={feedManager.runTask}
                            onToggle={feedManager.toggleTask}
                            runningTask={feedManager.runningTask}
                            tasks={feedManager.schedulerTasks}
                        />
                    )}
                </div>

                <ConfirmModal
                    isOpen={feedManager.confirmModal.isOpen}
                    onClose={feedManager.closeDeleteConfirmation}
                    onConfirm={feedManager.confirmDeleteSource}
                    title={t(
                        'feed_manager.delete_feed_title',
                        'Delete Feed',
                    )}
                    message={t(
                        'feed_manager.delete_feed_message',
                        'Are you sure you want to delete this feed and all its articles? This action cannot be undone.',
                    )}
                    confirmText={t('common.delete')}
                    isDestructive
                />
            </div>
        </div>
    );
}
