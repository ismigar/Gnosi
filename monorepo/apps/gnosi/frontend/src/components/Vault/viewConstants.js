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

export const getViewIcon = (typeId) => {
    const view = VIEW_TYPES.find(v => v.id === typeId);
    return view ? view.icon : Table;
};
