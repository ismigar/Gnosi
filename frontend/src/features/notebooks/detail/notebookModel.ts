import type { NotebookDetail } from '../../../shared/api/notebooks';
import { defineStorageKey, readStorage, stringStorageCodec } from '../../../shared/platform/browser-storage';
import type { LoadOptions, MobileTab, NotebookChatContext, NotebookGroup, NotebookResource } from './notebookTypes';

export const MOBILE_TAB_IDS: readonly MobileTab[] = ['sources', 'chat', 'settings'];
const ACTIVE_STATES = new Set(['queued', 'indexing']);
export const NOTEBOOK_USER_ID = defineStorageKey('gnosi_user_id', stringStorageCodec);

export function notebookStorageIdentity(): string {
    return readStorage(NOTEBOOK_USER_ID) || 'personal';
}

export function isIndexing(notebook: NotebookDetail): boolean {
    return ACTIVE_STATES.has(notebook.progress?.state ?? '');
}

export function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

export function nextMobileTab(current: MobileTab, key: string): MobileTab | undefined {
    const index = MOBILE_TAB_IDS.indexOf(current);
    if (key === 'ArrowRight') return MOBILE_TAB_IDS[(index + 1) % MOBILE_TAB_IDS.length];
    if (key === 'ArrowLeft') return MOBILE_TAB_IDS[(index - 1 + MOBILE_TAB_IDS.length) % MOBILE_TAB_IDS.length];
    if (key === 'Home') return MOBILE_TAB_IDS[0];
    if (key === 'End') return MOBILE_TAB_IDS[MOBILE_TAB_IDS.length - 1];
    return undefined;
}

export function toggleIds(previous: ReadonlySet<string>, ids: readonly string[], selected: boolean): Set<string> {
    const next = new Set(previous);
    for (const id of ids) {
        if (selected) next.delete(id);
        else next.add(id);
    }
    return next;
}

export function groupSourceIds(group: NotebookGroup, resources: readonly NotebookResource[]): string[] {
    const resourceIds = new Set(group.resource_ids);
    return resources.filter((resource) => resourceIds.has(resource.resource_id))
        .flatMap((resource) => resource.sources.map((source) => source.source_id));
}

export function moveResource(groups: readonly NotebookGroup[], resourceId: string, targetGroupId: string): NotebookGroup[] {
    return groups.map((group) => {
        const resourceIds = group.resource_ids.filter((id) => id !== resourceId);
        return { ...group, resource_ids: group.id === targetGroupId ? [...resourceIds, resourceId] : resourceIds };
    });
}

export function notebookChatContext(notebook: NotebookDetail, loaded: boolean, selected: ReadonlySet<string>): NotebookChatContext[] {
    return [{
        id: `notebook:${notebook.id}`,
        type: 'notebook',
        ref: notebook.id,
        label: notebook.title,
        scope: loaded ? { selection: 'sources', source_ids: [...selected] } : { selection: 'all', source_ids: [] },
    }];
}

export type LoadNotebook = (options?: LoadOptions) => Promise<void>;
