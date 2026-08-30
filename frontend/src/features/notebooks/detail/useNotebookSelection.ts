import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchNotebookChatSources, type NotebookChatSources, type NotebookDetail, type NotebookSourcesPage } from '../../../shared/api/notebooks';
import { toast } from '../../../shared/notifications/toast';
import { groupSourceIds, isAbortError, toggleIds } from './notebookModel';
import type { NotebookGroup, NotebookResource } from './notebookTypes';

export function useNotebookSelection(notebookId: string, notebook: NotebookDetail | null, sources: NotebookSourcesPage) {
    const { t } = useTranslation();
    const [chatOptions, setChatOptions] = useState<Pick<NotebookChatSources, 'sources'>>({ sources: [] });
    const [chatOptionsLoaded, setChatOptionsLoaded] = useState(false);
    const [selectedSourceIds, setSelectedSourceIds] = useState(new Set<string>());
    const [collapsedGroupIds, setCollapsedGroupIds] = useState(new Set<string>());
    const initialized = useRef(false);
    const reportError = useEffectEvent(() => {
        toast.error(t('notebooks.chat_context_error', 'Conversation sources could not be loaded.'));
    });

    useEffect(() => {
        if (!notebook?.chat_ready) return undefined;
        const controller = new AbortController();
        void fetchNotebookChatSources(notebookId, controller.signal)
            .then((data) => {
                if (!Array.isArray(data.sources)) throw new Error('Chat source list returned an invalid payload');
                setChatOptions({ sources: data.sources });
                setChatOptionsLoaded(true);
                const available = new Set(data.sources.map((source) => source.source_id));
                if (!initialized.current) {
                    initialized.current = true;
                    setSelectedSourceIds(available);
                } else {
                    setSelectedSourceIds((previous) => new Set([...previous].filter((id) => available.has(id))));
                }
            })
            .catch((error: unknown) => { if (!isAbortError(error)) reportError(); });
        return () => { controller.abort(); };
    }, [notebook?.active_revision, notebook?.chat_ready, notebookId]);

    const allSourcesSelected = chatOptions.sources.length > 0 && chatOptions.sources.every((source) => selectedSourceIds.has(source.source_id));
    const toggleAllSources = () => {
        setSelectedSourceIds(allSourcesSelected ? new Set() : new Set(chatOptions.sources.map((source) => source.source_id)));
    };
    const toggleSingleSource = (id: string) => {
        setSelectedSourceIds((previous) => toggleIds(previous, [id], previous.has(id)));
    };
    const toggleResourceSources = (resource: NotebookResource) => {
        const ids = resource.sources.map((source) => source.source_id);
        if (!ids.length) return;
        const selected = ids.every((id) => selectedSourceIds.has(id));
        setSelectedSourceIds((previous) => toggleIds(previous, ids, selected));
    };
    const getGroupSourceIds = (group: NotebookGroup) => groupSourceIds(group, sources.items);
    const toggleGroupSources = (group: NotebookGroup) => {
        const ids = getGroupSourceIds(group);
        if (!ids.length) return;
        const selected = ids.every((id) => selectedSourceIds.has(id));
        setSelectedSourceIds((previous) => toggleIds(previous, ids, selected));
    };
    const toggleCollapse = (id: string) => {
        setCollapsedGroupIds((previous) => toggleIds(previous, [id], previous.has(id)));
    };
    return { chatOptions, chatOptionsLoaded, selectedSourceIds, collapsedGroupIds, allSourcesSelected, toggleAllSources, toggleSingleSource, toggleResourceSources, getGroupSourceIds, toggleGroupSources, toggleCollapse };
}
