import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Eye, Filter, ArrowUpDown, SlidersHorizontal, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { VIEW_TYPES } from './viewConstants';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

/**
 * Modal per afegir una vista de BD a una pàgina (slash command /vista).
 *
 * Suporta filtres múltiples, ordenació i selector de propietats per checkbox.
 * Opcionalment, desa la vista al registry de la taula (registry.views[]) per
 * reaprofitar-la des de la pàgina pròpia de la taula.
 *
 * Backend: POST /api/vault/views (vista guardada) + POST /api/pages/{id}/views
 * (embed amb view_id).
 */
const FILTER_OPERATORS = [
    { value: 'equals', label: 'igual' },
    { value: 'not_equals', label: 'diferent' },
    { value: 'contains', label: 'conté' },
    { value: 'not_contains', label: 'no conté' },
    { value: 'is_empty', label: 'és buit' },
    { value: 'is_not_empty', label: 'no és buit' },
    { value: 'greater_than', label: 'major que' },
    { value: 'less_than', label: 'menor que' },
];

// --- Opcions de configuració específiques per tipus de vista ---
// La GALERIA accepta una mida de targeta i un mode de previsualització; el
// KANBAN un camp d'agrupació; CALENDARI/TIMELINE un (o dos) camps de data.
// Els valors viuen a la vista (registry, dict lliure) i el render els honora.
const CARD_SIZES = [
    { value: 'small', label: 'Petita' },
    { value: 'medium', label: 'Mitjana' },
    { value: 'large', label: 'Gran' },
];
const GALLERY_PREVIEWS = [
    { value: 'cover', label: 'Portada', hint: 'Imatge de portada de la pàgina i propietats.' },
    { value: 'content', label: 'Contingut', hint: 'Un fragment del text de la pàgina i propietats.' },
    { value: 'properties', label: 'Només propietats', hint: 'Sense imatge; títol i propietats.' },
    { value: 'none', label: 'Només títol', hint: 'Targeta mínima: portada i títol, sense propietats.' },
];
// Tipus d'esquema vàlids per a cada control: agrupació de Kanban (camps amb un
// conjunt acotat de valors) i eix temporal de calendari/timeline.
const GROUP_FIELD_TYPES = new Set(['select', 'status', 'multi_select']);
const DATE_FIELD_TYPES = new Set(['date', 'datetime', 'period']);
const NUMERIC_FIELD_TYPES = new Set(['number', 'formula', 'rollup', 'currency', 'percent']);

const TABS = [
    { id: 'properties', icon: Eye, label: 'Camps' },
    { id: 'filters', icon: Filter, label: 'Filtres' },
    { id: 'sort', icon: ArrowUpDown, label: 'Ordenació' },
    { id: 'general', icon: SlidersHorizontal, label: 'General' },
];

/**
 * Selector cercable per al valor d'un filtre de RELACIÓ. En lloc d'un text
 * lliure (propens a errades com "thiis"), ofereix un desplegable amb:
 *  - "Aquesta pàgina" (valor especial `this` = id de la pàgina on s'incrusta),
 *  - els títols dels registres de la taula relacionada (valor = id),
 *  amb un cercador per filtrar i navegació amb teclat (↑↓/Enter/Esc).
 */
