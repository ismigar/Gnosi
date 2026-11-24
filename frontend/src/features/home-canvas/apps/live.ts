import { APP_PREVIEW_LIMIT, type AppPreviewItem } from '../../../shared/api/app-previews';
import { fetchContacts } from '../../../shared/api/contacts';
import { fetchLiteratureSearches } from '../../../shared/api/literature-search';
import { fetchNotebooks } from '../../../shared/api/notebooks';
import { fetchReaderArticles } from '../../../shared/api/reader';
import type { RequestContext } from '../../../shared/api/request-context';
import { fetchScheduledTasks } from '../../../shared/api/scheduler';

export type LiveSource = 'contacts' | 'feeds' | 'resources' | 'notebooks' | 'automations';

export async function livePreviewItems(kind: LiveSource, scope: RequestContext, signal: AbortSignal): Promise<AppPreviewItem[]> {
    switch (kind) {
        case 'contacts': {
            const contacts = await fetchContacts({ limit: APP_PREVIEW_LIMIT, sort: 'updated' }, signal, scope);
            return contacts.map(contact => ({
                id: contact.id, title: contact.name, detail: contact.company || contact.email || undefined,
            }));
        }
        case 'feeds': {
            const articles = await fetchReaderArticles({ limit: APP_PREVIEW_LIMIT, unreadOnly: true, includeContent: false }, signal, scope);
            return articles.map(article => ({
                id: String(article.id), title: article.title, detail: article.source_name ?? undefined,
            }));
        }
        case 'resources': {
            const searches = await fetchLiteratureSearches(APP_PREVIEW_LIMIT, signal, scope);
            return searches.map(search => ({
                id: search.id, title: search.query || Object.values(search.source_queries ?? {})[0] || '',
                count: search.result_count,
            }));
        }
        case 'notebooks': {
            const notebooks = await fetchNotebooks({ page: 1, pageSize: APP_PREVIEW_LIMIT }, signal, scope);
            return notebooks.items.map(notebook => ({
                id: notebook.id, title: notebook.title, count: notebook.resource_count,
            }));
        }
        case 'automations': {
            const tasks = await fetchScheduledTasks(signal, scope);
            return tasks.filter(task => task.enabled && task.next_run && Number.isFinite(Date.parse(task.next_run)))
                .sort((left, right) => Date.parse(left.next_run ?? '') - Date.parse(right.next_run ?? ''))
                .slice(0, APP_PREVIEW_LIMIT).map(task => ({
                    id: task.name, title: task.name.replaceAll('_', ' '), date: task.next_run ?? undefined,
                }));
        }
    }
}
