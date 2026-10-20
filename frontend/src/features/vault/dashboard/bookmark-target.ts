import { isBookmarkRoute } from '../../../shared/bookmarks/bookmark-routes';
import { getTableIdFromTab } from './tab-model';
import type { Tab } from './types';

export function tabBookmarkTarget(tab: Tab | null | undefined, viewId: string | null = null): { kind: 'page' | 'route'; target: string } | null {
  if (!tab?.id) return null;
  let route: string;
  if (tab.isTable) {
    const tableId = getTableIdFromTab(tab);
    if (!tableId) return null;
    route = `/knowledge/table/${encodeURIComponent(tableId)}${viewId ? `/view/${encodeURIComponent(viewId)}` : ''}`;
  } else if (tab.isDrawing) {
    route = `/knowledge/drawing/${encodeURIComponent(tab.id)}`;
  } else if (tab.isPdf) {
    if (!tab.src) return null;
    const query = new URLSearchParams({ src: tab.src, kind: tab.kind ?? 'pdf' });
    const pageNumber = tab.location?.pageNumber;
    if (typeof pageNumber === 'number' || typeof pageNumber === 'string') query.set('page', String(pageNumber));
    route = `/knowledge/document?${query.toString()}`;
  } else return { kind: 'page', target: tab.id };
  return isBookmarkRoute(route) ? { kind: 'route', target: route } : null;
}
