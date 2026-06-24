/**
 * registry.js — registre intern de "plugins" (features opcionals) de Gnosi.
 *
 * v1: registre declaratiu de features integrades que es poden activar/desactivar
 * per vault. NO executa codi de tercers (no-objectiu de v1 per seguretat). Cada
 * entrada descriu una feature i on s'aplica; els consumidors (sidebar, menú de
 * pàgina, slash) en comproven l'estat amb `isPluginEnabled(id)`.
 *
 * L'estat (quins estan desactivats) es persisteix a `.gnosi/plugins.json` via
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
];

export const PLUGIN_IDS = BUILTIN_PLUGINS.map((p) => p.id);
