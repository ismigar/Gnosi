/**
 * registry.js — Gnosi's internal registry of "plugins" (optional features).
 *
 * v1: declarative registry of built-in features that can be enabled/disabled
 * per vault. Does NOT run third-party code (a non-goal of v1 for security). Each
 * entry describes a feature and where it applies; consumers (sidebar, page
 * menu, slash) check its state with `isPluginEnabled(id)`.
 *
 * The state (which ones are disabled) is persisted in `.gnosi/plugins.json` via
 * `GET/PUT /api/vault/plugins`.
 */

export const BUILTIN_PLUGINS = [
    {
        id: 'daily-notes',
        name: 'Daily notes',
        description: 'Quick access to the daily note and date navigation, in the style of Obsidian.',
        icon: 'CalendarDays',
    },
    {
        id: 'tags-page',
        name: 'Tags page',
        description: 'Index of every vault tag with counts and navigation.',
        icon: 'Hash',
    },
    {
        id: 'page-comments',
        name: 'Comments',
        description: 'Per-page comment thread, in the style of Notion.',
        icon: 'MessageSquare',
    },
    {
        id: 'share-links',
        name: 'External sharing',
        description: 'Public read-only links for pages.',
        icon: 'Share2',
    },
    {
        id: 'canvas-cards',
        name: 'Canvas cards',
        description: 'Embed pages as live cards on the drawing canvas.',
        icon: 'LayoutDashboard',
    },
    {
        id: 'web-clipper',
        name: 'Web Clipper',
        description: 'Save web pages from the browser to a table of your choice and populate its fields.',
        icon: 'Scissors',
    },
    {
        id: 'llm-wiki',
        name: 'Brain (LLM Wiki)',
        description: 'Process resources with AI to maintain a linked knowledge wiki, in the style of Karpathy.',
        icon: 'BrainCircuit',
    },
    {
        id: 'project-planning',
        name: 'Project planning',
        description: 'Add working durations, predecessors, and work calendars to period fields.',
        icon: 'CalendarRange',
    },
];

export const PLUGIN_IDS = BUILTIN_PLUGINS.map((p) => p.id);
