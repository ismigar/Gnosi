import React, { useState } from 'react';
import { Plus, Settings, LayoutTemplate, List, Calendar as CalendarIcon, Columns, FileImage, BarChart2, Hash, Layers, Globe, MapPin, AlignLeft } from 'lucide-react';

const viewIcons = {
    table: Hash,
    list: AlignLeft,
    board: Columns,
    calendar: CalendarIcon,
    gallery: FileImage,
    timeline: Layers,
    chart: BarChart2,
    feed: Globe,
    map: MapPin,
    form: LayoutTemplate
};

const viewLabels = {
    table: 'Taula',
    list: 'Llista',
    board: 'Taulell',
    calendar: 'Calendari',
    gallery: 'Galeria',
    timeline: 'Cronograma',
    chart: 'Gràfic',
    feed: 'Feed',
    map: 'Mapa',
    form: 'Formulari'
};

export function VaultViewsTabs({ views, activeViewId, onSelectView, onAddView, onConfigureView }) {
    const [isAdding, setIsAdding] = useState(false);

    const handleAddClick = (type) => {
        setIsAdding(false);
        onAddView(type);
    };

    return (
        <div className="flex items-center w-full px-2.5 pt-1 pb-0 md:px-4 md:pt-1.5 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] relative shrink-0">
            <div className="flex items-end gap-1 overflow-x-auto custom-scrollbar flex-1 pb-0.5">
                {views.map(view => {
                    const ViewIcon = viewIcons[view.type] || Hash;
                    const isActive = activeViewId === view.id;
                    return (
                        <button
                            key={view.id}
                            onClick={() => onSelectView(view.id)}
                            className={`flex items-center gap-1 px-2 py-1 text-[11px] md:gap-1.5 md:px-2.5 md:text-xs font-medium transition-all rounded-t-md border-b-2 mr-1 ${isActive
                                ? 'text-[var(--gnosi-primary)] border-[var(--gnosi-primary)] bg-[var(--bg-primary)] shadow-[0_-2px_5px_-1px_rgba(var(--gnosi-primary-rgb),0.1)]'
                                : 'text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                }`}
                        >
                            <ViewIcon size={13} className={isActive ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                            <span className="truncate max-w-[95px] md:max-w-[120px]">{view.name}</span>
                        </button>
                    );
                })}
            </div>

            <div className="relative ml-1.5 md:ml-3 mb-1 shrink-0 flex items-center">
                {activeViewId && onConfigureView && (
                    <button
                        onClick={() => {
                            const view = views.find(v => v.id === activeViewId);
                            if (view) onConfigureView(view);
                        }}
                        className="p-1 mr-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                        title="Configurar Vista"
                    >
                        <Settings size={15} />
                    </button>
                )}
                <button
                    onClick={() => setIsAdding(!isAdding)}
                    className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    title="Afegir Vista"
                >
                    <Plus size={15} />
                </button>

                {isAdding && (
                    <>
                        <div className="fixed inset-0 z-[100]" onClick={() => setIsAdding(false)}></div>
                        <div className="absolute top-full right-0 mt-1 w-48 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-lg z-[101] py-1 animate-in fade-in zoom-in-95 duration-100 flex flex-col">
                            {Object.entries(viewLabels).map(([type, label]) => {
                                const Icon = viewIcons[type];
                                const isSupported = ['table', 'list', 'board', 'calendar', 'gallery', 'timeline', 'feed'].includes(type);
                                return (
                                    <button
                                        key={type}
                                        onClick={() => handleAddClick(type)}
                                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left ${isSupported ? 'text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]' : 'text-[var(--text-tertiary)] opacity-60 cursor-not-allowed'}`}
                                        disabled={!isSupported}
                                        title={!isSupported ? "En desenvolupament per propera iteració" : ""}
                                    >
                                        <Icon size={14} className={isSupported ? 'text-[var(--text-tertiary)]' : 'text-[var(--border-primary)]'} />
                                        <span>{label}</span>
                                        {!isSupported && <span className="ml-auto text-[10px] bg-[var(--bg-tertiary)] px-1 rounded border border-[var(--border-primary)]">Aviat</span>}
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
