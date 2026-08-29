import {
    isFilterGroup,
    viewMatchesFilters,
    type FilterItem,
} from '../../../utils/vaultFilters';
import { isMainView, isViewHidden } from '../viewConstants';
import type { HeaderTemplate, HeaderView } from './types';

export function activeViewRecordCount(
    notes: readonly FilterItem[],
    views: readonly HeaderView[],
    activeViewId: string | null | undefined,
    recordCount: number,
): number {
    const activeView = views.find((view) => view.id === activeViewId);
    if (!activeView) return recordCount;
    const hasActiveFilter = isFilterGroup(activeView.filterTree)
        ? activeView.filterTree.rules.length > 0
        : (activeView.filters?.length ?? 0) > 0;
    return hasActiveFilter
        ? notes.filter((note) => viewMatchesFilters(note, activeView)).length
        : recordCount;
}

export function visibleTabViews(
    views: readonly HeaderView[],
): HeaderView[] {
    return views
        .filter((view) => !isViewHidden(view, views))
        .sort((left, right) => (
            (isMainView(right, views) ? 1 : 0)
            - (isMainView(left, views) ? 1 : 0)
        ));
}

export function displayedTabViews(
    views: readonly HeaderView[],
    activeViewId: string | null | undefined,
    visibleCount: number,
): HeaderView[] {
    const activeIndex = views.findIndex((view) => view.id === activeViewId);
    if (activeIndex === -1 || activeIndex < visibleCount) return [...views];
    const display = [...views];
    const activeView = display.splice(activeIndex, 1).at(0);
    if (!activeView) return display;
    display.splice(visibleCount - 1, 0, activeView);
    return display;
}

export function sortedTemplates(
    templates: readonly HeaderTemplate[],
): HeaderTemplate[] {
    return [...templates].sort((left, right) => (
        (left.title ?? '').localeCompare(
            right.title ?? '',
            undefined,
            { sensitivity: 'base', numeric: true },
        )
    ));
}
