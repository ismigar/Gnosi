import { 
    Table, Columns2, LayoutGrid, List, 
    Calendar, CalendarRange, Newspaper 
} from 'lucide-react';

export const VIEW_TYPE_IDS = {
    TABLE: 'table',
    BOARD: 'board',
    GALLERY: 'gallery',
    LIST: 'list',
    CALENDAR: 'calendar',
    TIMELINE: 'timeline',
    FEED: 'feed'
};

export const VIEW_TYPES = [
    { id: VIEW_TYPE_IDS.TABLE, label: 'Taula', icon: Table },
    { id: VIEW_TYPE_IDS.BOARD, label: 'Kanban', icon: Columns2 },
    { id: VIEW_TYPE_IDS.GALLERY, label: 'Galeria', icon: LayoutGrid },
    { id: VIEW_TYPE_IDS.LIST, label: 'Llista', icon: List },
    { id: VIEW_TYPE_IDS.CALENDAR, label: 'Calendari', icon: Calendar },
    { id: VIEW_TYPE_IDS.TIMELINE, label: 'Timeline', icon: CalendarRange },
    { id: VIEW_TYPE_IDS.FEED, label: 'Feed', icon: Newspaper },
];

export const getViewIcon = (typeId) => {
    const view = VIEW_TYPES.find(v => v.id === typeId);
    return view ? view.icon : Table;
};
