import type { NotebookChatSources, NotebookDetail, NotebookSourcesPage, ReferenceResourcePage } from '../../shared/api/notebooks';

export function notebookFixture(patch: Partial<NotebookDetail> = {}): NotebookDetail {
    return {
        id: 'notebook-1', title: 'Research notebook', status: 'available', active_revision: 1,
        can_manage: true, can_chat: true, chat_ready: true, conversation_mode: 'private_member',
        conversation_principal: 'member', conversation_session_id: 'session / one', created_at: '',
        groups_json: '[]', groups: [{ id: 'group-1', name: 'Primary', resource_ids: ['resource-1'] }],
        last_error: null, owner_user_id: 'member', resource_count: 2,
        source_counts: { total: 3, available: 3, stale: 0, error: 0 }, source_table_id: 'resources',
        updated_at: '', vault_scope: 'default', visibility: 'private', workspace_id: 'personal',
        ...patch,
    };
}

export function sourcesFixture(): NotebookSourcesPage {
    return {
        items: ['resource-1', 'resource-2'].map((id, index) => ({
            resource_id: id, title: index === 0 ? 'Paper' : 'Article', state: 'available', error: null,
            last_checked_at: null, updated_at: '', url_checked_at: null,
            sources: (index === 0 ? ['source-a', 'source-b'] : ['source-c']).map((sourceId) => ({
                source_id: sourceId, resource_id: id, label: sourceId, kind: index === 0 ? 'file' : 'url',
                status: 'available', error: null, fingerprint: '', snapshot_id: null, source_url: null,
            })),
        })), total: 2, page: 1, page_size: 50, active_revision: 1,
    };
}

export function chatSourcesFixture(): NotebookChatSources {
    return {
        sources: sourcesFixture().items.flatMap((resource) => resource.sources).map((source) => ({
            ...source, notebook_id: 'notebook-1', resource_title: source.resource_id,
        })),
        notebook_id: 'notebook-1', active_revision: 1, notebooks: [],
    };
}

export function resourcesFixture(): ReferenceResourcePage {
    return {
        items: ['resource-1', 'resource-3'].map((id) => ({
            id, title: id === 'resource-1' ? 'Existing Resource' : 'New Resource', source_count: 1,
            authors: ['Author'], tags: ['tag'], resource_type: 'paper', last_modified: null,
        })), total: 101, page: 1, page_size: 50, source_fields: 2, hidden_without_sources: 3,
        facets: { authors: [{ value: 'Author', count: 2 }], tags: [{ value: 'tag', count: 2 }], types: [{ value: 'paper', count: 2 }] },
    };
}
