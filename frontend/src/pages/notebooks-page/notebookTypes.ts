import type { ComponentType } from 'react';
import type { NotebookDetail, NotebookSourcesPage } from '../../shared/api/notebooks';
import type { NotebookResourceFiltersProps } from '../../components/Notebooks/NotebookResourceFilters';

export type NotebookGroup = NonNullable<NotebookDetail['groups']>[number];
export type NotebookResource = NotebookSourcesPage['items'][number];
export type ResourceFilters = Required<NotebookResourceFiltersProps['filters']>;
export type MobileTab = 'sources' | 'chat' | 'settings';
export interface LoadOptions { refresh?: boolean; page?: number }

export interface NotebookChatContext {
    id: string;
    type: 'notebook';
    ref: string;
    label: string;
    scope: { selection: 'sources' | 'all'; source_ids: string[] };
}

/** Compatibility boundary until the independently owned AgentChat is typed. */
export type NotebookAgentComponent = ComponentType<{
    embedded: boolean;
    storageIdentity: string;
    forcedSessionId: string;
    forcedAgentId: string;
    notebookId: string;
    conversationMode: string;
    contextRefs: NotebookChatContext[];
    readOnly: boolean;
}>;
