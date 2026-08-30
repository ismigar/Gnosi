import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import { useMediaQuery } from '../../../../shared/hooks/useMediaQuery';
import { readSections, readWikiLock, saveSections, saveWikiLock } from './preferences';
import type { SidebarSections } from './types';

export function useSidebarPreferences() {
    const mobile = useMediaQuery('(max-width: 768px)');
    const [sidebarSectionState, setSidebarSectionState] = useState(() => readSections(mobile));
    const [isWikiDragLocked, setIsWikiDragLocked] = useState(readWikiLock);
    useEffect(() => {
        const frame = requestAnimationFrame(() => { setSidebarSectionState(readSections(mobile)); });
        return () => { cancelAnimationFrame(frame); };
    }, [mobile]);
    // The profile chooses the key; switching profiles only hydrates on the next frame.
    useEffect(() => { saveSections(window.matchMedia('(max-width: 768px)').matches, sidebarSectionState); }, [sidebarSectionState]);
    useEffect(() => { saveWikiLock(isWikiDragLocked); }, [isWikiDragLocked]);
    const setSection = useCallback((section: keyof SidebarSections, next: SetStateAction<boolean>) => {
        setSidebarSectionState(current => ({ ...current, [section]: typeof next === 'function' ? next(current[section]) : next }));
    }, []);
    const setIsFavoritesExpanded = useCallback((value: SetStateAction<boolean>) => { setSection('favorites', value); }, [setSection]);
    const setIsDashboardExpanded = useCallback((value: SetStateAction<boolean>) => { setSection('dashboards', value); }, [setSection]);
    const setIsDatabasesExpanded = useCallback((value: SetStateAction<boolean>) => { setSection('data', value); }, [setSection]);
    const setIsWorkspaceExpanded = useCallback((value: SetStateAction<boolean>) => { setSection('wiki', value); }, [setSection]);
    return {
        isFavoritesExpanded: sidebarSectionState.favorites, isDashboardExpanded: sidebarSectionState.dashboards,
        isDatabasesExpanded: sidebarSectionState.data, isWorkspaceExpanded: sidebarSectionState.wiki,
        setIsFavoritesExpanded, setIsDashboardExpanded, setIsDatabasesExpanded, setIsWorkspaceExpanded,
        isWikiDragLocked, setIsWikiDragLocked,
    };
}
