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
        name: 'Notes diàries',
        description: 'Accés ràpid a la nota del dia i navegació per dates (estil Obsidian).',
        icon: 'CalendarDays',
    },
    {
        id: 'tags-page',
        name: 'Pàgina d\'etiquetes',
        description: 'Índex de totes les etiquetes del vault amb recompte i navegació.',
        icon: 'Hash',
    },
    {
        id: 'page-comments',
        name: 'Comentaris',
        description: 'Fil de comentaris per pàgina (estil Notion).',
        icon: 'MessageSquare',
    },
    {
        id: 'share-links',
        name: 'Compartir extern',
        description: 'Enllaços públics de només lectura per a pàgines.',
        icon: 'Share2',
    },
    {
        id: 'canvas-cards',
        name: 'Targetes al canvas',
        description: 'Incrusta pàgines com a targetes vives al llenç de dibuix.',
        icon: 'LayoutDashboard',
    },
    {
        id: 'llm-wiki',
        name: 'Cervell (LLM Wiki)',
        description: 'Processa recursos amb IA per mantenir un wiki de coneixement enllaçat (estil Karpathy).',
        icon: 'BrainCircuit',
    },
];

export const PLUGIN_IDS = BUILTIN_PLUGINS.map((p) => p.id);
