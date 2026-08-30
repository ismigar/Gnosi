import {
    BookOpen,
    Calendar,
    CalendarRange,
    FileText,
    Image as ImageIcon,
    Inbox,
    LibraryBig,
    Network,
    NotebookTabs,
    Share2,
    Users,
    type LucideIcon,
} from 'lucide-react';


export interface SidebarNavItem {
    readonly icon: LucideIcon;
    readonly labelKey: string;
    readonly pluginId?: string;
    readonly shortcut: string;
    readonly to: string;
}


export const ENGINEERING_DOCUMENTATION_URL = 'https://gnosi.temenosismael.org/engineering/';


export const APP_SIDEBAR_ITEMS: readonly SidebarNavItem[] = [
    { to: '/vault', icon: FileText, labelKey: 'sidebar.nav_vault', shortcut: 'Ctrl 1' },
    { to: '/graph', icon: Network, labelKey: 'sidebar.nav_graph', shortcut: 'Ctrl 2' },
    { to: '/contacts', icon: Users, labelKey: 'sidebar.nav_contacts', shortcut: 'Ctrl 3', pluginId: 'contacts' },
    { to: '/mail', icon: Inbox, labelKey: 'sidebar.nav_mail', shortcut: 'Ctrl 4', pluginId: 'mail' },
    { to: '/calendar', icon: Calendar, labelKey: 'sidebar.nav_calendar', shortcut: 'Ctrl 5', pluginId: 'calendar' },
    { to: '/reader', icon: BookOpen, labelKey: 'sidebar.nav_reader', shortcut: 'Ctrl 6', pluginId: 'feeds-reader' },
    { to: '/notebooks', icon: NotebookTabs, labelKey: 'sidebar.nav_notebooks', shortcut: '', pluginId: 'grounded-notebooks' },
    { to: '/literature', icon: LibraryBig, labelKey: 'sidebar.nav_literature', shortcut: '', pluginId: 'resources' },
    { to: '/social-dashboard', icon: Share2, labelKey: 'sidebar.nav_social', shortcut: 'Ctrl 7', pluginId: 'social-publishing' },
    { to: '/media', icon: ImageIcon, labelKey: 'sidebar.nav_media', shortcut: 'Ctrl 8', pluginId: 'social-publishing' },
    { to: '/planning', icon: CalendarRange, labelKey: 'sidebar.nav_planning', shortcut: '', pluginId: 'project-planning' },
];
