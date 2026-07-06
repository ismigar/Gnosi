import {
    Table, Columns2, LayoutGrid, List,
    Calendar, CalendarRange, Newspaper, Share2, BarChart3
} from 'lucide-react';

export const VIEW_TYPES = [
    { id: 'table', label: 'Taula', icon: Table },
    { id: 'board', label: 'Kanban', icon: Columns2 },
    { id: 'gallery', label: 'Galeria', icon: LayoutGrid },
    { id: 'list', label: 'Llista', icon: List },
    { id: 'calendar', label: 'Calendari', icon: Calendar },
    { id: 'timeline', label: 'Timeline', icon: CalendarRange },
    { id: 'feed', label: 'Feed', icon: Newspaper },
    { id: 'chart', label: 'Gràfic', icon: BarChart3 },
    { id: 'graph', label: 'Graf', icon: Share2 },
];

export const MAIN_VIEW_NAME = 'Taula Principal';

export const isMainView = (view, tableViews = []) => {
    if (!view) return false;

    const safeTableViews = Array.isArray(tableViews) ? tableViews.filter(Boolean) : [];

    // Sense context de taula: cas degenerat (vista única o virtual)
    if (safeTableViews.length === 0) {
        return view.id === 'default' || view.is_main === true || view.is_default === true || view.name === MAIN_VIEW_NAME;
    }

    const scopedViews = view.table_id
        ? safeTableViews.filter(v => (v?.table_id || null) === view.table_id)
        : safeTableViews;
    const candidateViews = scopedViews.length > 0 ? scopedViews : safeTableViews;

    // Prioritat: explícit > nom canònic > primer per ordre. Sempre una sola vista principal.
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

// Una vista està amagada (no es mostra com a pestanya) si té `hidden: true`.
// La vista principal MAI s'amaga: sempre ha de quedar almenys una pestanya
// accessible, i és l'àncora de la taula.
export const isViewHidden = (view, tableViews = []) =>
    !!view?.hidden && !isMainView(view, tableViews);

// UUID versió 5 (determinista, `uuid5`) vs 4 (aleatori, `uuid4`): el 13è dígit
// hex del format canònic. Gnosi crea TOTES les vistes de taula amb `uuid4`
// (uuidv4 al frontend, uuid.uuid4() al backend); només l'import de Notion
// (notion_view_recreator / notion_clone, namespaces uuid5) en genera amb
// `uuid5`. Per tant, per a una vista sense flag, `uuid5` ⟹ prové de l'import.
const isUuidV5 = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-/i.test(String(id || ''));

// Vista contextual d'un embed de pàgina (creada per PageViewModal/DbViewEmbed
// o pel clonador de Notion): només té sentit renderitzada dins de la seva
// pàgina amfitriona, on el motor resol el filtre pel context del host. El
// tauler NO l'ha de mostrar com a pestanya de la taula (DbViewEmbed la
// segueix llegint del registry pel seu compte). Senyals, en ordre:
//   1) `embedded` booleà explícit → mana en els dos sentits (un duplicat fet
//      des del tauler el posa a `false` per quedar-se com a pestanya encara
//      que arrossegui el filtre "this"; els creadors d'embed el posen a `true`).
//   2) Fallback per a vistes preexistents SENSE flag:
//      a) el format històric del clonador — filtre {field, value:"this"} SENSE
//         operator (els filtres desats des de la UI sempre porten operator); o
//      b) `uuid5` — signatura de l'import de Notion. Cal perquè molts embeds
//         antics NO porten filtre "this" (quan la relació a la pàgina no es va
//         resoldre, el recreador la va mapejar a `Font contains <url Notion>` o
//         va quedar sense filtre): amb "this" sol, "Cervell digital" encara
//         mostrava ~118 pestanyes. La vista principal EFECTIVA (isMainView) mai
//         passa per aquí — el tauler la reserva abans de filtrar—, així que la
//         principal d'una taula importada (també uuid5) no desapareix.
export const isPageEmbedView = (view) => {
    if (!view) return false;
    if (typeof view.embedded === 'boolean') return view.embedded;
    const filters = Array.isArray(view.filters) ? view.filters : [];
    if (filters.some(f => f && f.value === 'this' && !f.operator)) return true;
    return isUuidV5(view.id);
};
