import {
    Table, Columns2, LayoutGrid, List,
    Calendar, CalendarRange, Newspaper, Share2, BarChart3
} from 'lucide-react';

export const VIEW_TYPES = [
    { id: 'table', label: 'Table', icon: Table },
    { id: 'board', label: 'Kanban', icon: Columns2 },
    { id: 'gallery', label: 'Gallery', icon: LayoutGrid },
    { id: 'list', label: 'List', icon: List },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'timeline', label: 'Timeline', icon: CalendarRange },
    { id: 'feed', label: 'Feed', icon: Newspaper },
    { id: 'chart', label: 'Chart', icon: BarChart3 },
    { id: 'graph', label: 'Graph', icon: Share2 },
];

export const MAIN_VIEW_NAME = 'Main Table';
const LEGACY_MAIN_VIEW_NAMES = new Set([MAIN_VIEW_NAME, 'Taula Principal']);

export const isMainView = (view, tableViews = []) => {
    if (!view) return false;

    const safeTableViews = Array.isArray(tableViews) ? tableViews.filter(Boolean) : [];

    // No table context: degenerate case (single or virtual view)
    if (safeTableViews.length === 0) {
        return view.id === 'default' || view.is_main === true || view.is_default === true || LEGACY_MAIN_VIEW_NAMES.has(view.name);
    }

    const scopedViews = view.table_id
        ? safeTableViews.filter(v => (v?.table_id || null) === view.table_id)
        : safeTableViews;
    const candidateViews = scopedViews.length > 0 ? scopedViews : safeTableViews;

    // Prefer non-page-embed views for main view selection if available
    const nonEmbedCandidates = candidateViews.filter(v => !isPageEmbedView(v));
    const effectiveCandidates = nonEmbedCandidates.length > 0 ? nonEmbedCandidates : candidateViews;

    // Priority: explicit > canonical name > first by order. Always a single main view.
    const explicitMain = effectiveCandidates.find(v => v.id === 'default' || v.is_main === true || v.is_default === true);
    if (explicitMain) return explicitMain.id === view.id;

    const mainByName = effectiveCandidates.find(v => LEGACY_MAIN_VIEW_NAMES.has(v.name));
    if (mainByName) return mainByName.id === view.id;

    const ordered = [...effectiveCandidates].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
    return ordered[0]?.id === view.id;
};

export const getViewIcon = (typeId) => {
    const view = VIEW_TYPES.find(v => v.id === typeId);
    return view ? view.icon : Table;
};

// A view is hidden (not shown as a tab) if it has `hidden: true` or if it is a page embed view by default.
// The main view is NEVER hidden: at least one tab must always remain
// accessible, and is the table's anchor.
export const isViewHidden = (view, tableViews = []) => {
    if (isMainView(view, tableViews)) return false;
    if (typeof view?.hidden === 'boolean') return view.hidden;
    if (isPageEmbedView(view)) return true;
    return false;
};

// Contextual view of a page embed: it filters by host page context (`value: "this"`).
// If explicit `embedded: false` is set, it is a regular table tab.
// If it carries a `this` filter, it is a page embed view (hidden from table tabs by default).
export const isPageEmbedView = (view) => {
    if (!view) return false;
    if (view.embedded === false) return false;
    const filters = Array.isArray(view.filters) ? view.filters : [];
    if (filters.some(f => f && f.value === 'this')) return true;
    return false;
};
