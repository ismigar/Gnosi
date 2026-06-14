import React, { useState, useEffect, useRef } from 'react';
import { X, Eye, EyeOff, SlidersHorizontal, ArrowUpDown, Filter } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../lib/toast';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { VIEW_TYPES } from './viewConstants';
import { getSchemaFieldNames, normalizeSorts } from './schemaUtils';

export function ViewConfigModal({
    isOpen,
    onClose,
    schema,
    initialVisibleProperties,
    viewType,
    initialCardSize,
    initialGalleryPreview,
    initialFilters,
    initialSorts,
    initialResultSnapshot,
    initialResultSnapshotLimit,
    initialTab,
    onSave,
}) {
    const { t } = useTranslation();

    const FILTER_OPERATORS = [
        { value: 'equals', label: t('view_config.operators.equals') },
        { value: 'not_equals', label: t('view_config.operators.not_equals') },
        { value: 'contains', label: t('view_config.operators.contains') },
        { value: 'not_contains', label: t('view_config.operators.not_contains') },
        { value: 'is_empty', label: t('view_config.operators.is_empty') },
        { value: 'is_not_empty', label: t('view_config.operators.is_not_empty') },
        { value: 'greater_than', label: t('view_config.operators.greater_than') },
        { value: 'less_than', label: t('view_config.operators.less_than') },
    ];

    const SORT_DIRECTIONS = [
        { value: 'asc', label: t('view_config.sort_directions.asc') },
        { value: 'desc', label: t('view_config.sort_directions.desc') },
    ];

    const CARD_SIZE_OPTIONS = [
        { value: 'small', label: t('view_config.sizes.small') },
        { value: 'medium', label: t('view_config.sizes.medium') },
        { value: 'large', label: t('view_config.sizes.large') },
    ];

    const GALLERY_PREVIEW_OPTIONS = [
        { value: 'none', label: t('view_config.previews.none') },
        { value: 'cover', label: t('view_config.previews.cover') },
        { value: 'text', label: t('view_config.previews.text') },
    ];

    const TABS = [
        { id: 'appearance', label: t('view_config.tab_appearance'), icon: SlidersHorizontal },
        { id: 'properties', label: t('view_config.tab_properties'), icon: Eye },
        { id: 'filters', label: t('view_config.tab_filters'), icon: Filter },
        { id: 'sort', label: t('view_config.tab_sort'), icon: ArrowUpDown },
    ];

    const [activeTab, setActiveTab] = useState(initialTab || 'properties');
    const [visibleProperties, setVisibleProperties] = useState([]);
    const [cardSize, setCardSize] = useState(initialCardSize || 'medium');
    const [galleryPreview, setGalleryPreview] = useState(initialGalleryPreview || 'none');
    const [filters, setFilters] = useState([]);
    const [sorts, setSorts] = useState([]);
    const [resultSnapshot, setResultSnapshot] = useState(true);
    const [resultSnapshotLimit, setResultSnapshotLimit] = useState(500);
    const [currentViewType, setCurrentViewType] = useState(viewType || 'table');
    const allFields = schema ? getSchemaFieldNames(schema) : [];
    const initializedRef = useRef(false);
    const skipNextAutosaveRef = useRef(false);
    const modalRef = useRef(null);

    useEffect(() => {
        if (!isOpen) {
            initializedRef.current = false;
            skipNextAutosaveRef.current = false;
            return;
        }
        if (initializedRef.current) return;
        initializedRef.current = true;
        skipNextAutosaveRef.current = true;
        setActiveTab(initialTab || 'properties');
        setVisibleProperties(initialVisibleProperties || allFields);
        setCardSize(initialCardSize || 'medium');
        setGalleryPreview(initialGalleryPreview || 'none');
        setFilters(initialFilters || []);
        setSorts(normalizeSorts(initialSorts));
        setResultSnapshot(initialResultSnapshot !== false);
        setResultSnapshotLimit(
            Number.isFinite(Number(initialResultSnapshotLimit)) ? Number(initialResultSnapshotLimit) : 500
        );
        setCurrentViewType(viewType || 'table');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialTab, initialVisibleProperties, initialCardSize, initialGalleryPreview, initialFilters, initialSorts, initialResultSnapshot, initialResultSnapshotLimit, viewType]);

    // Autosave silenciós (debounce 600ms). Errors via toast; sense
    // indicadors visuals — la convenció de l'app és que els modals no
    // mostrin estat de save.
    useEffect(() => {
        if (!isOpen) return;
        if (!initializedRef.current) return;
        if (skipNextAutosaveRef.current) {
            skipNextAutosaveRef.current = false;
            return;
        }
        const handle = setTimeout(() => {
            try {
                onSave?.({
                    visibleProperties,
                    cardSize,
                    galleryPreview,
                    filters,
                    sort: sorts,
                    type: currentViewType,
                    resultSnapshot,
                    resultSnapshotLimit,
                });
            } catch (err) {
                console.error(err);
                toast.error(t('errors.save_view', 'Error en desar la vista'));
            }
        }, 600);
        return () => clearTimeout(handle);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, visibleProperties, cardSize, galleryPreview, filters, sorts, resultSnapshot, resultSnapshotLimit, currentViewType]);

    // Modal de configuració amb autosave i sense botó "Desa" (els canvis es
    // persisteixen sols): NOMÉS Esc + focus-trap, sense onConfirm. Veure
    // useModalKeyboard.
    useModalKeyboard({
        isOpen,
        onClose,
        containerRef: modalRef,
        trapFocus: true,
    });

    if (!isOpen) return null;

    const toggleProperty = (field) => {
        setVisibleProperties(prev =>
            prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]
        );
    };

    const addFilter = () => {
        setFilters(prev => [...prev, { id: Date.now(), field: allFields[0] || '', operator: 'contains', value: '' }]);
    };

    const updateFilter = (id, key, value) => {
        setFilters(prev => prev.map(f => f.id === id ? { ...f, [key]: value } : f));
    };

    const removeFilter = (id) => {
        setFilters(prev => prev.filter(f => f.id !== id));
    };

    const addSort = () => {
        setSorts(prev => [...prev, { id: Date.now(), field: allFields[0] || '', direction: 'asc' }]);
    };

    const updateSort = (id, key, value) => {
        setSorts(prev => prev.map(s => s.id === id ? { ...s, [key]: value } : s));
    };

    const removeSort = (id) => {
        setSorts(prev => prev.filter(s => s.id !== id));
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4 font-sans backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div ref={modalRef} onMouseDown={(e) => e.stopPropagation()} className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh] border border-[var(--border-primary)]">
                {/* Header */}
                <div className="px-5 py-4 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <SlidersHorizontal size={18} className="text-[var(--gnosi-primary)]" />
                        {t('view_config.title')}
                    </h2>
                    <button onClick={onClose} className="gnosi-close-btn" aria-label="Tancar">
                        <X />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-[var(--border-primary)] bg-[var(--bg-primary)] shrink-0">
                    {TABS.map(tab => {
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-3 text-xs font-semibold transition-colors border-b-2 ${
                                    activeTab === tab.id
                                        ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10'
                                        : 'border-transparent text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                                }`}
                            >
                                <Icon size={14} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-5 bg-[var(--bg-primary)]">
                    {/* Propietats */}
                    {activeTab === 'properties' && (
                        <div className="space-y-2">
                            <p className="text-xs text-[var(--text-secondary)]/60 mb-3">{t('view_config.properties_desc')}</p>
                            {allFields.map(field => (
                                <div key={field} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer" onClick={() => toggleProperty(field)}>
                                    <span className="text-sm text-[var(--text-primary)] font-medium capitalize">{field}</span>
                                    <button className={`p-1.5 rounded-md transition-colors ${visibleProperties.includes(field) ? 'text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10' : 'text-[var(--text-secondary)]/40 bg-[var(--bg-secondary)]'}`}>
                                        {visibleProperties.includes(field) ? <Eye size={16} /> : <EyeOff size={16} />}
                                    </button>
                                </div>
                            ))}
                            {allFields.length === 0 && <p className="text-sm text-[var(--text-secondary)]/60 text-center py-8">{t('view_config.no_properties')}</p>}
                        </div>
                    )}

                    {/* Filtres */}
                    {activeTab === 'filters' && (
                        <div className="space-y-3">
                            <p className="text-xs text-[var(--text-secondary)]/60 mb-3">{t('view_config.filters_desc')}</p>
                            {filters.map(filter => (
                                <div key={filter.id} className="flex items-center gap-2 bg-[var(--bg-secondary)] p-2 rounded-lg border border-[var(--border-primary)]">
                                    <select
                                        value={filter.field}
                                        onChange={e => updateFilter(filter.id, 'field', e.target.value)}
                                        className="flex-1 text-xs border border-[var(--border-primary)] rounded-md px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)] outline-none"
                                    >
                                        {allFields.map(f => <option key={f} value={f}>{f}</option>)}
                                    </select>
                                    <select
                                        value={filter.operator}
                                        onChange={e => updateFilter(filter.id, 'operator', e.target.value)}
                                        className="flex-1 text-xs border border-[var(--border-primary)] rounded-md px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)] outline-none"
                                    >
                                        {FILTER_OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                                    </select>
                                    {!['is_empty', 'is_not_empty'].includes(filter.operator) && (
                                        <input
                                            type="text"
                                            value={filter.value}
                                            onChange={e => updateFilter(filter.id, 'value', e.target.value)}
                                            placeholder={t('view_config.value_placeholder')}
                                            className="flex-1 text-xs border border-[var(--border-primary)] rounded-md px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)] outline-none"
                                        />
                                    )}
                                    <button onClick={() => removeFilter(filter.id)} className="p-1 btn-gnosi-danger !p-1 !rounded-md">
                                        <X size={14} />
                                    </button>
                                </div>
                            ))}
                            <button
                                onClick={addFilter}
                                className="btn-gnosi btn-gnosi-primary !text-xs !py-1.5 w-full mt-2"
                            >
                                {t('view_config.add_filter')}
                            </button>
                        </div>
                    )}

                    {/* Ordenació */}
                    {activeTab === 'sort' && (
                        <div className="space-y-3">
                            <p className="text-xs text-[var(--text-secondary)]/60 mb-3">{t('view_config.sort_desc')}</p>
                            {sorts.map(sort => (
                                <div key={sort.id} className="flex items-center gap-2 bg-[var(--bg-secondary)] p-2 rounded-lg border border-[var(--border-primary)]">
                                    <select
                                        value={sort.field}
                                        onChange={e => updateSort(sort.id, 'field', e.target.value)}
                                        className="flex-1 text-xs border border-[var(--border-primary)] rounded-md px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)] outline-none"
                                    >
                                        {allFields.map(f => <option key={f} value={f}>{f}</option>)}
                                    </select>
                                    <select
                                        value={sort.direction}
                                        onChange={e => updateSort(sort.id, 'direction', e.target.value)}
                                        className="flex-1 text-xs border border-[var(--border-primary)] rounded-md px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)] outline-none"
                                    >
                                        {SORT_DIRECTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                                    </select>
                                    <button onClick={() => removeSort(sort.id)} className="p-1 btn-gnosi-danger !p-1 !rounded-md">
                                        <X size={14} />
                                    </button>
                                </div>
                            ))}
                            <button
                                onClick={addSort}
                                className="btn-gnosi btn-gnosi-primary !text-xs !py-1.5 w-full mt-2"
                            >
                                {t('view_config.add_sort')}
                            </button>
                        </div>
                    )}

                    {/* Aparença (Format / Disseny) */}
                    {activeTab === 'appearance' && (
                        <div className="space-y-6">
                            <div>
                                <label className="block text-xs font-bold text-[var(--text-secondary)]/60 mb-3 uppercase tracking-wider">{t('view_config.view_format')}</label>
                                <div className="grid grid-cols-5 gap-2">
                                    {VIEW_TYPES.map(opt => {
                                        const Icon = opt.icon;
                                        return (
                                            <button
                                                key={opt.id}
                                                onClick={() => setCurrentViewType(opt.id)}
                                                className={`flex flex-col items-center justify-center gap-2 p-3 rounded-lg border transition-all ${
                                                    currentViewType === opt.id
                                                        ? 'bg-[var(--gnosi-primary)]/10 border-[var(--gnosi-primary)] text-[var(--gnosi-primary)]'
                                                        : 'bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-secondary)]/60 hover:border-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                                                }`}
                                            >
                                                <Icon size={20} />
                                                <span className="text-[10px] font-bold uppercase">{opt.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="h-px bg-[var(--border-primary)]" />

                            {currentViewType === 'gallery' && (
                                <div className="space-y-5 animate-in fade-in slide-in-from-top-1 duration-200">
                                    <div>
                                        <label className="block text-xs font-bold text-[var(--text-secondary)]/60 mb-3 uppercase tracking-wider">{t('view_config.card_size')}</label>
                                        <div className="flex gap-2">
                                            {CARD_SIZE_OPTIONS.map(opt => (
                                                <button
                                                    key={opt.value}
                                                    onClick={() => setCardSize(opt.value)}
                                                    className={`flex-1 py-2 text-xs font-semibold rounded-md border transition-colors ${cardSize === opt.value ? 'bg-[var(--gnosi-primary)] text-white border-[var(--gnosi-primary)]' : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]'}`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-[var(--text-secondary)]/60 mb-3 uppercase tracking-wider">{t('view_config.preview_content')}</label>
                                        <select
                                            value={galleryPreview}
                                            onChange={e => setGalleryPreview(e.target.value)}
                                            className="w-full text-sm border border-[var(--border-primary)] rounded-md px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)] outline-none"
                                        >
                                            {GALLERY_PREVIEW_OPTIONS.map(opt => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            )}

                            {currentViewType === 'board' && (
                                <div className="p-4 bg-[var(--gnosi-primary)]/5 border border-[var(--gnosi-primary)]/20 rounded-lg animate-in fade-in slide-in-from-top-1 duration-200">
                                    <p className="text-xs text-[var(--text-secondary)]/80 leading-relaxed italic text-center">
                                        {t('view_config.kanban_hint')}
                                    </p>
                                </div>
                            )}

                            {(currentViewType === 'table' || currentViewType === 'timeline' || currentViewType === 'list') && (
                                <div className="p-4 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg animate-in fade-in duration-200">
                                    <p className="text-xs text-[var(--text-secondary)]/60 text-center italic">
                                        {t('view_config.no_extra_config')}
                                    </p>
                                </div>
                            )}

                            <div className="h-px bg-[var(--border-primary)]" />

                            {/* Portabilitat: snapshot de wikilinks al markdown (per a
                                Obsidian/Drupal/lectors plans). Aplica a tots els tipus. */}
                            <div>
                                <label className="block text-xs font-bold text-[var(--text-secondary)]/60 mb-3 uppercase tracking-wider">
                                    {t('view_config.portability', 'Portabilitat')}
                                </label>
                                <div
                                    className="flex items-start justify-between gap-3 py-2 px-3 rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer"
                                    onClick={() => setResultSnapshot(v => !v)}
                                >
                                    <div className="min-w-0">
                                        <div className="text-sm text-[var(--text-primary)]">
                                            {t('view_config.result_snapshot', 'Desa els enllaços de resultats al markdown')}
                                        </div>
                                        <div className="text-xs text-[var(--text-secondary)]/60 mt-0.5">
                                            {t('view_config.result_snapshot_hint', 'Escriu una llista [[Títol|id]] de les pàgines que la vista retorna, perquè Obsidian i altres lectors hi puguin navegar.')}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={resultSnapshot}
                                        onClick={(e) => { e.stopPropagation(); setResultSnapshot(v => !v); }}
                                        className={`shrink-0 mt-0.5 relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${resultSnapshot ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--bg-tertiary)] border border-[var(--border-primary)]'}`}
                                    >
                                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${resultSnapshot ? 'translate-x-4' : 'translate-x-1'}`} />
                                    </button>
                                </div>
                                {resultSnapshot && (
                                    <div className="flex items-center justify-between gap-3 py-2 px-3 mt-1 animate-in fade-in duration-150">
                                        <label htmlFor="result-snapshot-limit" className="text-sm text-[var(--text-secondary)]">
                                            {t('view_config.result_snapshot_limit', 'Màxim d\'enllaços')}
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                id="result-snapshot-limit"
                                                type="number"
                                                min="0"
                                                step="50"
                                                value={resultSnapshotLimit}
                                                onChange={(e) => {
                                                    const n = parseInt(e.target.value, 10);
                                                    setResultSnapshotLimit(Number.isFinite(n) && n >= 0 ? n : 0);
                                                }}
                                                className="w-24 text-sm border border-[var(--border-primary)] rounded-md px-2 py-1 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)] outline-none text-right"
                                            />
                                            <span className="text-xs text-[var(--text-secondary)]/60 whitespace-nowrap">
                                                {t('view_config.result_snapshot_unlimited', '0 = sense límit')}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
