/**
 * Declarative fallback for Gnosi's optional built-in capabilities.
 *
 * The backend returns the authoritative registry with the per-vault state.
 * This copy provides labels and shell metadata before that request completes;
 * parity is covered by backend and frontend registry tests.
 */

export interface BuiltinPluginDefinition {
    readonly description: string;
    readonly group: string;
    readonly icon: string;
    readonly id: string;
    readonly name: string;
    readonly requires: readonly string[];
    readonly routes: readonly string[];
    readonly settingsTab?: string;
}

export const BUILTIN_PLUGINS: readonly BuiltinPluginDefinition[] = [
    { id: 'daily-notes', name: 'Daily notes', description: 'Quick access to daily notes and date navigation.', icon: 'CalendarDays', group: 'knowledge', settingsTab: 'daily-notes', requires: [], routes: [] },
    { id: 'tags-page', name: 'Tags page', description: 'Index of every vault tag with counts and navigation.', icon: 'Hash', group: 'vault', requires: [], routes: [] },
    { id: 'page-comments', name: 'Comments', description: 'Per-page comment threads.', icon: 'MessageSquare', group: 'vault', requires: [], routes: [] },
    { id: 'share-links', name: 'External sharing', description: 'Public read-only links for pages.', icon: 'Share2', group: 'vault', requires: [], routes: [] },
    { id: 'canvas-cards', name: 'Canvas cards', description: 'Embed pages as live cards on the drawing canvas.', icon: 'LayoutDashboard', group: 'vault', requires: [], routes: [] },
    { id: 'web-clipper', name: 'Web Clipper', description: 'Save web pages from the browser into the Vault.', icon: 'Scissors', group: 'connections', settingsTab: 'web-clipper', requires: [], routes: [] },
    { id: 'project-planning', name: 'Project planning', description: 'Durations, predecessors, work calendars and resource planning.', icon: 'CalendarRange', group: 'knowledge', settingsTab: 'project-planning', requires: [], routes: ['/planning'] },
    { id: 'resources', name: 'References', description: 'Academic sources, federated literature search, imports and reviews.', icon: 'BookOpen', group: 'knowledge', settingsTab: 'resources', requires: [], routes: ['/literature'] },
    { id: 'feeds-reader', name: 'Feeds and newsletters', description: 'RSS subscriptions, newsletters and optional daily podcasts.', icon: 'BookOpen', group: 'connections', settingsTab: 'reader', requires: [], routes: ['/reader'] },
    { id: 'translation', name: 'Translation', description: 'Translation providers and publishing-language actions.', icon: 'Languages', group: 'knowledge', settingsTab: 'translate', requires: [], routes: [] },
    { id: 'contacts', name: 'Contacts', description: 'External address books and the Contacts application.', icon: 'Users', group: 'connections', settingsTab: 'contacts', requires: [], routes: ['/contacts'] },
    { id: 'mail', name: 'Mail', description: 'Mail accounts, synchronization and the Mail application.', icon: 'Inbox', group: 'connections', settingsTab: 'mail', requires: [], routes: ['/mail'] },
    { id: 'calendar', name: 'Calendar', description: 'External calendars, reminders and meeting surfaces.', icon: 'Calendar', group: 'connections', settingsTab: 'calendar', requires: [], routes: ['/calendar'] },
    { id: 'social-publishing', name: 'Social publishing and media', description: 'Social dashboard, composer and media center.', icon: 'Share2', group: 'connections', settingsTab: 'social', requires: [], routes: ['/social-dashboard', '/composer', '/media'] },
    { id: 'notion-import', name: 'Notion import', description: 'Import Notion workspaces into portable Vault data.', icon: 'Database', group: 'connections', settingsTab: 'notion', requires: [], routes: [] },
    { id: 'ai-platform', name: 'AI and agents', description: 'Providers, models, agents, skills and governed tools.', icon: 'Cpu', group: 'knowledge', settingsTab: 'ai', requires: [], routes: [] },
    { id: 'llm-wiki', name: 'Brain (LLM Wiki)', description: 'Maintain a linked knowledge wiki with AI.', icon: 'BrainCircuit', group: 'knowledge', settingsTab: 'llm-wiki', requires: ['ai-platform'], routes: [] },
    { id: 'grounded-notebooks', name: 'Grounded notebooks', description: 'Ask grounded questions over selected reference sources.', icon: 'NotebookTabs', group: 'knowledge', requires: ['ai-platform'], routes: ['/notebooks'] },
    { id: 'automations', name: 'Automations', description: 'User automations, schedules and execution history.', icon: 'Clock3', group: 'advanced', settingsTab: 'automations', requires: [], routes: ['/scheduler'] },
];

export const PLUGIN_IDS = BUILTIN_PLUGINS.map((plugin) => plugin.id);
export const BUILTIN_PLUGIN_BY_ID: Readonly<Record<string, BuiltinPluginDefinition>> = Object.fromEntries(
    BUILTIN_PLUGINS.map((plugin) => [plugin.id, plugin]),
);

export const ROUTE_PLUGIN_IDS: Readonly<Record<string, string>> = Object.fromEntries(
    BUILTIN_PLUGINS.flatMap((plugin) => plugin.routes.map((route) => [route, plugin.id])),
);

export function pluginForPath(pathname: string): string | null {
    const canonicalApp = pathname.match(/^\/@[^/]+\/([^/]+)/)?.[1];
    const canonicalPlugins: Readonly<Record<string, string>> = {
        planning: 'project-planning',
        resources: 'resources',
        reader: 'feeds-reader',
        contacts: 'contacts',
        mail: 'mail',
        calendar: 'calendar',
        social: 'social-publishing',
        media: 'social-publishing',
        notebooks: 'grounded-notebooks',
        automations: 'automations',
    };
    if (canonicalApp) {
        const canonicalPlugin = canonicalPlugins[canonicalApp];
        if (canonicalPlugin) return canonicalPlugin;
    }
    const exact = ROUTE_PLUGIN_IDS[pathname];
    if (exact) return exact;
    if (pathname.startsWith('/notebooks/')) return 'grounded-notebooks';
    return null;
}
