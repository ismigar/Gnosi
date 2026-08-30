import { useCallback, useEffect, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../../../shared/notifications/notifyError';
import { toast } from '../../../../shared/notifications/toast';
import {
    createReaderSource,
    deleteReaderSource,
    fetchReaderSources,
    importReaderOpml,
} from '../../../../shared/api/reader';
import type { ReaderSource } from '../../../../shared/api/reader';
import {
    fetchScheduledTasks,
    runScheduledTask,
    updateScheduledTask,
} from '../../../../shared/api/scheduler';
import type { ScheduledTask } from '../../../../shared/api/scheduler';
import { readerSchedulerTasks } from './feedManagerModel';
import type { FeedManagerTab } from './feedManagerModel';


interface DeleteConfirmation {
    readonly id: number | null;
    readonly isOpen: boolean;
}


export interface FeedManagerController {
    readonly activeTab: FeedManagerTab;
    readonly addLoading: boolean;
    readonly confirmModal: DeleteConfirmation;
    readonly loading: boolean;
    readonly newCategory: string;
    readonly newName: string;
    readonly newUrl: string;
    readonly runningTask: string | null;
    readonly schedulerTasks: ScheduledTask[];
    readonly setActiveTab: (tab: FeedManagerTab) => void;
    readonly setNewCategory: (value: string) => void;
    readonly setNewName: (value: string) => void;
    readonly setNewUrl: (value: string) => void;
    readonly sources: ReaderSource[];
    readonly closeDeleteConfirmation: () => void;
    readonly confirmDeleteSource: () => Promise<void>;
    readonly deleteSource: (id: number) => void;
    readonly importOpml: (file: File | null) => Promise<void>;
    readonly runTask: (name: string) => Promise<void>;
    readonly submitFeed: (
        event: SyntheticEvent<HTMLFormElement>,
    ) => Promise<void>;
    readonly toggleTask: (task: ScheduledTask) => Promise<void>;
}


export interface FeedManagerControllerOptions {
    readonly isOpen: boolean;
    readonly onRefresh?: () => unknown;
}


const CLOSED_CONFIRMATION: DeleteConfirmation = { id: null, isOpen: false };


export function useFeedManagerController({
    isOpen,
    onRefresh,
}: FeedManagerControllerOptions): FeedManagerController {
    const { t } = useTranslation();
    const [sources, setSources] = useState<ReaderSource[]>([]);
    const [schedulerTasks, setSchedulerTasks] = useState<ScheduledTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<FeedManagerTab>('sources');
    const [runningTask, setRunningTask] = useState<string | null>(null);
    const [newUrl, setNewUrl] = useState('');
    const [newName, setNewName] = useState('');
    const [newCategory, setNewCategory] = useState('');
    const [addLoading, setAddLoading] = useState(false);
    const [confirmModal, setConfirmModal] = useState<DeleteConfirmation>(
        CLOSED_CONFIRMATION,
    );

    const refreshSources = useCallback(async (): Promise<void> => {
        setLoading(true);
        try {
            setSources(await fetchReaderSources());
        } catch (error) {
            logError('feed-manager.sources-load', error);
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshScheduler = useCallback(async (): Promise<void> => {
        try {
            setSchedulerTasks(readerSchedulerTasks(await fetchScheduledTasks()));
        } catch (error) {
            logError('feed-manager.scheduler-load', error);
        }
    }, []);

    useEffect(() => {
        if (!isOpen) return undefined;
        let cancelled = false;
        void Promise.resolve().then(() => {
            if (cancelled) return;
            void refreshSources();
            void refreshScheduler();
        });
        return () => {
            cancelled = true;
        };
    }, [isOpen, refreshScheduler, refreshSources]);

    const submitFeed = async (
        event: SyntheticEvent<HTMLFormElement>,
    ): Promise<void> => {
        event.preventDefault();
        const url = newUrl.trim();
        if (!url) return;
        setAddLoading(true);
        try {
            await createReaderSource({
                category: newCategory.trim() || 'Uncategorized',
                name: newName.trim() || url,
                type: 'rss',
                url,
            });
            setNewName('');
            setNewUrl('');
            setNewCategory('');
            void refreshSources();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('feed_manager.error_connect', 'Could not connect'),
            );
        } finally {
            setAddLoading(false);
        }
    };

    const importOpml = async (file: File | null): Promise<void> => {
        if (!file) return;
        try {
            await importReaderOpml(file);
            void refreshSources();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                        'feed_manager.error_upload_file',
                        'Error uploading the file',
                    ),
            );
        }
    };

    const confirmDeleteSource = async (): Promise<void> => {
        if (confirmModal.id === null) return;
        try {
            await deleteReaderSource(confirmModal.id);
            void refreshSources();
        } catch (error) {
            logError('feed-manager.source-delete', error);
        } finally {
            setConfirmModal(CLOSED_CONFIRMATION);
        }
    };

    const deleteSource = (id: number): void => {
        setConfirmModal({ id, isOpen: true });
    };

    const closeDeleteConfirmation = (): void => {
        setConfirmModal(CLOSED_CONFIRMATION);
    };

    const toggleTask = async (task: ScheduledTask): Promise<void> => {
        try {
            await updateScheduledTask({
                name: task.name,
                update: {
                    enabled: !task.enabled,
                    interval_minutes: task.interval_minutes,
                },
            });
            void refreshScheduler();
        } catch (error) {
            logError('feed-manager.task-toggle', error);
        }
    };

    const runTask = async (name: string): Promise<void> => {
        setRunningTask(name);
        try {
            await runScheduledTask(name);
            void refreshSources();
            void refreshScheduler();
            onRefresh?.();
        } catch (error) {
            toast.error(t('feed_manager.error_run_task', 'Could not run'));
            logError('feed-manager.task-run', error);
        } finally {
            setRunningTask(null);
        }
    };

    return {
        activeTab,
        addLoading,
        closeDeleteConfirmation,
        confirmDeleteSource,
        confirmModal,
        deleteSource,
        importOpml,
        loading,
        newCategory,
        newName,
        newUrl,
        runTask,
        runningTask,
        schedulerTasks,
        setActiveTab,
        setNewCategory,
        setNewName,
        setNewUrl,
        sources,
        submitFeed,
        toggleTask,
    };
}
