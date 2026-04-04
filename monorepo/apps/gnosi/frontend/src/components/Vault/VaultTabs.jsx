import React, { useState } from 'react';
import { Plus, GripVertical, Settings2, X } from 'lucide-react';

export function VaultTabs({ views, activeViewId, onViewChange, onAddView, onUpdateView }) {
    if (!views || views.length === 0) return null;

    return (
        <div className="flex items-center gap-1 overflow-x-auto px-6 py-2 border-b border-slate-200 bg-slate-50 shrink-0">
            {views.map(view => {
                const isActive = view.id === activeViewId;
                return (
                    <button
                        key={view.id}
                        onClick={() => onViewChange(view.id)}
                        className={`w-[184px] flex items-center gap-2 px-3 py-1.5 rounded-t-md text-sm font-medium transition-colors border-b-2 ${isActive ? 'border-indigo-500 text-indigo-700 bg-white shadow-sm' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100'}`}
                        title={view.name}
                    >
                        <span className="truncate flex-1 min-w-0">{view.name}</span>
                    </button>
                );
            })}

            <button
                onClick={onAddView}
                className="flex items-center justify-center w-8 h-8 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors ml-1"
                title="Afegir Vista nova"
            >
                <Plus size={18} />
            </button>
        </div>
    );
}
