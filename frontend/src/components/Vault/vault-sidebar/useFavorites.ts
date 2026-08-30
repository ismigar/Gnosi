import { KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useEffect, useMemo, useRef, useState } from 'react';
import { eventTargetIsWithin, subscribeDocumentEvent } from '../../../shared/platform/browser-events';
import { sortFavorites } from './model';
import { readFavoritesSort, saveFavoritesSort } from './preferences';
import type { FavoritesMode, SidebarPage } from './types';
export function useFavorites(favoritePages: readonly SidebarPage[]) {
    const [favoritesSort, setFavoritesSort] = useState(readFavoritesSort);
    const [isFavoritesSortOpen, setIsFavoritesSortOpen] = useState(false);
    const favoritesSortMenuRef = useRef<HTMLDivElement>(null);
    useEffect(() => { saveFavoritesSort(favoritesSort); }, [favoritesSort]);
    useEffect(() => {
        if (!isFavoritesSortOpen) return;
        return subscribeDocumentEvent('mousedown', event => {
            if (favoritesSortMenuRef.current && !eventTargetIsWithin(favoritesSortMenuRef.current, event.target)) setIsFavoritesSortOpen(false);
        });
    }, [isFavoritesSortOpen]);
    const sortedFavoritePages = useMemo(() => sortFavorites(favoritePages, favoritesSort), [favoritePages, favoritesSort]);
    const setFavoritesSortMode = (nextMode: FavoritesMode) => {
        setFavoritesSort((prev) => ({ ...prev, mode: nextMode }));
        setIsFavoritesSortOpen(false);
    };

    // dnd-kit reordering for the favorites list (only in 'manual' sort mode)
    const favoriteSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    const handleFavoriteDragEnd = ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return;
        const currentIds = sortedFavoritePages.map((p) => p.id);
        const oldIndex = currentIds.indexOf(String(active.id));
        const newIndex = currentIds.indexOf(String(over.id));
        if (oldIndex === -1 || newIndex === -1) return;
        setFavoritesSort({ mode: 'manual', manualOrder: arrayMove(currentIds, oldIndex, newIndex) });
    };
    return { favoritesSort, isFavoritesSortOpen, setIsFavoritesSortOpen, favoritesSortMenuRef, sortedFavoritePages, setFavoritesSortMode, favoriteSensors, handleFavoriteDragEnd };
}
