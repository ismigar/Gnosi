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

    // Priority: explicit > canonical name > first by order. Always a single main view.
    const explicitMain = candidateViews.find(v => v.id === 'default' || v.is_main === true || v.is_default === true);
    if (explicitMain) return explicitMain.id === view.id;

    const mainByName = candidateViews.find(v => LEGACY_MAIN_VIEW_NAMES.has(v.name));
    if (mainByName) return mainByName.id === view.id;

    const ordered = [...candidateViews].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
    return ordered[0]?.id === view.id;
};

export const getViewIcon = (typeId) => {
    const view = VIEW_TYPES.find(v => v.id === typeId);
    return view ? view.icon : Table;
};

// A view is hidden (not shown as a tab) if it has `hidden: true`.
// The main view is NEVER hidden: at least one tab must always remain
// accessible, and is the table's anchor.
export const isViewHidden = (view, tableViews = []) =>
    !!view?.hidden && !isMainView(view, tableViews);

// UUID version 5 (deterministic, `uuid5`) vs 4 (random, `uuid4`): the 13th digit
// hex of the canonical format. Gnosi creates ALL table views with `uuid4`
// (uuidv4 on the frontend, uuid.uuid4() on the backend); only the Notion import
// (notion_view_recreator / notion_clone, uuid5 namespaces) generates them with
// `uuid5`. So, for a view without the flag, `uuid5` ⟹ it comes from the import.
const isUuidV5 = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-/i.test(String(id || ''));

// Contextual view of a page embed (created by PageViewModal/DbViewEmbed
// or by the Notion cloner): it only makes sense rendered within its
// host page, where the engine resolves the filter by the host's context. The
// dashboard must NOT show it as a table tab (DbViewEmbed
// keeps reading from the registry on its own). Signals, in order:
//   1) explicit `embedded` boolean → wins in both directions (a duplicate made
//      from the dashboard sets it to `false` to remain as a tab even
//      to carry the "this" filter along; embed creators set it to `true`).
//   2) Fallback for pre-existing views WITHOUT the flag:
//      a) the cloner's historic format — filter {field, value:"this"} WITHOUT
//         operator (filters saved from the UI always carry an operator); or
//      b) `uuid5` — signature of the Notion import. Needed because many embeds
//         old ones do NOT carry a "this" filter (when the relation to the page wasn't
//         resolve, the recreator mapped it to `Font contains <url Notion>` or
//         ended up without a filter): with "this" alone, "Cervell digital" still
//         showed ~118 tabs. The EFFECTIVE main view (isMainView) never
//         made through here — the dashboard reserves it before filtering—, so the
//         main view of an imported table (also uuid5) doesn't disappear.
export const isPageEmbedView = (view) => {
    if (!view) return false;
    if (typeof view.embedded === 'boolean') return view.embedded;
    const filters = Array.isArray(view.filters) ? view.filters : [];
    if (filters.some(f => f && f.value === 'this' && !f.operator)) return true;
    return isUuidV5(view.id);
};
