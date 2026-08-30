import {
    closestCenter,
    DndContext
} from '@dnd-kit/core';
import {
    SortableContext, verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { ArrowDownAZ, ArrowUpAZ, ArrowUpDown, Check, ChevronDown, ChevronRight, Clock, GripVertical } from 'lucide-react';
import { SortableFavoriteItem } from './NavigationRows';
import type { FavoritesMode } from './types';
import { useFavorites } from './useFavorites';
import type { SidebarController } from './useSidebarController';
export function FavoritesSection({ view }: { view: SidebarController; }) {
    const { favoritePages, setIsFavoritesExpanded, isFavoritesExpanded, t, onPageSelect } = view;
    const { isFavoritesSortOpen, setIsFavoritesSortOpen, favoritesSortMenuRef, setFavoritesSortMode, favoritesSort, favoriteSensors, handleFavoriteDragEnd, sortedFavoritePages } = useFavorites(favoritePages);
    return (<>
        {favoritePages.length > 0 && (
            <>
                <div className="group relative flex items-center px-3 mt-6 mb-1">
                    <button
                        onClick={() => { setIsFavoritesExpanded(!isFavoritesExpanded); }}
                        aria-expanded={isFavoritesExpanded}
                        className="gnosi-sidebar-section-title flex-1 min-w-0 flex items-center gap-1 transition-colors text-left"
                    >
                        {isFavoritesExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {t('sidebar.favorites', 'Favorites')}
                    </button>
                    <div className="relative" ref={favoritesSortMenuRef}>
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsFavoritesSortOpen((v) => !v); }}
                            className="vault-sidebar-icon-action opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded transition-all"
                            title={t('sidebar.favorites_sort', "Sort favorites")}
                            aria-label={t('sidebar.favorites_sort', "Sort favorites")}
                        >
                            <ArrowUpDown size={12} />
                        </button>
                        {isFavoritesSortOpen && (
                            <div className="absolute right-0 top-full mt-1 z-30 min-w-[180px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl py-1 text-xs">
                                {([
                                    { id: 'manual', label: t('sidebar.sort_manual', 'Manual (drag)'), icon: GripVertical },
                                    { id: 'alpha-asc', label: t('sidebar.sort_alpha_asc', 'A → Z'), icon: ArrowDownAZ },
                                    { id: 'alpha-desc', label: t('sidebar.sort_alpha_desc', 'Z → A'), icon: ArrowUpAZ },
                                    { id: 'recent', label: t('sidebar.sort_recent', "Most recent"), icon: Clock },
                                    { id: 'oldest', label: t('sidebar.sort_oldest', "Oldest"), icon: Clock },
                                ] satisfies { id: FavoritesMode; label: string; icon: typeof Clock; }[]).map(({ id, label, icon: Icon }) => (
                                    <button
                                        key={id}
                                        onClick={() => { setFavoritesSortMode(id); }}
                                        className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--bg-secondary)] text-left ${favoritesSort.mode === id ? 'text-[var(--gnosi-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}
                                    >
                                        <Icon size={12} className="shrink-0" />
                                        <span className="flex-1">{label}</span>
                                        {favoritesSort.mode === id && <Check size={12} />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                {isFavoritesExpanded && (
                    <DndContext sensors={favoriteSensors} collisionDetection={closestCenter} onDragEnd={handleFavoriteDragEnd}>
                        <SortableContext items={sortedFavoritePages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                            <div className="vault-sidebar__navigation-list px-2">
                                {sortedFavoritePages.map((page) => (
                                    <SortableFavoriteItem
                                        key={page.id}
                                        page={page}
                                        draggable={favoritesSort.mode === 'manual'}
                                        onPageSelect={onPageSelect}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                )}
            </>
        )}
    </>);
}
