import { 
    Table, Columns2, LayoutGrid, List, 
    Calendar, CalendarRange, Newspaper, Share2
} from 'lucide-react';

export const VIEW_TYPES = [
    { id: 'table', label: 'Taula', icon: Table },
    { id: 'board', label: 'Kanban', icon: Columns2 },
    { id: 'gallery', label: 'Galeria', icon: LayoutGrid },
    { id: 'list', label: 'Llista', icon: List },
    { id: 'calendar', label: 'Calendari', icon: Calendar },
    { id: 'timeline', label: 'Timeline', icon: CalendarRange },
    { id: 'feed', label: 'Feed', icon: Newspaper },
    { id: 'graph', label: 'Graf', icon: Share2 },
];

export const MAIN_VIEW_NAME = 'Taula Principal';

export const isMainView = (view, tableViews = []) => {
    if (!view) return false;

    if (view.id === 'default' || view.is_main === true || view.is_default === true) {
        return true;
    }

    if (view.name === MAIN_VIEW_NAME) {
        return true;
    }

    const safeTableViews = Array.isArray(tableViews) ? tableViews.filter(Boolean) : [];
    if (safeTableViews.length === 0) return false;

    const scopedViews = view.table_id
        ? safeTableViews.filter(v => (v?.table_id || null) === view.table_id)
        : safeTableViews;
    const candidateViews = scopedViews.length > 0 ? scopedViews : safeTableViews;

    const explicitMain = candidateViews.find(v => v.id === 'default' || v.is_main === true || v.is_default === true);
    if (explicitMain) return explicitMain.id === view.id;

    const mainByName = candidateViews.find(v => v.name === MAIN_VIEW_NAME);
    if (mainByName) return mainByName.id === view.id;

    const ordered = [...candidateViews].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
    return ordered[0]?.id === view.id;
};

export const getViewIcon = (typeId) => {
    const view = VIEW_TYPES.find(v => v.id === typeId);
    return view ? view.icon : Table;
};