function RelationValuePicker({ value, onChange, options, loading, thisLabel, placeholder }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [highlighted, setHighlighted] = useState(0);
    // Posició fixa del panell: el desplegable es renderitza en un PORTAL a
    // <body> per no quedar tallat pel `overflow-y-auto` del cos del modal
    // (abans només es veia el cercador i la llista quedava amagada).
    const [rect, setRect] = useState(null);
    const boxRef = useRef(null);
    const panelRef = useRef(null);

    const allOptions = useMemo(
        () => [{ value: 'this', label: thisLabel }, ...(options || [])],
        [options, thisLabel],
    );
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return allOptions;
        return allOptions.filter(o => String(o.label || '').toLowerCase().includes(q));
    }, [allOptions, query]);

    const current = allOptions.find(o => o.value === value);
    const display = current ? current.label : (value || '');

    const openPanel = () => {
        const r = boxRef.current?.getBoundingClientRect();
        if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width });
        setQuery('');
        setHighlighted(0);
        setOpen(true);
    };

    useEffect(() => {
        if (!open) return undefined;
        const onDoc = (e) => {
            if (boxRef.current?.contains(e.target)) return;
            if (panelRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        // El panell té posició fixa calculada en obrir; si l'usuari fa scroll
        // (p. ex. dins el modal) o redimensiona, el tanquem per no desalinear.
        const onMove = () => setOpen(false);
        document.addEventListener('mousedown', onDoc);
        window.addEventListener('resize', onMove);
        window.addEventListener('scroll', onMove, true);
        return () => {
            document.removeEventListener('mousedown', onDoc);
            window.removeEventListener('resize', onMove);
            window.removeEventListener('scroll', onMove, true);
        };
    }, [open]);

    const pick = (opt) => { onChange(opt.value); setOpen(false); setQuery(''); };

    return (
        <div ref={boxRef} className="relative w-40">
            <button
                type="button"
                onClick={() => (open ? setOpen(false) : openPanel())}
                className="w-full text-left truncate text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] hover:border-[var(--gnosi-primary)]"
                title={display}
            >
                {display || <span className="text-[var(--text-tertiary)]">{placeholder || t('view.filter_pick', 'Tria…')}</span>}
            </button>
            {open && rect && createPortal(
                <div
                    ref={panelRef}
                    style={{ position: 'fixed', top: rect.top, left: rect.left, width: Math.max(rect.width, 220), zIndex: 300 }}
                    className="max-h-60 overflow-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl"
                >
                    <input
                        autoFocus
                        value={query}
                        onChange={e => { setQuery(e.target.value); setHighlighted(0); }}
                        onKeyDown={e => {
                            if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
                            else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
                            else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlighted]) pick(filtered[highlighted]); }
                            else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
                        }}
                        placeholder={t('view.search_placeholder', 'Cerca…')}
                        className="w-full text-xs border-b border-[var(--border-primary)] px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] sticky top-0"
                    />
                    {loading && <div className="px-2 py-1.5 text-xs text-[var(--text-tertiary)] italic">{t('common.loading', 'Carregant…')}</div>}
                    {!loading && filtered.map((o, i) => (
                        <div
                            key={o.value}
                            onMouseEnter={() => setHighlighted(i)}
                            onMouseDown={e => { e.preventDefault(); pick(o); }}
                            className={`px-2 py-1.5 text-xs cursor-pointer truncate ${i === highlighted ? 'bg-[var(--gnosi-primary)]/15 text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'} ${o.value === value ? 'font-semibold' : ''}`}
                            title={o.label}
                        >
                            {o.value === 'this' ? `📍 ${o.label}` : o.label}
                        </div>
                    ))}
                    {!loading && filtered.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-[var(--text-tertiary)] italic">{t('view.no_results', 'Cap resultat')}</div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}

export function PageViewModal({ isOpen, onClose, pageId, allTables = [], apiFetch, preselectedTableId = '', editingBlock = null, mode = 'embed', editingView = null, initialTab = null }) {
    const { t } = useTranslation();

    // `mode='table'`: el MATEIX modal però configurant una vista de la taula
    // (no un embed). S'amaguen les opcions pròpies de l'embed (taula origen ja
    // fixada, vista existent, abast compartit/local, "desa a les vistes",
    // encapçalament) i en desar s'actualitza/crea la vista del registry
    // directament (sense secció ni bloc). `editingView` = vista a configurar
    // (null = crear-ne una de nova).
    const isTableMode = mode === 'table';

    // Ref al panell interior del modal: delimita el focus-trap del teclat.
    const panelRef = useRef(null);

    const [activeTab, setActiveTab] = useState('general');
    const [heading, setHeading] = useState('');
    const [headingLevel, setHeadingLevel] = useState(1);
    const [sourceTableId, setSourceTableId] = useState(preselectedTableId);
    const [viewName, setViewName] = useState('');
    const [visibleProperties, setVisibleProperties] = useState([]);
    const [viewType, setViewType] = useState('table');
    const [filters, setFilters] = useState([]);
    // Llista ordenada de criteris d'ordenació; el primer element té prioritat
    // màxima (ex: ordena per `Estat` asc; en empat, per `Data` desc).
    const [sorts, setSorts] = useState([]);
    // Snapshot de wikilinks de resultats al markdown (portabilitat). Viu a la
    // vista del registry (resultSnapshot / resultSnapshotLimit); el backend
    // l'honora en desar la pàgina. Default: activat, 500 (0 = sense límit).
    const [resultSnapshot, setResultSnapshot] = useState(true);
    const [resultSnapshotLimit, setResultSnapshotLimit] = useState(500);
    // Opcions específiques per tipus de vista (galeria/kanban/calendari/timeline).
    // Es desen a la vista i el render les honora; les vistes que no són del
    // tipus corresponent simplement les ignoren.
    const [cardSize, setCardSize] = useState('medium');
    const [galleryPreview, setGalleryPreview] = useState('cover');
    const [coverField, setCoverField] = useState('');
    const [imageFit, setImageFit] = useState('contain');
    const [groupBy, setGroupBy] = useState('');
    const [dateField, setDateField] = useState('');
    const [endDateField, setEndDateField] = useState('');
    const [calendarView, setCalendarView] = useState('dayGridMonth');
    const [colorField, setColorField] = useState('');
    const [rowHeight, setRowHeight] = useState('normal');
    // Opcions de la vista de gràfic (chart).
    const [chartType, setChartType] = useState('bar');
    const [xField, setXField] = useState('');
    const [yField, setYField] = useState('');
    const [aggregation, setAggregation] = useState('count');
    const [saveToTableViews, setSaveToTableViews] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    // Vistes guardades a la taula seleccionada — l'usuari pot triar-ne una en
    // lloc d'haver de configurar-ho tot des de zero.
    const [existingViews, setExistingViews] = useState([]);
    const [selectedExistingViewId, setSelectedExistingViewId] = useState('');
    const [loadingExistingViews, setLoadingExistingViews] = useState(false);
    // Quantes pàgines comparteixen la vista existent seleccionada — si > 1
    // (incloent aquesta), avisem l'usuari abans de propagar canvis.
    const [viewUsage, setViewUsage] = useState({ count: 0, pages: [] });
    // Què fer si l'usuari modifica una vista compartida:
    //   'shared' = aplicar canvis a totes les pàgines que la usen (default)
    //   'fork'   = només aquesta pàgina; la secció s'embeveix sense view_id i
    //              porta una còpia inline dels filtres/sorts/properties.
    const [editScope, setEditScope] = useState('shared');
    const [modalPinnedViewIds, setModalPinnedViewIds] = useState(new Set());

    const selectedTable = useMemo(
        () => allTables.find(tbl => tbl.id === sourceTableId),
        [allTables, sourceTableId]
    );

    const tableFields = useMemo(() => {
        // Una columna de títol de l'esquema (la propietat de tipus `title`
        // d'una taula importada de Notion, p. ex. "Nom"/"Título", o un camp
        // literalment anomenat title/títol/titulo/titre) ÉS el títol de la
        // pàgina. El sistema ja l'exposa com a camp canònic `title`, que el
        // render llegeix de `r.title`. La detecció anterior, basada només en
        // noms sense accent, no reconeixia `Título` (amb í) ni les columnes
        // de tipus `title` amb un altre nom (`Nom`), i acabava mostrant DUES
        // columnes de títol; a més, la columna amb nom propi ni tan sols es
        // renderitzava (el seu valor no és a `metadata`, sinó a `title`).
        // Per això excloem totes les columnes de títol de l'esquema i deixem
        // un únic `title` canònic.
        const isTitleField = (p) => {
            if (String(p.type || '').trim().toLowerCase() === 'title') return true;
            const n = String(p.name || '').trim().toLowerCase();
            return n === 'title' || n === 'títol' || n === 'titulo' || n === 'título' || n === 'titre';
        };
        const props = (selectedTable?.properties || [])
            .filter(p => !isTitleField(p))
            .map(p => ({ name: p.name, type: p.type, relation_database_id: p.relation_database_id }));
        props.unshift({ name: 'title', type: 'title' });
        return props;
    }, [selectedTable]);

    const fieldMeta = useMemo(() => {
        const m = {};
        tableFields.forEach(f => { m[f.name] = f; });
        return m;
    }, [tableFields]);

    // Cau de registres de taules relacionades per als desplegables de filtre
    // de relació: { [tableId]: [{ value: id, label: títol }] }. `undefined` =
    // encara no carregat (mostrem "Carregant…").
    const [relationCache, setRelationCache] = useState({});
    useEffect(() => {
        if (!isOpen) return;
        const targets = new Set();
        filters.forEach(f => {
            const meta = fieldMeta[f.field];
            if (meta?.type === 'relation' && meta.relation_database_id) targets.add(meta.relation_database_id);
        });
        targets.forEach(async (tid) => {
            if (relationCache[tid] !== undefined) return;
            try {
                const rows = await apiFetch(`/api/vault/pages/by-table/${encodeURIComponent(tid)}`);
                const opts = (Array.isArray(rows) ? rows : [])
                    .filter(r => !r.metadata?.is_template)
                    .map(r => ({ value: r.id, label: r.title || t('view.untitled', '(sense títol)') }))
                    .sort((a, b) => a.label.localeCompare(b.label));
                setRelationCache(prev => ({ ...prev, [tid]: opts }));
            } catch {
                setRelationCache(prev => ({ ...prev, [tid]: [] }));
            }
        });
    }, [isOpen, filters, fieldMeta, apiFetch, relationCache, t]);

    // Llegeix les opcions per-tipus d'una vista (registry o secció inline) als
    // estats del modal, tolerant les dues convencions de nom (camelCase del
    // registry i snake_case de la secció embeguda).
    const applyTypeOptions = (v) => {
        setCardSize(v?.cardSize || 'medium');
        setGalleryPreview(v?.galleryPreview || 'cover');
        setCoverField(v?.coverField || v?.cover_field || '');
        setImageFit(v?.imageFit || v?.image_fit || 'contain');
        setGroupBy(v?.groupBy || v?.group_by || '');
        setDateField(v?.dateField || v?.date_field || '');
        setEndDateField(v?.endDateField || v?.end_date_field || '');
        setCalendarView(v?.calendarView || v?.calendar_view || 'dayGridMonth');
        setColorField(v?.colorField || v?.color_field || '');
        setRowHeight(v?.rowHeight || v?.row_height || 'normal');
        setChartType(v?.chartType || v?.chart_type || 'bar');
        setXField(v?.xField || v?.x_field || '');
        setYField(v?.yField || v?.y_field || '');
        setAggregation(v?.aggregation || (v?.yField || v?.y_field ? 'sum' : 'count'));
    };
    const resetTypeOptions = () => {
        setCardSize('medium');
        setGalleryPreview('cover');
        setCoverField('');
        setImageFit('contain');
        setGroupBy('');
        setDateField('');
        setEndDateField('');
        setCalendarView('dayGridMonth');
        setColorField('');
        setRowHeight('normal');
        setChartType('bar');
        setXField('');
        setYField('');
        setAggregation('count');
    };

    useEffect(() => {
        if (!isOpen) return;
        // Mode TAULA: configurem una vista del registry directament (no un
        // embed). Pre-omplim des de `editingView` (o defaults si en creem una).
        if (isTableMode) {
            // 'appearance' del modal antic = pestanya 'general' aquí.
            setActiveTab(initialTab && initialTab !== 'appearance' ? initialTab : 'general');
            setError('');
            setSaveToTableViews(false);
            setEditScope('shared');
            setViewUsage({ count: 0, pages: [] });
            setSelectedExistingViewId('');
            setSourceTableId(String(editingView?.table_id || preselectedTableId || ''));
            if (editingView) {
                setViewType(String(editingView.type || 'table'));
                setViewName(String(editingView.name || ''));
                setVisibleProperties(
                    Array.isArray(editingView.visibleProperties) && editingView.visibleProperties.length
                        ? editingView.visibleProperties
                        : ['title']
                );
                setFilters(Array.isArray(editingView.filters) ? editingView.filters : []);
                if (Array.isArray(editingView.sorts) && editingView.sorts.length) {
                    setSorts(editingView.sorts);
                } else if (editingView.sort && editingView.sort.field) {
                    setSorts([{ field: editingView.sort.field, direction: editingView.sort.direction || 'asc' }]);
                } else {
                    setSorts([]);
                }
                setResultSnapshot(editingView.resultSnapshot !== false);
                setResultSnapshotLimit(
                    Number.isFinite(Number(editingView.resultSnapshotLimit)) ? Number(editingView.resultSnapshotLimit) : 500
                );
                applyTypeOptions(editingView);
            } else {
                setViewType('table');
                setViewName('');
                setVisibleProperties(['title']);
                setFilters([]);
                setSorts([]);
                setResultSnapshot(true);
                setResultSnapshotLimit(500);
                resetTypeOptions();
            }
            return;
        }
        // Mode EDITA: pre-omplim a partir dels props del block existent.
        // Si la secció té view_id, el carregarem al useEffect d'existing
        // views (selecció automàtica). Si no, parsegem `section` (config
        // inline) per omplir filters/sorts/visible_properties.
        if (editingBlock) {
            const p = editingBlock.props || {};
            setActiveTab('general');
            setHeading(String(p.heading || ''));
            setHeadingLevel(Number(p.heading_level) || 1);
            setError('');

            const vid = String(p.view_id || '');
            // Carreguem les vistes fixades del localStorage
            try {
                const saved = JSON.parse(localStorage.getItem(`gnosi_embed_pinned_${pageId}_${vid || 'default'}`) || '[]');
                setModalPinnedViewIds(new Set(saved));
            } catch {
                setModalPinnedViewIds(new Set());
            }

            // Inline fallback (vista local desconnectada)
            let inline = null;
            if (!vid && p.section) {
                try { inline = JSON.parse(p.section); } catch { /* malformat */ }
            }
            setViewName('');
            setSaveToTableViews(false);
            setViewUsage({ count: 0, pages: [] });
            setEditScope('shared');

            if (vid) {
                // Pre-càrrega via fetch directe perquè els useEffect en cadena
                // (sourceTableId → existingViews → selectedExistingViewId) no
                // arribin a buidar la selecció abans d'haver llegit la vista.
                let cancelled = false;
                apiFetch(`/api/vault/views/${encodeURIComponent(vid)}`)
                    .then(v => {
                        if (cancelled || !v) return;
                        setSourceTableId(String(v.table_id || ''));
                        setViewType(String(v.type || 'table'));
                        setVisibleProperties(Array.isArray(v.visibleProperties) && v.visibleProperties.length ? v.visibleProperties : ['title']);
                        setFilters(Array.isArray(v.filters) ? v.filters : []);
                        setResultSnapshot(v.resultSnapshot !== false);
                        setResultSnapshotLimit(Number.isFinite(Number(v.resultSnapshotLimit)) ? Number(v.resultSnapshotLimit) : 500);
                        applyTypeOptions(v);
                        if (Array.isArray(v.sorts) && v.sorts.length > 0) {
                            setSorts(v.sorts);
                        } else if (v.sort && v.sort.field) {
                            setSorts([{ field: v.sort.field, direction: v.sort.direction || 'asc' }]);
                        } else {
                            setSorts([]);
                        }
                        // Posem la vista directament a la llista existent
                        // perquè el desplegable la mostri seleccionada.
                        setExistingViews(prev => {
                            if (prev.some(x => x.id === v.id)) return prev;
                            return [v, ...prev];
                        });
                        setSelectedExistingViewId(vid);
                    })
                    .catch(() => {
                        // Si fallem, deixem la modal en mode crear nova.
                        if (!cancelled) {
                            setSourceTableId(preselectedTableId || '');
                            setSelectedExistingViewId('');
                        }
                    });
                return () => { cancelled = true; };
            }

            // Vista local (inline). Pre-omplim a partir del JSON serialitzat.
            setSelectedExistingViewId('');
            setSourceTableId(inline?.source_table_id || preselectedTableId || '');
            setViewType(inline?.type || 'table');
            setFilters(Array.isArray(inline?.filters) ? inline.filters : []);
            setSorts(Array.isArray(inline?.sorts) ? inline.sorts : []);
            setVisibleProperties(Array.isArray(inline?.visibleProperties) && inline.visibleProperties.length ? inline.visibleProperties : ['title']);
            setResultSnapshot(inline?.resultSnapshot !== false);
            setResultSnapshotLimit(Number.isFinite(Number(inline?.resultSnapshotLimit)) ? Number(inline.resultSnapshotLimit) : 500);
            applyTypeOptions(inline);
            setExistingViews([]);
            return;
        }
        // Mode CREA: tot net.
        setActiveTab('general');
        setHeading('');
        setHeadingLevel(1);
        setSourceTableId(preselectedTableId || '');
        setViewName('');
        setVisibleProperties(['title']);
        setViewType('table');
        setFilters([]);
        setSorts([]);
        setResultSnapshot(true);
        setResultSnapshotLimit(500);
        setSaveToTableViews(true);
        setSelectedExistingViewId('');
        setExistingViews([]);
        setViewUsage({ count: 0, pages: [] });
        setEditScope('shared');
        setModalPinnedViewIds(new Set());
        resetTypeOptions();
        setError('');
    }, [isOpen, preselectedTableId, editingBlock, isTableMode, editingView, initialTab]);

    // Quan canvia la taula origen, carreguem les vistes ja guardades per
    // permetre triar-ne una en lloc de crear-la des de zero.
    useEffect(() => {
        if (!sourceTableId) {
            setExistingViews([]);
            setSelectedExistingViewId('');
            return;
        }
        let cancelled = false;
        setLoadingExistingViews(true);
        apiFetch(`/api/vault/views?table_id=${encodeURIComponent(sourceTableId)}`)
            .then(data => {
                if (cancelled) return;
                const list = Array.isArray(data) ? data : (data?.views || []);
                // La "Taula Principal" no es persisteix al registry: el frontend
                // la crea virtualment quan una taula encara no té cap vista
                // (vegi VaultDashboard.jsx::ensureMainViewForTable). Si no
                // l'afegim aquí, l'usuari no la pot triar al desplegable.
                const hasMain = list.some(v =>
                    v.id === 'default' || v.is_main === true || v.is_default === true || v.name === 'Taula Principal'
                );
                if (!hasMain) {
                    list.unshift({
                        id: 'default',
                        table_id: sourceTableId,
                        name: 'Taula Principal',
                        type: 'table',
                        is_main: true,
                        filters: [],
                        sort: { field: 'last_modified', direction: 'desc' },
                        visibleProperties: [],
                    });
                }
                setExistingViews(list);
                // Si la vista actualment seleccionada NO pertany a la nova
                // taula (canvi user-iniciat), reset. Si SÍ que hi és (mode
                // edit pre-omplint), conservem la selecció.
                setSelectedExistingViewId(prev => {
                    if (!prev) return '';
                    return list.some(v => v.id === prev) ? prev : '';
                });
            })
            .catch(() => {
                if (!cancelled) setExistingViews([]);
            })
            .finally(() => {
                if (!cancelled) setLoadingExistingViews(false);
            });
        return () => { cancelled = true; };
    }, [sourceTableId, apiFetch]);

    // Quan l'usuari selecciona una vista existent, pre-omple els camps amb la
    // seva config i carrega quantes pàgines la comparteixen.
    useEffect(() => {
        if (!selectedExistingViewId) {
            setViewUsage({ count: 0, pages: [] });
            setEditScope('shared');
            return;
        }
        const v = existingViews.find(x => x.id === selectedExistingViewId);
        if (!v) return;
        setVisibleProperties(Array.isArray(v.visibleProperties) && v.visibleProperties.length ? v.visibleProperties : ['title']);
        setViewType(v.type || 'table');
        setFilters(Array.isArray(v.filters) ? v.filters : []);
        setResultSnapshot(v.resultSnapshot !== false);
        setResultSnapshotLimit(Number.isFinite(Number(v.resultSnapshotLimit)) ? Number(v.resultSnapshotLimit) : 500);
        applyTypeOptions(v);
        // Compat: el registry pot tenir `sorts: [...]` (nou) o `sort: {...}` (llegacy)
        if (Array.isArray(v.sorts) && v.sorts.length > 0) {
            setSorts(v.sorts);
        } else if (v.sort && v.sort.field) {
            setSorts([{ field: v.sort.field, direction: v.sort.direction || 'asc' }]);
        } else {
            setSorts([]);
        }
        // La "Taula Principal" virtual no té entry al registry; la traiem
        // com a "punt de partida" però activem el desat (es creaarà com a
        // vista nova de debò). El usage tampoc té sentit per a 'default'.
        if (selectedExistingViewId === 'default' || v.is_main) {
            setSaveToTableViews(true);
            setViewUsage({ count: 0, pages: [] });
            setEditScope('shared');
            return;
        }

        // Quan tries una vista existent real, no la dupliquem al registry.
        setSaveToTableViews(false);
        setEditScope('shared');

        // Carrega usage per saber si la vista és compartida.
        let cancelled = false;
        apiFetch(`/api/vault/views/${encodeURIComponent(selectedExistingViewId)}/usage`)
            .then(data => {
                if (cancelled) return;
                setViewUsage({
                    count: data?.count || 0,
                    pages: data?.pages || [],
                });
            })
            .catch(() => {
                if (!cancelled) setViewUsage({ count: 0, pages: [] });
            });
        return () => { cancelled = true; };
    }, [selectedExistingViewId, existingViews, apiFetch]);

    // Ajusta visibleProperties quan canvia la taula (treu els camps que ja no existeixen)
    useEffect(() => {
        if (!selectedTable) return;
        const valid = new Set(tableFields.map(f => f.name));
        setVisibleProperties(prev => {
            const filtered = prev.filter(n => valid.has(n));
            return filtered.length > 0 ? filtered : ['title'];
        });
    }, [sourceTableId, selectedTable, tableFields]);

    // Lògica de teclat canònica: Esc tanca, Tab fa focus-trap dins el panell i
    // es restaura el focus en tancar. Sense onConfirm: aquest modal és un
    // configurador amb autosave/desat explícit, sense una única acció primària
    // que Enter hagi de disparar. El hook escolta en CAPTURA a window, així
    // venç el stopPropagation de BlockNote (TipTap/ProseMirror).
    useModalKeyboard({
        isOpen,
        onClose: () => onClose(false),
        containerRef: panelRef,
        trapFocus: true,
    });

    if (!isOpen) return null;

    const toggleProperty = (name) => {
        setVisibleProperties(prev =>
            prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
        );
    };

    // Mou una columna visible amunt/avall per controlar l'ordre d'aparició.
    const moveProperty = (idx, dir) => {
        setVisibleProperties(prev => {
            const arr = [...prev];
            const j = idx + dir;
            if (j < 0 || j >= arr.length) return prev;
            [arr[idx], arr[j]] = [arr[j], arr[idx]];
            return arr;
        });
    };

    // Etiqueta visible d'un camp: el `title` canònic es tradueix ("Títol") i
    // la resta es mostren amb la primera lletra en majúscula (els noms amb
    // emoji/accents inicials es conserven intactes).
    const capitalizeFirst = (s) => {
        const str = String(s || '');
        return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
    };
    const fieldLabel = (name) => (
        name === 'title' ? t('view.column_title', { defaultValue: 'Títol' }) : capitalizeFirst(name)
    );

    // Valor inicial d'un filtre segons el tipus del camp: els checkbox neixen
    // amb un booleà concret ('false' = sense marcar) en lloc de buit, perquè la
    // comparació booleana del motor casi també les files sense valor.
    const defaultFilterValue = (fieldName) => (
        fieldMeta[fieldName]?.type === 'checkbox' ? 'false' : ''
    );

    const addFilter = () => {
        const firstField = tableFields[0]?.name || 'title';
        setFilters(prev => [...prev, { field: firstField, operator: 'equals', value: defaultFilterValue(firstField) }]);
    };

    const updateFilter = (idx, patch) => {
        setFilters(prev => prev.map((f, i) => {
            if (i !== idx) return f;
            // Si canvia el camp, el valor anterior pot no tenir sentit pel nou
            // tipus (p. ex. un id de relació en un camp de text); el reiniciem
            // al valor per defecte del nou tipus.
            const next = { ...f, ...patch };
            if (patch.field !== undefined && patch.field !== f.field) next.value = defaultFilterValue(patch.field);
            return next;
        }));
    };

    const removeFilter = (idx) => {
        setFilters(prev => prev.filter((_, i) => i !== idx));
    };

    const addSort = () => {
        const firstField = tableFields[0]?.name || 'title';
        setSorts(prev => [...prev, { field: firstField, direction: 'asc' }]);
    };

    const updateSort = (idx, patch) => {
        setSorts(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
    };

    const removeSort = (idx) => {
        setSorts(prev => prev.filter((_, i) => i !== idx));
    };

    const moveSort = (idx, delta) => {
        setSorts(prev => {
            const next = [...prev];
            const target = idx + delta;
            if (target < 0 || target >= next.length) return prev;
            [next[idx], next[target]] = [next[target], next[idx]];
            return next;
        });
    };

    // Construeix l'objecte amb les opcions específiques del tipus de vista
    // actiu. Només inclou els camps que apliquen al tipus perquè una vista no
    // arrossegui config irrellevant (p. ex. cardSize en una taula).
    const buildViewExtras = (src) => {
        // Sense `src` pren l'estat actual del modal; amb `src` (una vista
        // existent) n'extreu els mateixos camps amb els mateixos defaults,
        // tolerant camelCase (registry) i snake_case (secció embeguda). Així la
        // detecció de canvis i el desat usen exactament la mateixa forma.
        const s = src || { cardSize, galleryPreview, coverField, imageFit, groupBy, dateField, endDateField, calendarView, colorField, rowHeight, chartType, xField, yField, aggregation };
        const extras = {};
        if (viewType === 'gallery') {
            extras.cardSize = s.cardSize || 'medium';
            extras.galleryPreview = s.galleryPreview || 'cover';
            extras.coverField = s.coverField || s.cover_field || '';
            extras.imageFit = s.imageFit || s.image_fit || 'contain';
            extras.groupBy = s.groupBy || s.group_by || '';
        } else if (viewType === 'board') {
            extras.groupBy = s.groupBy || s.group_by || '';
        } else if (viewType === 'calendar') {
            extras.dateField = s.dateField || s.date_field || '';
            extras.calendarView = s.calendarView || s.calendar_view || 'dayGridMonth';
        } else if (viewType === 'timeline') {
            extras.dateField = s.dateField || s.date_field || '';
            extras.endDateField = s.endDateField || s.end_date_field || '';
            extras.colorField = s.colorField || s.color_field || '';
        } else if (viewType === 'chart') {
            extras.chartType = s.chartType || s.chart_type || 'bar';
            extras.xField = s.xField || s.x_field || '';
            extras.yField = s.yField || s.y_field || '';
            extras.aggregation = s.aggregation || ((s.yField || s.y_field) ? 'sum' : 'count');
        } else if (viewType === 'table' || viewType === 'list') {
            extras.rowHeight = s.rowHeight || s.row_height || 'normal';
            extras.groupBy = s.groupBy || s.group_by || '';
        }
        return extras;
    };

    const handleSave = async () => {
        if (!sourceTableId) {
            setError(t('view.error_no_table', 'Cal seleccionar una taula origen'));
            setActiveTab('general');
            return;
        }
        if (visibleProperties.length === 0) {
            setError(t('view.error_no_fields', 'Cal almenys un camp visible'));
            setActiveTab('properties');
            return;
        }

        setSaving(true);
        setError('');
        try {
            // Sanititza els filtres: descarta files sense camp; per operators
            // que no requereixen value, deixem null.
            const cleanFilters = filters
                .filter(f => f.field)
                .map(f => ({
                    field: f.field,
                    operator: f.operator || 'equals',
                    value: ['is_empty', 'is_not_empty'].includes(f.operator) ? null : (f.value || ''),
                }));

            const cleanSorts = sorts
                .filter(s => s.field)
                .map(s => ({ field: s.field, direction: s.direction || 'asc' }));
            // Mantenim `sort` (singular) per compat amb el renderer/UI que
            // encara llegeixen un únic criteri.
            const sortConfig = cleanSorts[0] || null;

            // Mode TAULA: desa la vista del registry directament (crea o
            // actualitza), sense secció ni bloc. Retorna la vista desada al
            // caller perquè refresqui el registry i la seleccioni.
            if (isTableMode) {
                const viewBody = {
                    ...(editingView || {}),
                    id: editingView?.id,
                    table_id: sourceTableId,
                    name: (viewName || editingView?.name || 'Vista').trim(),
                    type: viewType,
                    filters: cleanFilters,
                    sort: sortConfig,
                    sorts: cleanSorts,
                    visibleProperties,
                    resultSnapshot,
                    resultSnapshotLimit,
                    ...buildViewExtras(),
                };
                let saved;
                if (editingView?.id) {
                    saved = await apiFetch(`/api/vault/views/${encodeURIComponent(editingView.id)}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(viewBody),
                    });
                } else {
                    saved = await apiFetch('/api/vault/views', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(viewBody),
                    });
                }
                // `saved` pot ser la vista creada (amb id nou) o un status; en
                // qualsevol cas retornem el cos amb l'id resultant.
                const savedView = {
                    ...viewBody,
                    id: editingView?.id || saved?.id || viewBody.id,
                };
                onClose(true, savedView);
                return;
            }

            // 'default' és la vista principal virtual (no persistida): la
            // tractem com si l'usuari hagués escollit "Crear nova vista" amb
            // saveToTableViews=true (això s'ha forçat al useEffect de
            // selecció). Aquí netegem el viewId perquè no s'enviï 'default'
            // al backend.
            const isDefaultPick = selectedExistingViewId === 'default';
            let viewId = (selectedExistingViewId && !isDefaultPick) ? selectedExistingViewId : null;

            // Reaprofitem la vista existent si n'han triat una real. Si
            // l'usuari l'ha modificada:
            //   - editScope === 'shared': fem upsert al registry → afecta totes
            //     les pàgines que l'embeguin (això és el comportament natural
            //     d'una vista compartida).
            //   - editScope === 'fork': desfem la referència `view_id` i la
            //     secció es desa amb els camps inline. Així aquesta pàgina
            //     queda desconnectada de la vista compartida.
            if (selectedExistingViewId && !isDefaultPick) {
                const original = existingViews.find(x => x.id === selectedExistingViewId);
                const newPropsJson = JSON.stringify({
                    // `type` també compta com a modificació: sense ell, canviar
                    // NOMÉS el tipus (taula→board/feed/graph, sense extras) no
                    // s'upsertava mai al registry i DbViewEmbed —que prefereix la
                    // vista del registry a la secció— seguia pintant el tipus vell.
                    type: viewType,
                    filters: cleanFilters,
                    sorts: cleanSorts,
                    visibleProperties,
                    resultSnapshot,
                    resultSnapshotLimit,
                    // Opcions per tipus (galeria: cardSize/galleryPreview; board:
                    // groupBy; etc.). Sense incloure-les aquí, canviar NOMÉS la
                    // previsualització o la mida de targeta no es detectava com a
                    // modificació i mai s'aplicava la vista compartida al registry
                    // (d'on el render llegeix galleryPreview) → el canvi es perdia.
                    ...buildViewExtras(),
                });
                const oldPropsJson = JSON.stringify({
                    type: String(original?.view_type || original?.type || 'table').toLowerCase(),
                    filters: original?.filters || [],
                    sorts: original?.sorts || (original?.sort ? [original.sort] : []),
                    visibleProperties: original?.visibleProperties || ['title'],
                    resultSnapshot: original?.resultSnapshot !== false,
                    resultSnapshotLimit: Number.isFinite(Number(original?.resultSnapshotLimit)) ? Number(original.resultSnapshotLimit) : 500,
                    ...buildViewExtras(original || {}),
                });
                const modified = newPropsJson !== oldPropsJson;

                if (modified && editScope === 'fork') {
                    // Desfés el lligam: la secció serà inline.
                    viewId = null;
                } else if (modified && editScope === 'shared') {
                    const updated = {
                        ...(original || {}),
                        id: selectedExistingViewId,
                        table_id: sourceTableId,
                        type: viewType,
                        filters: cleanFilters,
                        sort: sortConfig,
                        sorts: cleanSorts,
                        visibleProperties,
                        resultSnapshot,
                        resultSnapshotLimit,
                        ...buildViewExtras(),
                    };
                    await apiFetch('/api/vault/views', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updated),
                    });
                }
            } else if (saveToTableViews) {
                // Cas "crear nova": la creem primer al registry.views[] perquè
                // la secció pugui referenciar-la per id.
                const viewBody = {
                    table_id: sourceTableId,
                    name: (viewName || heading || 'Vista').trim(),
                    type: viewType,
                    filters: cleanFilters,
                    sort: sortConfig,
                    sorts: cleanSorts,
                    visibleProperties,
                    resultSnapshot,
                    resultSnapshotLimit,
                    ...buildViewExtras(),
                    // Si filtra pel context de la pàgina ("this"), com a
                    // pestanya del tauler no resoldria res: es marca embedded
                    // i només viu dins dels embeds (isPageEmbedView). Sense
                    // "this", es respecta el checkbox "desa també a les vistes
                    // de la taula" i queda com a pestanya normal.
                    ...(cleanFilters.some(f => f?.value === 'this') ? { embedded: true } : {}),
                };
                const created = await apiFetch('/api/vault/views', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(viewBody),
                });
                viewId = created?.id || null;
            }

            // 2) Crea la secció embeguda a la pàgina. Si tenim view_id,
            // referenciem la vista guardada (única font de veritat). Sense
            // view_id, escrivim els camps inline (mode "vista local").
            const sectionBody = {
                heading: heading.trim(),
                heading_level: headingLevel,
                type: 'db_view',
                source_table_id: sourceTableId,
                view_id: viewId,
                filters: cleanFilters,
                sort: sortConfig,
                sorts: cleanSorts,
                visible_properties: visibleProperties,
                view_type: viewType,
                ...buildViewExtras(),
                // Llegacy: mantingut per a l'sync_sections que encara llegeix `columns`
                columns: visibleProperties,
            };

            const res = await apiFetch(`/api/pages/${pageId}/views`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(sectionBody),
            });
            if (res && typeof res.ok === 'boolean' && !res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.detail || res.statusText);
            }

            if (viewId && !isTableMode) {
                try {
                    localStorage.setItem(`gnosi_embed_pinned_${pageId}_${viewId}`, JSON.stringify([...modalPinnedViewIds]));
                } catch (e) {
                    console.warn('Failed to save pinned views to localStorage', e);
                }
            }

            // Retornem prou info perquè el caller (BlockEditor) pugui inserir
            // un block dbViewEmbed al cursor amb la config completa.
            onClose(true, {
                view_id: viewId,
                heading: heading.trim(),
                heading_level: headingLevel,
                source_table_id: sourceTableId,
                view_type: viewType,
                filters: cleanFilters,
                sorts: cleanSorts,
                visible_properties: visibleProperties,
            });
        } catch (e) {
            setError(e?.message || t('view.error_create', 'Error desconegut en crear la vista'));
        } finally {
            setSaving(false);
        }
    };

    // Camps de l'esquema aptes per a cada control per-tipus: agrupació de
    // Kanban (camps amb valors acotats) i eix temporal de calendari/timeline.
    const groupFieldOptions = tableFields.filter(f => GROUP_FIELD_TYPES.has(String(f.type || '').toLowerCase()));
    const dateFieldOptions = tableFields.filter(f => DATE_FIELD_TYPES.has(String(f.type || '').toLowerCase()));
    const numericFieldOptions = tableFields.filter(f => NUMERIC_FIELD_TYPES.has(String(f.type || '').toLowerCase()));
    // Camps aptes per a la portada de la galeria: adjunts/imatges/URL o camps amb
    // nom d'imatge (la galeria n'extreu la src amb getImageSrc).
    const coverFieldOptions = tableFields.filter(f => {
        const ty = String(f.type || '').toLowerCase();
        return ty === 'files' || ty === 'image' || ty === 'url' || /imatge|image|cover|portada|foto|photo|thumbnail|miniatura/i.test(f.name || '');
    });

    // No tanquem amb click fora: amb tantes pestanyes és fàcil clicar
    // accidentalment l'overlay i perdre la config. Tancament només via X / Esc.
    const handleOverlayClick = () => {};

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[200] p-4 backdrop-blur-sm"
            onClick={handleOverlayClick}
        >
            <div ref={panelRef} className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-2xl border border-[var(--border-primary)] flex flex-col max-h-[85vh]">
                {/* Header */}
                <div className="px-5 py-4 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] rounded-t-xl shrink-0">
                    <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Eye size={16} className="text-[var(--gnosi-primary)]" />
                        {isTableMode
                            ? (editingView?.id ? t('view.config_title', 'Configurar vista') : t('view.new_view', 'Nova vista'))
                            : (editingBlock
                                ? t('page_view.title_edit', 'Edita la vista de BD')
                                : t('page_view.title', 'Afegir vista de BD'))}
                    </h2>
                    <button onClick={() => onClose(false)} className="gnosi-close-btn">
                        <X size={16} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] shrink-0">
                    {TABS.map(tab => {
                        const Icon = tab.icon;
                        const active = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
                                    active
                                        ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)]'
                                        : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                                }`}
                            >
                                <Icon size={13} />
                                {t(`view.tab_${tab.id}`, tab.label)}
                            </button>
                        );
                    })}
                </div>

                {/* Body */}
                <div className="p-5 space-y-4 overflow-y-auto flex-1">
                    {activeTab === 'general' && (
                        <>
                            {!isTableMode && (
                                <div>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.source_table', 'Taula origen')}</label>
                                    <select
                                        className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                        value={sourceTableId}
                                        onChange={e => setSourceTableId(e.target.value)}
                                    >
                                        <option value="">{t('view.pick_table', '— Selecciona taula —')}</option>
                                        {allTables.map(tbl => (
                                            <option key={tbl.id} value={tbl.id}>{tbl.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">{t('view.type_label', 'Tipus de vista')}</label>
                                <div className="grid grid-cols-4 gap-2">
                                    {VIEW_TYPES.map(vt => {
                                        const Icon = vt.icon;
                                        const active = viewType === vt.id;
                                        return (
                                            <button
                                                key={vt.id}
                                                type="button"
                                                onClick={() => setViewType(vt.id)}
                                                className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all ${
                                                    active
                                                        ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'
                                                        : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                                                }`}
                                                title={t(`view.type_${vt.id}`, vt.label)}
                                            >
                                                <Icon size={18} />
                                                <span className="text-[10px] font-semibold">{t(`view.type_${vt.id}`, vt.label)}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Opcions específiques del tipus de vista triat: apareixen
                                contextualment just sota el selector de tipus. */}
                            {(viewType === 'table' || viewType === 'list') && (
                                <div className="border-t border-[var(--border-primary)] pt-4 space-y-2">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('view.table_options', 'Opcions de la taula')}</p>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('view.row_height', 'Alçada de fila')}</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[{ value: 'compact', label: t('view.row_compact', 'Compacta') }, { value: 'normal', label: t('view.row_normal', 'Normal') }, { value: 'tall', label: t('view.row_tall', 'Alta') }].map(opt => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setRowHeight(opt.value)}
                                                className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                                                    rowHeight === opt.value
                                                        ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'
                                                        : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                                }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {viewType === 'gallery' && (
                                <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('view.gallery_options', 'Opcions de la galeria')}</p>
                                    <div>
                                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('view.card_size', 'Mida de la targeta')}</label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {CARD_SIZES.map(cs => (
                                                <button
                                                    key={cs.value}
                                                    type="button"
                                                    onClick={() => setCardSize(cs.value)}
                                                    className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                                                        cardSize === cs.value
                                                            ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'
                                                            : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                                    }`}
                                                >
                                                    {t(`view.card_${cs.value}`, cs.label)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('view.card_preview', 'Previsualització de la targeta')}</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {GALLERY_PREVIEWS.map(gp => (
                                                <button
                                                    key={gp.value}
                                                    type="button"
                                                    onClick={() => setGalleryPreview(gp.value)}
                                                    title={t(`view.gp_${gp.value}_hint`, gp.hint)}
                                                    className={`text-left px-2.5 py-2 rounded-lg border transition-all ${
                                                        galleryPreview === gp.value
                                                            ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10'
                                                            : 'border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
                                                    }`}
                                                >
                                                    <span className={`block text-xs font-semibold ${galleryPreview === gp.value ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'}`}>{t(`view.gp_${gp.value}`, gp.label)}</span>
                                                    <span className="block text-[10px] text-[var(--text-tertiary)] leading-tight mt-0.5">{t(`view.gp_${gp.value}_hint`, gp.hint)}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('view.cover_field', 'Camp de portada')}</label>
                                        <select
                                            value={coverField}
                                            onChange={e => setCoverField(e.target.value)}
                                            className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                        >
                                            <option value="">{t('view.cover_default', 'Portada de la pàgina (per defecte)')}</option>
                                            {coverFieldOptions.map(f => (
                                                <option key={f.name} value={f.name}>{fieldLabel(f.name)}</option>
                                            ))}
                                        </select>
                                        <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">{t('view.cover_hint', "D'on treure la imatge de cada targeta (només si la previsualització és «Portada»).")}</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('view.image_fit', 'Ajust de la imatge')}</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {[{ value: 'contain', label: t('view.fit_contain', 'Sencera') }, { value: 'cover', label: t('view.fit_cover', 'Omple') }].map(opt => (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    onClick={() => setImageFit(opt.value)}
                                                    className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                                                        imageFit === opt.value
                                                            ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'
                                                            : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                                    }`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {(viewType === 'table' || viewType === 'list' || viewType === 'gallery') && (
                                <div className="border-t border-[var(--border-primary)] pt-4 space-y-2">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('view.grouping', 'Agrupació')}</p>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)]">{t('view.group_by', 'Agrupa per')}</label>
                                    {!selectedTable ? (
                                        <p className="text-xs text-[var(--text-tertiary)] italic">{t('view.pick_table_first', 'Selecciona primer una taula.')}</p>
                                    ) : (
                                        <>
                                            <select
                                                value={groupBy}
                                                onChange={e => setGroupBy(e.target.value)}
                                                className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                            >
                                                <option value="">{t('view.no_grouping', 'Sense agrupar')}</option>
                                                {groupFieldOptions.map(f => (
                                                    <option key={f.name} value={f.name}>{fieldLabel(f.name)}</option>
                                                ))}
                                            </select>
                                            {groupFieldOptions.length === 0 && (
                                                <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{t('view.no_group_fields', 'Cap camp de selecció/estat a la taula per agrupar.')}</p>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {viewType === 'board' && (
                                <div className="border-t border-[var(--border-primary)] pt-4 space-y-2">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('view.board_options', 'Opcions del kanban')}</p>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)]">{t('view.group_by', 'Agrupa per')}</label>
                                    {!selectedTable ? (
                                        <p className="text-xs text-[var(--text-tertiary)] italic">{t('view.pick_table_first', 'Selecciona primer una taula.')}</p>
                                    ) : (
                                        <>
                                            <select
                                                value={groupBy}
                                                onChange={e => setGroupBy(e.target.value)}
                                                className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                            >
                                                <option value="">{t('view.group_auto', 'Automàtic (estat)')}</option>
                                                {groupFieldOptions.map(f => (
                                                    <option key={f.name} value={f.name}>{fieldLabel(f.name)}</option>
                                                ))}
                                            </select>
                                            {groupFieldOptions.length === 0 && (
                                                <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{t('view.no_group_fields_auto', "Cap camp de selecció/estat a la taula; s'agruparà automàticament.")}</p>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {(viewType === 'calendar' || viewType === 'timeline') && (
                                <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{viewType === 'calendar' ? t('view.calendar_options', 'Opcions del calendari') : t('view.timeline_options', 'Opcions del timeline')}</p>
                                    {!selectedTable ? (
                                        <p className="text-xs text-[var(--text-tertiary)] italic">{t('view.pick_table_first', 'Selecciona primer una taula.')}</p>
                                    ) : (
                                        <>
                                            <div>
                                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{viewType === 'timeline' ? t('view.start_date', "Data d'inici") : t('view.date_field', 'Camp de data')}</label>
                                                <select
                                                    value={dateField}
                                                    onChange={e => setDateField(e.target.value)}
                                                    className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                >
                                                    <option value="">{t('view.date_auto', 'Automàtic (primer camp de data)')}</option>
                                                    {dateFieldOptions.map(f => (
                                                        <option key={f.name} value={f.name}>{fieldLabel(f.name)}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            {viewType === 'calendar' && (
                                                <div>
                                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.initial_view', 'Vista inicial')}</label>
                                                    <select
                                                        value={calendarView}
                                                        onChange={e => setCalendarView(e.target.value)}
                                                        className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                    >
                                                        <option value="dayGridMonth">{t('view.cal_month', 'Mes')}</option>
                                                        <option value="timeGridWeek">{t('view.cal_week', 'Setmana')}</option>
                                                        <option value="timeGridDay">{t('view.cal_day', 'Dia')}</option>
                                                        <option value="multiMonthYear">{t('view.cal_year', 'Any')}</option>
                                                    </select>
                                                </div>
                                            )}
                                            {viewType === 'timeline' && (
                                                fieldMeta[dateField]?.type === 'period' ? (
                                                    <p className="text-[11px] text-[var(--text-tertiary)]">{t('view.period_hint', "El camp de període ja defineix l'inici i el fi de cada barra.")}</p>
                                                ) : (
                                                    <div>
                                                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.end_date', 'Data de fi (opcional)')}</label>
                                                        <select
                                                            value={endDateField}
                                                            onChange={e => setEndDateField(e.target.value)}
                                                            className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                        >
                                                            <option value="">{t('view.end_none', "Cap (durada d'un dia)")}</option>
                                                            {dateFieldOptions.map(f => (
                                                                <option key={f.name} value={f.name}>{fieldLabel(f.name)}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                )
                                            )}
                                            {viewType === 'timeline' && (
                                                <div>
                                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.color_by', 'Color per')}</label>
                                                    <select
                                                        value={colorField}
                                                        onChange={e => setColorField(e.target.value)}
                                                        className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                    >
                                                        <option value="">{t('view.color_single', 'Color únic (per defecte)')}</option>
                                                        {groupFieldOptions.map(f => (
                                                            <option key={f.name} value={f.name}>{fieldLabel(f.name)}</option>
                                                        ))}
                                                    </select>
                                                    <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">{t('view.color_hint', "Acoloreix cada barra segons el valor d'aquest camp (usa els colors de les seves opcions).")}</p>
                                                </div>
                                            )}
                                            {dateFieldOptions.length === 0 && (
                                                <p className="text-[11px] text-[var(--text-tertiary)]">{t('view.no_date_fields', "Cap camp de data a la taula; s'usarà la data de modificació.")}</p>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {viewType === 'chart' && (
                                <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('view.chart_options', 'Opcions del gràfic')}</p>
                                    {!selectedTable ? (
                                        <p className="text-xs text-[var(--text-tertiary)] italic">{t('view.pick_table_first', 'Selecciona primer una taula.')}</p>
                                    ) : (
                                        <>
                                            <div>
                                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.chart_type', 'Tipus de gràfic')}</label>
                                                <select
                                                    value={chartType}
                                                    onChange={e => setChartType(e.target.value)}
                                                    className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                >
                                                    <option value="bar">{t('view.chart_bar', 'Barres')}</option>
                                                    <option value="hbar">{t('view.chart_hbar', 'Barres horitzontals')}</option>
                                                    <option value="line">{t('view.chart_line', 'Línia')}</option>
                                                    <option value="pie">{t('view.chart_pie', 'Pastís')}</option>
                                                    <option value="donut">{t('view.chart_donut', 'Donut')}</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.chart_x', 'Agrupar per (eix X)')}</label>
                                                <select
                                                    value={xField}
                                                    onChange={e => setXField(e.target.value)}
                                                    className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                >
                                                    <option value="">{t('view.pick_field', '— Tria un camp —')}</option>
                                                    {tableFields.map(f => (
                                                        <option key={f.name} value={f.name}>{fieldLabel(f.name)}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.aggregation', "Funció d'agregació")}</label>
                                                <select
                                                    value={aggregation}
                                                    onChange={e => setAggregation(e.target.value)}
                                                    className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                >
                                                    <option value="count">{t('view.agg_count', 'Recompte (nombre de files)')}</option>
                                                    <option value="sum">{t('view.agg_sum', 'Suma')}</option>
                                                    <option value="avg">{t('view.agg_avg', 'Mitjana')}</option>
                                                    <option value="min">{t('view.agg_min', 'Mínim')}</option>
                                                    <option value="max">{t('view.agg_max', 'Màxim')}</option>
                                                </select>
                                            </div>
                                            {aggregation !== 'count' && (
                                                <div>
                                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.chart_y', 'Camp de valor (eix Y)')}</label>
                                                    <select
                                                        value={yField}
                                                        onChange={e => setYField(e.target.value)}
                                                        className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                    >
                                                        <option value="">{t('view.pick_numeric', '— Tria un camp numèric —')}</option>
                                                        {numericFieldOptions.map(f => (
                                                            <option key={f.name} value={f.name}>{fieldLabel(f.name)}</option>
                                                        ))}
                                                    </select>
                                                    {numericFieldOptions.length === 0 && (
                                                        <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">{t('view.no_numeric', 'Cap camp numèric a la taula; usa el «Recompte».')}</p>
                                                    )}
                                                </div>
                                            )}
                                            {!xField && (
                                                <p className="text-[11px] text-[var(--text-tertiary)]">{t('view.chart_pick_x', "Tria el camp d'agrupació per veure el gràfic.")}</p>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {!isTableMode && sourceTableId && (
                                <div>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                                        {t('view.existing_view', 'Vista existent')}
                                    </label>
                                    <select
                                        className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                        value={selectedExistingViewId}
                                        onChange={e => setSelectedExistingViewId(e.target.value)}
                                        disabled={loadingExistingViews}
                                    >
                                        <option value="">
                                            {loadingExistingViews
                                                ? t('view.loading_views', 'Carregant vistes…')
                                                : t('view.create_new_view', '— Crear nova vista —')}
                                        </option>
                                        {existingViews.map(v => (
                                            <option key={v.id} value={v.id}>
                                                {v.name || t('view.unnamed', '(sense nom)')} {v.type ? `· ${v.type}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                    {selectedExistingViewId && (
                                        <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                                            {t('view.existing_hint', 'Pots revisar / sobreescriure els camps a les pestanyes Camps, Filtres i Ordenació.')}
                                        </p>
                                    )}
                                </div>
                            )}

                            {!isTableMode && sourceTableId && existingViews.length > 0 && (
                                <div className="border-t border-[var(--border-primary)] pt-4">
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">
                                        {t('view.pinned_tabs', 'Mostrar pestanyes (vistes fixades a aquest bloc)')}
                                    </label>
                                    <div className="space-y-1.5 max-h-36 overflow-y-auto border border-[var(--border-primary)] rounded-lg p-2.5 bg-[var(--bg-secondary)]">
                                        {existingViews.map(v => {
                                            const isChecked = modalPinnedViewIds.has(v.id);
                                            const isAnchor = v.id === selectedExistingViewId || (v.id === 'default' && !selectedExistingViewId);
                                            return (
                                                <label key={v.id} className="flex items-center gap-2 text-xs text-[var(--text-primary)] cursor-pointer select-none">
                                                    <input
                                                        type="checkbox"
                                                        checked={isChecked || isAnchor}
                                                        disabled={isAnchor}
                                                        onChange={e => {
                                                            const checked = e.target.checked;
                                                            setModalPinnedViewIds(prev => {
                                                                const next = new Set(prev);
                                                                if (checked) {
                                                                    next.add(v.id);
                                                                } else {
                                                                    next.delete(v.id);
                                                                }
                                                                return next;
                                                            });
                                                        }}
                                                        className="rounded text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)]"
                                                    />
                                                    <span>{v.name || t('view.unnamed', '(sense nom)')}</span>
                                                    {isAnchor && (
                                                        <span className="text-[10px] text-[var(--text-tertiary)] italic">{t('view.anchor_view', '(vista àncora)')}</span>
                                                    )}
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {selectedExistingViewId && viewUsage.count > 0 && (
                                <div className="border-t border-[var(--border-primary)] pt-4">
                                    <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
                                        {t('view.usage_count', { count: viewUsage.count, defaultValue: "Aquesta vista ja s'usa a {{count}} pàgines." })}
                                    </p>
                                    <p className="text-[11px] text-[var(--text-tertiary)] mb-3">
                                        {t('view.edit_scope_prompt', 'Si modifiques els camps, tria com aplicar-ho:')}
                                    </p>
                                    <div className="space-y-2">
                                        <label className="flex items-start gap-2 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="editScope"
                                                value="shared"
                                                checked={editScope === 'shared'}
                                                onChange={() => setEditScope('shared')}
                                                className="mt-0.5"
                                            />
                                            <div>
                                                <span className="text-sm text-[var(--text-primary)] block">
                                                    {t('view.scope_shared', 'Aplicar canvis a totes les pàgines')}
                                                </span>
                                                <span className="text-[11px] text-[var(--text-tertiary)]">
                                                    {t('view.scope_shared_hint', "La vista compartida s'actualitza i tots els embeds reflecteixen els canvis.")}
                                                </span>
                                            </div>
                                        </label>
                                        <label className="flex items-start gap-2 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="editScope"
                                                value="fork"
                                                checked={editScope === 'fork'}
                                                onChange={() => setEditScope('fork')}
                                                className="mt-0.5"
                                            />
                                            <div>
                                                <span className="text-sm text-[var(--text-primary)] block">
                                                    {t('view.scope_fork', 'Aplicar només a aquesta pàgina')}
                                                </span>
                                                <span className="text-[11px] text-[var(--text-tertiary)]">
                                                    {t('view.scope_fork_hint', 'Desconnecta aquest embed de la vista compartida i guarda una còpia local. Les altres pàgines no canvien.')}
                                                </span>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            )}

                            {isTableMode && (
                                <div>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                                        {t('view.view_name', 'Nom de la vista')}
                                    </label>
                                    <input
                                        className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)] outline-none"
                                        value={viewName}
                                        onChange={e => setViewName(e.target.value)}
                                        placeholder={t('view.view_name_ph', 'ex: Per àrea')}
                                    />
                                </div>
                            )}

                            {!isTableMode && !selectedExistingViewId && (
                                <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={saveToTableViews}
                                            onChange={e => setSaveToTableViews(e.target.checked)}
                                            className="rounded border-[var(--border-primary)]"
                                        />
                                        <span className="text-sm text-[var(--text-primary)]">
                                            {t('view.save_to_table', 'Desa també a les vistes de la taula')}
                                        </span>
                                    </label>
                                    {saveToTableViews && (
                                        <div className="ml-6">
                                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                                                {t('view.view_name', 'Nom de la vista')}
                                            </label>
                                            <input
                                                className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)] outline-none"
                                                value={viewName}
                                                onChange={e => setViewName(e.target.value)}
                                                placeholder={t('view.view_name_ph2', 'ex: Contactes clau')}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Portabilitat: snapshot de wikilinks de resultats al
                                markdown (Obsidian/Drupal/lectors plans). El valor
                                viu a la vista; el backend l'honora en desar. */}
                            <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
                                <label className="flex items-start gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={resultSnapshot}
                                        onChange={e => setResultSnapshot(e.target.checked)}
                                        className="mt-0.5 rounded border-[var(--border-primary)]"
                                    />
                                    <div>
                                        <span className="text-sm text-[var(--text-primary)] block">
                                            {t('view.snapshot_label', 'Desa els enllaços de resultats al markdown')}
                                        </span>
                                        <span className="text-[11px] text-[var(--text-tertiary)]">
                                            {t('view.snapshot_hint', 'Escriu una llista [[Títol|id]] de les pàgines que la vista retorna, perquè Obsidian i altres lectors hi puguin navegar.')}
                                        </span>
                                    </div>
                                </label>
                                {resultSnapshot && (
                                    <div className="ml-6 flex items-center gap-2">
                                        <label htmlFor="pvm-result-snapshot-limit" className="text-xs font-semibold text-[var(--text-secondary)]">
                                            {t('view.snapshot_limit', "Màxim d'enllaços")}
                                        </label>
                                        <input
                                            id="pvm-result-snapshot-limit"
                                            type="number"
                                            min="0"
                                            step="50"
                                            value={resultSnapshotLimit}
                                            onChange={e => {
                                                const n = parseInt(e.target.value, 10);
                                                setResultSnapshotLimit(Number.isFinite(n) && n >= 0 ? n : 0);
                                            }}
                                            className="w-24 text-sm border border-[var(--border-primary)] rounded-lg px-2 py-1 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)] outline-none text-right"
                                        />
                                        <span className="text-[11px] text-[var(--text-tertiary)]">{t('view.snapshot_unlimited', '0 = sense límit')}</span>
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {activeTab === 'properties' && (
                        <div>
                            <p className="text-xs text-[var(--text-secondary)] mb-3">
                                {t('view.fields_intro', 'Selecciona els camps a mostrar com a columnes.')}
                            </p>
                            {!selectedTable ? (
                                <p className="text-sm text-[var(--text-tertiary)] italic">
                                    {t('view.pick_table_general', 'Selecciona primer una taula a la pestanya General.')}
                                </p>
                            ) : (
                                <div className="space-y-3 max-h-[44vh] overflow-y-auto">
                                    {(() => {
                                        const selected = visibleProperties
                                            .map(n => fieldMeta[n])
                                            .filter(Boolean);
                                        const available = tableFields.filter(f => !visibleProperties.includes(f.name));
                                        return (
                                            <>
                                                <div>
                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1 px-2">
                                                        {t('view.visible_columns', 'Columnes visibles (ordre)')}
                                                    </p>
                                                    {selected.length === 0 ? (
                                                        <p className="text-xs text-[var(--text-tertiary)] italic px-2 py-1">{t('view.no_columns', "Cap columna. Tria'n una a sota.")}</p>
                                                    ) : selected.map((f, idx) => (
                                                        <div
                                                            key={f.name}
                                                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-tertiary)]"
                                                        >
                                                            <div className="flex flex-col">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => moveProperty(idx, -1)}
                                                                    disabled={idx === 0}
                                                                    className="text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] disabled:opacity-25 leading-none"
                                                                    title={t('view.move_up', 'Amunt')}
                                                                >
                                                                    <ArrowUp size={12} />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => moveProperty(idx, 1)}
                                                                    disabled={idx === selected.length - 1}
                                                                    className="text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] disabled:opacity-25 leading-none"
                                                                    title={t('view.move_down', 'Avall')}
                                                                >
                                                                    <ArrowDown size={12} />
                                                                </button>
                                                            </div>
                                                            <span className="text-sm text-[var(--text-primary)] flex-1">{fieldLabel(f.name)}</span>
                                                            <span className="text-[10px] text-[var(--text-tertiary)] uppercase">{f.type || ''}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleProperty(f.name)}
                                                                className="text-[var(--text-tertiary)] hover:text-red-500 p-1"
                                                                title={t('view.remove', 'Treure')}
                                                            >
                                                                <Trash2 size={13} />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                                {available.length > 0 && (
                                                    <div>
                                                        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1 px-2">
                                                            {t('view.available', 'Disponibles')}
                                                        </p>
                                                        {available.map(f => (
                                                            <label
                                                                key={f.name}
                                                                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-tertiary)] cursor-pointer"
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={false}
                                                                    onChange={() => toggleProperty(f.name)}
                                                                    className="rounded border-[var(--border-primary)]"
                                                                />
                                                                <span className="text-sm text-[var(--text-primary)] flex-1">{fieldLabel(f.name)}</span>
                                                                <span className="text-[10px] text-[var(--text-tertiary)] uppercase">{f.type || ''}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'filters' && (
                        <div>
                            <div className="flex justify-between items-center mb-3">
                                <p className="text-xs text-[var(--text-secondary)]">
                                    {t('view.filters_intro', 'Tots els filtres es combinen amb AND. Valor "this" = ID d\'aquesta pàgina.')}
                                </p>
                                <button
                                    onClick={addFilter}
                                    disabled={!selectedTable}
                                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/20 disabled:opacity-40"
                                >
                                    <Plus size={12} />
                                    {t('view.add_filter', 'Afegir filtre')}
                                </button>
                            </div>
                            {!selectedTable ? (
                                <p className="text-sm text-[var(--text-tertiary)] italic">{t('view.pick_table_first', 'Selecciona primer una taula.')}</p>
                            ) : filters.length === 0 ? (
                                <p className="text-sm text-[var(--text-tertiary)] italic">{t('view.no_filters', 'Cap filtre. Es mostraran totes les files.')}</p>
                            ) : (
                                <div className="space-y-2">
                                    {filters.map((f, idx) => {
                                        const noValue = ['is_empty', 'is_not_empty'].includes(f.operator);
                                        const meta = fieldMeta[f.field];
                                        const isRelation = meta?.type === 'relation' && !!meta.relation_database_id;
                                        const relOpts = isRelation ? relationCache[meta.relation_database_id] : null;
                                        return (
                                            <div key={idx} className="flex gap-2 items-center">
                                                <select
                                                    className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] flex-1"
                                                    value={f.field}
                                                    onChange={e => updateFilter(idx, { field: e.target.value })}
                                                >
                                                    {tableFields.map(tf => (
                                                        <option key={tf.name} value={tf.name}>{fieldLabel(tf.name)}</option>
                                                    ))}
                                                </select>
                                                <select
                                                    className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] w-32"
                                                    value={f.operator}
                                                    onChange={e => updateFilter(idx, { operator: e.target.value })}
                                                >
                                                    {FILTER_OPERATORS.map(op => (
                                                        <option key={op.value} value={op.value}>{t(`view.op_${op.value}`, op.label)}</option>
                                                    ))}
                                                </select>
                                                {(() => {
                                                    // El control del valor casa amb el tipus del camp: un checkbox
                                                    // es filtra amb un checkbox (igual que el camp), un nombre amb
                                                    // un input numèric, una data amb un selector de data i una
                                                    // relació amb el seu picker.
                                                    const inputCls = 'text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] w-32 disabled:opacity-40';
                                                    if (noValue) {
                                                        // is_empty / is_not_empty: no cal cap valor.
                                                        return <input className={inputCls} value="" placeholder="—" disabled />;
                                                    }
                                                    if (isRelation) {
                                                        return (
                                                            <RelationValuePicker
                                                                value={f.value || ''}
                                                                onChange={v => updateFilter(idx, { value: v })}
                                                                options={relOpts || []}
                                                                loading={relOpts === undefined}
                                                                thisLabel={t('view.filter_this', { defaultValue: 'Aquesta pàgina' })}
                                                                placeholder={t('view.filter_pick', { defaultValue: 'Tria…' })}
                                                            />
                                                        );
                                                    }
                                                    const ftype = meta?.type;
                                                    if (ftype === 'checkbox') {
                                                        // Mateix control que el camp: un checkbox. Marcat = filtra
                                                        // pels registres marcats ('true'); sense marcar = pels no
                                                        // marcats ('false', que el motor també casa amb els buits).
                                                        const checked = f.value === 'true';
                                                        return (
                                                            <label className={`${inputCls} flex items-center gap-2 cursor-pointer`}>
                                                                <input
                                                                    type="checkbox"
                                                                    className="accent-[var(--gnosi-primary)] cursor-pointer"
                                                                    checked={checked}
                                                                    onChange={e => updateFilter(idx, { value: e.target.checked ? 'true' : 'false' })}
                                                                />
                                                                <span className="text-[var(--text-secondary)]">{checked ? t('view.checked', 'Marcat') : t('view.unchecked', 'Sense marcar')}</span>
                                                            </label>
                                                        );
                                                    }
                                                    if (ftype === 'number') {
                                                        return (
                                                            <input
                                                                type="number"
                                                                className={inputCls}
                                                                value={f.value || ''}
                                                                onChange={e => updateFilter(idx, { value: e.target.value })}
                                                                placeholder={t('view.value_ph', 'Valor')}
                                                            />
                                                        );
                                                    }
                                                    if (ftype === 'date' || ftype === 'datetime') {
                                                        return (
                                                            <input
                                                                type={ftype === 'datetime' ? 'datetime-local' : 'date'}
                                                                className={inputCls}
                                                                value={f.value || ''}
                                                                onChange={e => updateFilter(idx, { value: e.target.value })}
                                                            />
                                                        );
                                                    }
                                                    return (
                                                        <input
                                                            className={inputCls}
                                                            value={f.value || ''}
                                                            onChange={e => updateFilter(idx, { value: e.target.value })}
                                                            placeholder={t('view.value_this_ph', 'this o valor')}
                                                        />
                                                    );
                                                })()}
                                                <button
                                                    onClick={() => removeFilter(idx)}
                                                    className="text-[var(--text-tertiary)] hover:text-red-500 p-1"
                                                    title={t('view.delete', 'Eliminar')}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'sort' && (
                        <div>
                            <div className="flex justify-between items-center mb-3">
                                <p className="text-xs text-[var(--text-secondary)]">
                                    {t('view.sort_intro', "Ordenació amb prioritat: el primer criteri mana, els següents desempaten. Sense criteris, s'ordena per títol ascendent.")}
                                </p>
                                <button
                                    onClick={addSort}
                                    disabled={!selectedTable}
                                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/20 disabled:opacity-40"
                                >
                                    <Plus size={12} />
                                    {t('view.add_sort', 'Afegir criteri')}
                                </button>
                            </div>
                            {!selectedTable ? (
                                <p className="text-sm text-[var(--text-tertiary)] italic">{t('view.pick_table_first', 'Selecciona primer una taula.')}</p>
                            ) : sorts.length === 0 ? (
                                <p className="text-sm text-[var(--text-tertiary)] italic">{t('view.no_sorts', 'Cap criteri. Per defecte: títol ascendent.')}</p>
                            ) : (
                                <div className="space-y-2">
                                    {sorts.map((s, idx) => (
                                        <div key={idx} className="flex gap-2 items-center">
                                            <span className="text-[10px] font-bold text-[var(--text-tertiary)] w-6 text-center">
                                                {idx + 1}
                                            </span>
                                            <select
                                                className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] flex-1"
                                                value={s.field}
                                                onChange={e => updateSort(idx, { field: e.target.value })}
                                            >
                                                {tableFields.map(tf => (
                                                    <option key={tf.name} value={tf.name}>{fieldLabel(tf.name)}</option>
                                                ))}
                                            </select>
                                            <select
                                                className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] w-32"
                                                value={s.direction}
                                                onChange={e => updateSort(idx, { direction: e.target.value })}
                                            >
                                                <option value="asc">{t('view.asc', 'Ascendent')}</option>
                                                <option value="desc">{t('view.desc', 'Descendent')}</option>
                                            </select>
                                            <div className="flex">
                                                <button
                                                    onClick={() => moveSort(idx, -1)}
                                                    disabled={idx === 0}
                                                    className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1 disabled:opacity-30"
                                                    title={t('view.priority_up', 'Pujar prioritat')}
                                                >
                                                    <ArrowUp size={14} />
                                                </button>
                                                <button
                                                    onClick={() => moveSort(idx, 1)}
                                                    disabled={idx === sorts.length - 1}
                                                    className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1 disabled:opacity-30"
                                                    title={t('view.priority_down', 'Baixar prioritat')}
                                                >
                                                    <ArrowDown size={14} />
                                                </button>
                                            </div>
                                            <button
                                                onClick={() => removeSort(idx)}
                                                className="text-[var(--text-tertiary)] hover:text-red-500 p-1"
                                                title={t('view.delete', 'Eliminar')}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {error && (
                        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                            {error}
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex justify-end gap-3 rounded-b-xl shrink-0">
                    <button
                        onClick={() => onClose(false)}
                        disabled={saving}
                        className="px-4 py-2 border border-[var(--border-primary)] rounded-lg text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] transition-colors"
                    >
                        {t('common.cancel', 'Cancel·lar')}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="btn-gnosi btn-gnosi-primary px-6"
                    >
                        {saving ? t('view.saving', 'Desant...') : ((isTableMode ? editingView?.id : editingBlock) ? t('view.save_changes', 'Desar canvis') : t('view.create_view', 'Crear vista'))}
                    </button>
                </div>
            </div>
        </div>
    );
}
