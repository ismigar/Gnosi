import { useState, useEffect, useMemo, useRef } from 'react';
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

const TABS = [
    { id: 'properties', icon: Eye, label: 'Camps' },
    { id: 'filters', icon: Filter, label: 'Filtres' },
    { id: 'sort', icon: ArrowUpDown, label: 'Ordenació' },
    { id: 'general', icon: SlidersHorizontal, label: 'General' },
];

export function PageViewModal({ isOpen, onClose, pageId, allTables = [], apiFetch, preselectedTableId = '', editingBlock = null }) {
    const { t } = useTranslation();

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
            .map(p => ({ name: p.name, type: p.type }));
        props.unshift({ name: 'title', type: 'title' });
        return props;
    }, [selectedTable]);

    useEffect(() => {
        if (!isOpen) return;
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
        setSaveToTableViews(true);
        setSelectedExistingViewId('');
        setExistingViews([]);
        setViewUsage({ count: 0, pages: [] });
        setEditScope('shared');
        setError('');
    }, [isOpen, preselectedTableId, editingBlock]);

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

    const addFilter = () => {
        const firstField = tableFields[0]?.name || 'title';
        setFilters(prev => [...prev, { field: firstField, operator: 'equals', value: '' }]);
    };

    const updateFilter = (idx, patch) => {
        setFilters(prev => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
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

    const handleSave = async () => {
        if (!sourceTableId) {
            setError('Cal seleccionar una taula origen');
            setActiveTab('general');
            return;
        }
        if (visibleProperties.length === 0) {
            setError('Cal almenys un camp visible');
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
                    filters: cleanFilters,
                    sorts: cleanSorts,
                    visibleProperties,
                });
                const oldPropsJson = JSON.stringify({
                    filters: original?.filters || [],
                    sorts: original?.sorts || (original?.sort ? [original.sort] : []),
                    visibleProperties: original?.visibleProperties || ['title'],
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
                    cardSize: 'medium',
                    galleryPreview: 'none',
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
            setError(e?.message || 'Error desconegut en crear la vista');
        } finally {
            setSaving(false);
        }
    };

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
                        {editingBlock
                            ? t('page_view.title_edit', 'Edita la vista de BD')
                            : t('page_view.title', 'Afegir vista de BD')}
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
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* Body */}
                <div className="p-5 space-y-4 overflow-y-auto flex-1">
                    {activeTab === 'general' && (
                        <>
                            <div>
                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Taula origen</label>
                                <select
                                    className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                    value={sourceTableId}
                                    onChange={e => setSourceTableId(e.target.value)}
                                >
                                    <option value="">— Selecciona taula —</option>
                                    {allTables.map(tbl => (
                                        <option key={tbl.id} value={tbl.id}>{tbl.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">Tipus de vista</label>
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
                                                title={vt.label}
                                            >
                                                <Icon size={18} />
                                                <span className="text-[10px] font-semibold">{vt.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {sourceTableId && (
                                <div>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                                        Vista existent
                                    </label>
                                    <select
                                        className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                        value={selectedExistingViewId}
                                        onChange={e => setSelectedExistingViewId(e.target.value)}
                                        disabled={loadingExistingViews}
                                    >
                                        <option value="">
                                            {loadingExistingViews
                                                ? 'Carregant vistes…'
                                                : '— Crear nova vista —'}
                                        </option>
                                        {existingViews.map(v => (
                                            <option key={v.id} value={v.id}>
                                                {v.name || '(sense nom)'} {v.type ? `· ${v.type}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                    {selectedExistingViewId && (
                                        <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                                            Pots revisar / sobreescriure els camps a les pestanyes Camps, Filtres i Ordenació.
                                        </p>
                                    )}
                                </div>
                            )}

                            {selectedExistingViewId && viewUsage.count > 0 && (
                                <div className="border-t border-[var(--border-primary)] pt-4">
                                    <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
                                        Aquesta vista ja s'usa a {viewUsage.count} pàgina{viewUsage.count > 1 ? 's' : ''}.
                                    </p>
                                    <p className="text-[11px] text-[var(--text-tertiary)] mb-3">
                                        Si modifiques els camps, tria com aplicar-ho:
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
                                                    Aplicar canvis a totes les pàgines
                                                </span>
                                                <span className="text-[11px] text-[var(--text-tertiary)]">
                                                    La vista compartida s'actualitza i tots els embeds reflecteixen els canvis.
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
                                                    Aplicar només a aquesta pàgina
                                                </span>
                                                <span className="text-[11px] text-[var(--text-tertiary)]">
                                                    Desconnecta aquest embed de la vista compartida i guarda una còpia local. Les altres pàgines no canvien.
                                                </span>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            )}

                            {!selectedExistingViewId && (
                                <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={saveToTableViews}
                                            onChange={e => setSaveToTableViews(e.target.checked)}
                                            className="rounded border-[var(--border-primary)]"
                                        />
                                        <span className="text-sm text-[var(--text-primary)]">
                                            Desa també a les vistes de la taula
                                        </span>
                                    </label>
                                    {saveToTableViews && (
                                        <div className="ml-6">
                                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                                                Nom de la vista
                                            </label>
                                            <input
                                                className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)] outline-none"
                                                value={viewName}
                                                onChange={e => setViewName(e.target.value)}
                                                placeholder="ex: Contactes clau"
                                            />
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    {activeTab === 'properties' && (
                        <div>
                            <p className="text-xs text-[var(--text-secondary)] mb-3">
                                Selecciona els camps a mostrar com a columnes.
                            </p>
                            {!selectedTable ? (
                                <p className="text-sm text-[var(--text-tertiary)] italic">
                                    Selecciona primer una taula a la pestanya General.
                                </p>
                            ) : (
                                <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
                                    {tableFields.map(f => (
                                        <label
                                            key={f.name}
                                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-tertiary)] cursor-pointer"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={visibleProperties.includes(f.name)}
                                                onChange={() => toggleProperty(f.name)}
                                                className="rounded border-[var(--border-primary)]"
                                            />
                                            <span className="text-sm text-[var(--text-primary)] flex-1">{f.name}</span>
                                            <span className="text-[10px] text-[var(--text-tertiary)] uppercase">{f.type || ''}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'filters' && (
                        <div>
                            <div className="flex justify-between items-center mb-3">
                                <p className="text-xs text-[var(--text-secondary)]">
                                    Tots els filtres es combinen amb AND. Valor "this" = ID d'aquesta pàgina.
                                </p>
                                <button
                                    onClick={addFilter}
                                    disabled={!selectedTable}
                                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/20 disabled:opacity-40"
                                >
                                    <Plus size={12} />
                                    Afegir filtre
                                </button>
                            </div>
                            {!selectedTable ? (
                                <p className="text-sm text-[var(--text-tertiary)] italic">Selecciona primer una taula.</p>
                            ) : filters.length === 0 ? (
                                <p className="text-sm text-[var(--text-tertiary)] italic">Cap filtre. Es mostraran totes les files.</p>
                            ) : (
                                <div className="space-y-2">
                                    {filters.map((f, idx) => {
                                        const noValue = ['is_empty', 'is_not_empty'].includes(f.operator);
                                        return (
                                            <div key={idx} className="flex gap-2 items-center">
                                                <select
                                                    className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] flex-1"
                                                    value={f.field}
                                                    onChange={e => updateFilter(idx, { field: e.target.value })}
                                                >
                                                    {tableFields.map(tf => (
                                                        <option key={tf.name} value={tf.name}>{tf.name}</option>
                                                    ))}
                                                </select>
                                                <select
                                                    className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] w-32"
                                                    value={f.operator}
                                                    onChange={e => updateFilter(idx, { operator: e.target.value })}
                                                >
                                                    {FILTER_OPERATORS.map(op => (
                                                        <option key={op.value} value={op.value}>{op.label}</option>
                                                    ))}
                                                </select>
                                                <input
                                                    className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] w-32 disabled:opacity-40"
                                                    value={f.value || ''}
                                                    onChange={e => updateFilter(idx, { value: e.target.value })}
                                                    placeholder={noValue ? '—' : 'this o valor'}
                                                    disabled={noValue}
                                                />
                                                <button
                                                    onClick={() => removeFilter(idx)}
                                                    className="text-[var(--text-tertiary)] hover:text-red-500 p-1"
                                                    title="Eliminar"
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
                                    Ordenació amb prioritat: el primer criteri mana, els següents desempaten. Sense criteris, s'ordena per títol ascendent.
                                </p>
                                <button
                                    onClick={addSort}
                                    disabled={!selectedTable}
                                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/20 disabled:opacity-40"
                                >
                                    <Plus size={12} />
                                    Afegir criteri
                                </button>
                            </div>
                            {!selectedTable ? (
                                <p className="text-sm text-[var(--text-tertiary)] italic">Selecciona primer una taula.</p>
                            ) : sorts.length === 0 ? (
                                <p className="text-sm text-[var(--text-tertiary)] italic">Cap criteri. Per defecte: títol ascendent.</p>
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
                                                    <option key={tf.name} value={tf.name}>{tf.name}</option>
                                                ))}
                                            </select>
                                            <select
                                                className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] w-32"
                                                value={s.direction}
                                                onChange={e => updateSort(idx, { direction: e.target.value })}
                                            >
                                                <option value="asc">Ascendent</option>
                                                <option value="desc">Descendent</option>
                                            </select>
                                            <div className="flex">
                                                <button
                                                    onClick={() => moveSort(idx, -1)}
                                                    disabled={idx === 0}
                                                    className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1 disabled:opacity-30"
                                                    title="Pujar prioritat"
                                                >
                                                    <ArrowUp size={14} />
                                                </button>
                                                <button
                                                    onClick={() => moveSort(idx, 1)}
                                                    disabled={idx === sorts.length - 1}
                                                    className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1 disabled:opacity-30"
                                                    title="Baixar prioritat"
                                                >
                                                    <ArrowDown size={14} />
                                                </button>
                                            </div>
                                            <button
                                                onClick={() => removeSort(idx)}
                                                className="text-[var(--text-tertiary)] hover:text-red-500 p-1"
                                                title="Eliminar"
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
                        Cancel·lar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="btn-gnosi btn-gnosi-primary px-6"
                    >
                        {saving ? 'Desant...' : (editingBlock ? 'Desar canvis' : 'Crear vista')}
                    </button>
                </div>
            </div>
        </div>
    );
}
