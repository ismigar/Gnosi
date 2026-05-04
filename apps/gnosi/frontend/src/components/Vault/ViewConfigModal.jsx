import React, { useState, useEffect } from 'react';
import { X, Eye, EyeOff, SlidersHorizontal, ArrowUpDown, Filter, Table, LayoutGrid, Columns2, List, CalendarRange } from 'lucide-react';
import { VIEW_TYPES } from './viewConstants';
import { getSchemaFieldNames } from './schemaUtils';

const FILTER_OPERATORS = [
    { value: 'equals', label: 'és igual a' },
    { value: 'not_equals', label: 'no és igual a' },
    { value: 'contains', label: 'conté' },
    { value: 'not_contains', label: 'no conté' },
    { value: 'is_empty', label: 'és buit' },
    { value: 'is_not_empty', label: 'no és buit' },
    { value: 'greater_than', label: 'és major que' },
    { value: 'less_than', label: 'és menor que' },
];

const SORT_DIRECTIONS = [
    { value: 'asc', label: 'Ascendent (A→Z)' },
    { value: 'desc', label: 'Descendent (Z→A)' },
];

const CARD_SIZE_OPTIONS = [
    { value: 'small', label: 'Petit' },
    { value: 'medium', label: 'Mitjà' },
    { value: 'large', label: 'Gran' },
];

const GALLERY_PREVIEW_OPTIONS = [
    { value: 'none', label: 'Cap' },
    { value: 'cover', label: 'Portada (imatge)' },
    { value: 'text', label: 'Text del document' },
];



const TABS = [
    { id: 'appearance', label: 'Aparença', icon: SlidersHorizontal },
    { id: 'properties', label: 'Propietats', icon: Eye },
    { id: 'filters', label: 'Filtres', icon: Filter },
    { id: 'sort', label: 'Ordenació', icon: ArrowUpDown },
];

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
    initialTab,
    onSave,
}) {
    const [activeTab, setActiveTab] = useState(initialTab || 'properties');
    const [visibleProperties, setVisibleProperties] = useState([]);
    const [cardSize, setCardSize] = useState(initialCardSize || 'medium');
    const [galleryPreview, setGalleryPreview] = useState(initialGalleryPreview || 'none');
    const [filters, setFilters] = useState([]);
    const [sorts, setSorts] = useState([]);
    const [currentViewType, setCurrentViewType] = useState(viewType || 'table');
    const allFields = schema ? getSchemaFieldNames(schema) : [];

    useEffect(() => {
        if (isOpen) {
            setActiveTab(initialTab || 'properties');
            setVisibleProperties(initialVisibleProperties || allFields);
            setCardSize(initialCardSize || 'medium');
            setGalleryPreview(initialGalleryPreview || 'none');
            setFilters(initialFilters || []);
            setSorts(initialSorts || []);
            setCurrentViewType(viewType || 'table');
        }
    }, [isOpen, initialTab, initialVisibleProperties, initialCardSize, initialGalleryPreview, initialFilters, initialSorts, viewType]);

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

    const handleSave = () => {
        onSave({
            visibleProperties,
            cardSize,
            galleryPreview,
            filters,
            sort: sorts,
            type: currentViewType,
        });
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4 font-sans backdrop-blur-sm">
            <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh] border border-[var(--border-primary)]">
                {/* Header */}
                <div className="px-5 py-4 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <SlidersHorizontal size={18} className="text-[var(--gnosi-primary)]" />
                        Configurar Vista
                    </h2>
                    <button onClick={onClose} className="text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)] transition-colors p-1 rounded-md hover:bg-[var(--bg-secondary)]">
                        <X size={18} />
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
                            <p className="text-xs text-[var(--text-secondary)]/60 mb-3">Selecciona les columnes visibles en aquesta vista.</p>
                            {allFields.map(field => (
                                <div key={field} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer" onClick={() => toggleProperty(field)}>
                                    <span className="text-sm text-[var(--text-primary)] font-medium capitalize">{field}</span>
                                    <button className={`p-1.5 rounded-md transition-colors ${visibleProperties.includes(field) ? 'text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10' : 'text-[var(--text-secondary)]/40 bg-[var(--bg-secondary)]'}`}>
                                        {visibleProperties.includes(field) ? <Eye size={16} /> : <EyeOff size={16} />}
                                    </button>
                                </div>
                            ))}
                            {allFields.length === 0 && <p className="text-sm text-[var(--text-secondary)]/60 text-center py-8">No hi ha propietats configurades.</p>}
                        </div>
                    )}

                    {/* Filtres */}
                    {activeTab === 'filters' && (
                        <div className="space-y-3">
                            <p className="text-xs text-[var(--text-secondary)]/60 mb-3">Mostra només els registres que compleixin les condicions.</p>
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
                                            placeholder="Valor..."
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
                                + Afegir filtre
                            </button>
                        </div>
                    )}

                    {/* Ordenació */}
                    {activeTab === 'sort' && (
                        <div className="space-y-3">
                            <p className="text-xs text-[var(--text-secondary)]/60 mb-3">Defineix l'ordre en que es mostren els registres.</p>
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
                                + Afegir ordenació
                            </button>
                        </div>
                    )}

                    {/* Aparença (Format / Disseny) */}
                    {activeTab === 'appearance' && (
                        <div className="space-y-6">
                            <div>
                                <label className="block text-xs font-bold text-[var(--text-secondary)]/60 mb-3 uppercase tracking-wider">Format de la vista</label>
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
                                        <label className="block text-xs font-bold text-[var(--text-secondary)]/60 mb-3 uppercase tracking-wider">Mida de la targeta</label>
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
                                        <label className="block text-xs font-bold text-[var(--text-secondary)]/60 mb-3 uppercase tracking-wider">Previsualització del contingut</label>
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
                                        Les opcions de disseny de Kanban es configuren directament des de les preferències de la columna a la vista del tauler.
                                    </p>
                                </div>
                            )}

                            {(currentViewType === 'table' || currentViewType === 'timeline' || currentViewType === 'list') && (
                                <div className="p-4 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg animate-in fade-in duration-200">
                                    <p className="text-xs text-[var(--text-secondary)]/60 text-center italic">
                                        Aquest format no requereix configuracions addicionals de disseny.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex justify-end gap-3 shrink-0">
                    <button onClick={onClose} className="px-4 py-2 border border-[var(--border-primary)] rounded-lg text-sm font-semibold text-[var(--text-secondary)]/60 hover:bg-[var(--bg-primary)] transition-colors">
                        Cancel·lar
                    </button>
                    <button onClick={handleSave} className="btn-gnosi btn-gnosi-primary px-8">
                        Aplicar
                    </button>
                </div>
            </div>
        </div>
    );
}
