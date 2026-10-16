import { BookmarksSection } from '../../../../shared/bookmarks/BookmarksSection';
import type { SidebarController } from './useSidebarController';

/** The historical Favorites mount now renders the single synced bookmark list. */
export function FavoritesSection({ view }: { view: SidebarController }) {
    return <BookmarksSection onPageSelect={view.onPageSelect} pages={view.pages} activePageId={view.activePageId}
        expanded={view.isFavoritesExpanded} onExpandedChange={view.setIsFavoritesExpanded} />;
}
