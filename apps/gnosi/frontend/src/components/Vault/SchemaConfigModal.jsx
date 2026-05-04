import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { X, Plus, Trash2, Settings, GripVertical, Layers } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getFieldConfig, getFieldType, getSchemaFieldNames } from './schemaUtils';

const generateId = () => Math.random().toString(36).substr(2, 9);

const ROLLUP_AGGREGATIONS = [
    { value: 'count_all', label: 'Count all' },
    { value: 'count_values', label: 'Count values' },
    { value: 'sum', label: 'Sum' },
    { value: 'avg', label: 'Avg' },
    { value: 'min', label: 'Min' },
    { value: 'max', label: 'Max' },
    { value: 'unique_count', label: 'Unique count' },
    { value: 'percent_checked', label: '% checked' },
    { value: 'earliest', label: 'Earliest' },
    { value: 'latest', label: 'Latest' },
    { value: 'show_original', label: 'Show original' },
];

// Component fill per cada propietat arrossegable
function SortableField({ field, idx, allFields, handleUpdateField, handleRemoveField, allTables = [] }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });

    const relationFieldOptions = allFields
        .filter((candidate) => candidate.id !== field.id && candidate.type === 'relation' && candidate.name?.trim())
        .map((candidate) => candidate.name.trim());

    const targetPropertyOptions = allFields
        .filter((candidate) => candidate.id !== field.id && candidate.name?.trim())
        .map((candidate) => candidate.name.trim());

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 1,
        opacity: isDragging ? 0.9 : 1,
    };

    return (
        <div 
            ref={setNodeRef} 
            style={style} 
            className={`flex flex-col bg-[var(--bg-primary)] rounded-xl border shadow-sm transition-all duration-200 overflow-hidden ${isDragging ? 'border-[var(--gnosi-primary)] shadow-lg ring-2 ring-[var(--gnosi-primary)]/10 z-50 scale-[1.02]' : 'border-[var(--border-primary)] hover:border-[var(--text-tertiary)]/40'}`}
        >
            {/* Fila Superior: Grip, Nom, Tipus i Accions */}
            <div className={`flex items-center gap-3 p-3 ${field.type === 'title' ? 'bg-[var(--bg-secondary)]/50' : ''}`}>
                <div 
                    {...attributes} 
                    {...listeners} 
                    className={`cursor-grab active:cursor-grabbing p-1.5 rounded-md text-[var(--text-secondary)]/40 hover:text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 transition-colors ${field.name === 'title' ? 'invisible' : ''}`}
                >
                    <GripVertical size={18} />
                </div>

                <div className="flex-1 min-w-[150px]">
                    <input
                        type="text"
                        value={field.name}
                        onChange={(e) => handleUpdateField(idx, 'name', e.target.value)}
                        placeholder="Nom de propietar (ex: Data d'entrega)"
                        className="w-full text-sm font-semibold bg-transparent border-none focus:ring-0 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]/40 outline-none"
                    />
                </div>

                <div className={`w-44 ${field.type === 'title' ? 'mr-10' : ''}`}>
                    <select
                        value={field.type}
                        onChange={(e) => handleUpdateField(idx, 'type', e.target.value)}
                        className="w-full text-xs font-medium border border-[var(--border-primary)] rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 focus:border-[var(--gnosi-primary)] outline-none bg-[var(--bg-secondary)] text-[var(--text-primary)] disabled:opacity-50"
                        disabled={field.type === 'title'}
                    >
                        <option value="text">Text (Curt)</option>
                        <option value="rich_text">Text Llarg</option>
                        <option value="number">Nombre</option>
                        <option value="select">Selecció Única</option>
                        <option value="multi_select">Selecció Múltiple</option>
                        <option value="status">Estat</option>
                        <option value="date">Data</option>
                        <option value="datetime">Data i Hora</option>
                        <option value="period">Periode</option>
                        <option value="checkbox">Casella</option>
                        <option value="url">Enllaç (URL)</option>
                        <option value="zotero">Zotero</option>
                        <option value="files">Arxius</option>
                        <option value="relation">Relació (Link)</option>
                        <option value="formula">Fórmula</option>
                        <option value="rollup">Rollup</option>
                        <option value="title">Títol (Obligatori)</option>
                    </select>
                </div>

                {field.type !== 'title' && (
                    <button
                        onClick={() => handleRemoveField(idx)}
                        className="btn-gnosi-danger !p-1.5"
                        title="Eliminar propietat"
                    >
                        <Trash2 size={18} />
                    </button>
                )}
            </div>

            {/* Secció de Configuració Específica (Fórmula, Rollup, Relació) */}
            {(field.type === 'relation' || field.type === 'rollup' || field.type === 'formula') && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner">
                        {field.type === 'formula' && (
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">Expressió de la Fórmula</label>
                                <input
                                    type="text"
                                    value={field.formula || ''}
                                    onChange={(e) => handleUpdateField(idx, 'formula', e.target.value)}
                                    placeholder="Ex: {Cabal} * {Temps}"
                                    className="w-full text-sm border-none focus:ring-0 bg-transparent font-mono text-[var(--text-primary)] outline-none"
                                />
                                <p className="text-[10px] text-[var(--text-secondary)]/60 px-1 border-t border-[var(--border-primary)] pt-1">
                                    Admet camps <span className="font-mono">{'{Nom}'}</span>, <span className="font-mono">prop('X')</span>, <span className="font-mono">lookup(...)</span>.
                                </p>
                            </div>
                        )}

                        {field.type === 'rollup' && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">Relació</label>
                                    <select
                                        value={field.relationField || ''}
                                        onChange={(e) => handleUpdateField(idx, 'relationField', e.target.value)}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        <option value="">Camps de relació...</option>
                                        {relationFieldOptions.map((name) => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">Propietat Target</label>
                                    <select
                                        value={field.targetProperty || ''}
                                        onChange={(e) => handleUpdateField(idx, 'targetProperty', e.target.value)}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        <option value="">Selecciona propietat...</option>
                                        <option value="title">title</option>
                                        {targetPropertyOptions.map((name) => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1 text-xs">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">Agregació</label>
                                    <select
                                        value={field.aggregation || 'count_values'}
                                        onChange={(e) => handleUpdateField(idx, 'aggregation', e.target.value)}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        {ROLLUP_AGGREGATIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}

                        {field.type === 'relation' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">Taula Relacionada</label>
                                    <select
                                        value={field.relation_database_id || ''}
                                        onChange={(e) => handleUpdateField(idx, 'relation_database_id', e.target.value)}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md px-3 py-2 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 focus:border-[var(--gnosi-primary)] outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        <option value="">Selecciona una taula...</option>
                                        {(allTables || []).map((t) => (
                                            <option key={t.id} value={t.id}>{t.name || t.title || t.id}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">Cardinalitat de Relació</label>
                                    <select
                                        value={field.cardinality || 'one-to-many'}
                                        onChange={(e) => handleUpdateField(idx, 'cardinality', e.target.value)}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md px-3 py-2 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 focus:border-[var(--gnosi-primary)] outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        <option value="one-to-one">Un a Un (1:1)</option>
                                        <option value="one-to-many">Un a Molts (1:N)</option>
                                        <option value="many-to-many">Molts a Molts (N:N)</option>
                                    </select>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Secció de Valor per defecte */}
            {field.type !== 'title' && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)]">
                    <div className="flex gap-3 items-center px-1">
                        <div className="flex-1">
                            <input
                                type="text"
                                value={field.defaultFormula || ''}
                                onChange={(e) => handleUpdateField(idx, 'defaultFormula', e.target.value)}
                                placeholder="Valor per defecte o fórmula (ex: now())"
                                className="w-full text-[11px] font-mono bg-transparent border-none focus:ring-0 text-[var(--text-secondary)]/60 placeholder:text-[var(--text-tertiary)]/20 outline-none"
                            />
                        </div>
                        <span className="text-[10px] text-[var(--text-tertiary)]/40 italic">Default</span>
                    </div>
                </div>
            )}
        </div>
    );
}

export function SchemaConfigModal({ isOpen, onClose, folder, currentSchema, onSchemaUpdated, onSave, initialEnableSubitems = false, initialVisibleProperties = null }) {
    const [fields, setFields] = useState([]);
    const [allTables, setAllTables] = useState([]);
    const [enableSubitems, setEnableSubitems] = useState(initialEnableSubitems);

    useEffect(() => {
        if (isOpen) {
            // Transform object to array for editing.
            const fieldsArray = getSchemaFieldNames(currentSchema || {}).map((name) => ({
                id: generateId(),
                name,
                type: getFieldType(currentSchema || {}, name),
                formula: getFieldConfig(currentSchema || {}, name).formula || '',
                defaultFormula: getFieldConfig(currentSchema || {}, name).defaultFormula || '',
                relationField: getFieldConfig(currentSchema || {}, name).relationField || '',
                targetProperty: getFieldConfig(currentSchema || {}, name).targetProperty || '',
                aggregation: getFieldConfig(currentSchema || {}, name).aggregation || 'count_values',
                limit: getFieldConfig(currentSchema || {}, name).limit ?? '',
                fallbackValue: getFieldConfig(currentSchema || {}, name).fallbackValue ?? '',
                relation_database_id: getFieldConfig(currentSchema || {}, name).relation_database_id || '',
                cardinality: getFieldConfig(currentSchema || {}, name).cardinality || 'one-to-many',
                visible: initialVisibleProperties ? initialVisibleProperties.includes(name) : true
            }));
            setFields(fieldsArray);
            setEnableSubitems(initialEnableSubitems);

            // Carregar totes les taules per a les relacions
            const fetchTables = async () => {
                try {
                    const response = await axios.get('/api/vault/tables');
                    const tables = response.data?.tables || response.data || [];
                    setAllTables(tables);
                } catch (err) {
                    console.error('Error carregant taules per al modal:', err);
                }
            };
            fetchTables();
        }
    }, [isOpen, currentSchema, initialEnableSubitems, initialVisibleProperties]);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    if (!isOpen) return null;

    const handleAddField = () => {
        setFields([...fields, {
            id: generateId(),
            name: '',
            type: 'text',
            formula: '',
            defaultFormula: '',
            relationField: '',
            targetProperty: '',
            aggregation: 'count_values',
            limit: '',
            fallbackValue: '',
            relation_database_id: '',
            cardinality: 'one-to-many',
            visible: true,
        }]);
    };

    const handleUpdateField = (index, key, value) => {
        const newFields = [...fields];
        newFields[index][key] = value;
        if (key === 'type' && value !== 'formula') {
            newFields[index].formula = '';
        }
        if (key === 'type' && value !== 'rollup') {
            newFields[index].relationField = '';
            newFields[index].targetProperty = '';
            newFields[index].aggregation = 'count_values';
            newFields[index].limit = '';
            newFields[index].fallbackValue = '';
        }
        if (key === 'type' && value !== 'relation') {
            newFields[index].relation_database_id = '';
            newFields[index].cardinality = 'one-to-many';
        }
        setFields(newFields);
    };

    const handleRemoveField = (index) => {
        setFields(fields.filter((_, i) => i !== index));
    };

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (active && over && active.id !== over.id) {
            setFields((items) => {
                const oldIndex = items.findIndex(item => item.id === active.id);
                const newIndex = items.findIndex(item => item.id === over.id);
                return arrayMove(items, oldIndex, newIndex);
            });
        }
    };

    const handleSave = async () => {
        // Validate
        if (fields.some(f => !f.name.trim())) {
            toast.error("Tots els camps han de tenir un nom");
            return;
        }

        if (fields.some(f => f.type === 'formula' && !f.formula?.trim())) {
            toast.error("Les propietats de fórmula han de tenir una expressió");
            return;
        }

        if (fields.some(f => f.type === 'rollup' && !f.relationField?.trim())) {
            toast.error("Les propietats rollup han de tenir un camp de relació");
            return;
        }

        if (fields.some(f => f.type === 'rollup' && f.aggregation !== 'count_all' && !f.targetProperty?.trim())) {
            toast.error("Les propietats rollup han de tenir una propietat objectiu");
            return;
        }

        // Convert back to object
        const newSchemaObj = {};
        const visibleProperties = [];
        fields.forEach(f => {
            const cleanName = f.name.trim();
            newSchemaObj[cleanName] = f.type;
            const config = {};
            if (f.type === 'formula') {
                config.formula = f.formula.trim();
            }
            if (f.type === 'rollup') {
                config.relationField = f.relationField.trim();
                config.aggregation = (f.aggregation || 'count_values').trim();
                if (f.aggregation !== 'count_all') {
                    config.targetProperty = f.targetProperty.trim();
                }
                if (String(f.limit || '').trim()) {
                    config.limit = Number(f.limit);
                }
                if (String(f.fallbackValue || '').trim()) {
                    config.fallbackValue = f.fallbackValue;
                }
            }
            if (f.defaultFormula?.trim()) {
                config.defaultFormula = f.defaultFormula.trim();
            }
            if (f.type === 'relation') {
                if (f.relation_database_id) {
                    config.relation_database_id = f.relation_database_id;
                }
                config.cardinality = f.cardinality || 'one-to-many';
            }
            if (Object.keys(config).length > 0) {
                newSchemaObj[`${cleanName}_config`] = config;
            }
            if (f.visible) {
                visibleProperties.push(cleanName);
            }
        });

        try {
            if (onSave) {
                // Return both schema and new view settings
                await onSave(newSchemaObj, { enableSubitems, visibleProperties });
            } else {
                await axios.post(`/api/vault/schema?folder=${encodeURIComponent(folder)}`, newSchemaObj);
            }
            toast.success("Estructura actualitzada");
            onSchemaUpdated(newSchemaObj);
            onClose();
        } catch (err) {
            console.error(err);
            toast.error("Error al desar l'estructura.");
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4 font-sans backdrop-blur-sm">
            <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] border border-[var(--border-primary)]">
                {/* Header */}
                <div className="px-6 py-4 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Settings size={20} className="text-[var(--gnosi-primary)]" />
                        Gestionar Propietats de: {folder}
                    </h2>
                    <button onClick={onClose} className="text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)] transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 bg-[var(--bg-primary)]">
                    <div className="bg-[var(--bg-secondary)] p-4 rounded-lg border border-[var(--border-primary)] shadow-sm mb-6">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                            <Layers size={16} className="text-[var(--gnosi-primary)]" />
                            Configuració de la taula
                        </h3>
                        <label className="flex items-center gap-3 cursor-pointer group">
                                <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${enableSubitems ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--text-tertiary)]/20'}`}>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={enableSubitems}
                                        onChange={(e) => setEnableSubitems(e.target.checked)}
                                    />
                                    <div className={`bg-[var(--bg-primary)] w-4 h-4 rounded-full shadow-sm transform transition-transform ${enableSubitems ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                            <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
                                Permetre Subitems (Jerarquia)
                            </span>
                        </label>
                        <p className="mt-2 text-xs text-[var(--text-secondary)]/60">
                            Quan està activat, les notes que tinguin fills es podran expandir i contraure dins la taula.
                        </p>
                    </div>

                    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2 px-1">
                        Columnes i Propietats
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)]/60 mb-4 px-1">
                        Configura quines propietats apareixen i si són visibles en aquesta taula.
                    </p>

                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
                            <div className="space-y-3">
                                {fields.map((field, idx) => (
                                    <SortableField
                                        key={field.id}
                                        field={field}
                                        idx={idx}
                                        allFields={fields}
                                        allTables={allTables}
                                        handleUpdateField={handleUpdateField}
                                        handleRemoveField={handleRemoveField}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>

                    <button
                        onClick={handleAddField}
                        className="btn-gnosi btn-gnosi-primary !text-xs !py-2 !px-4 mt-5"
                    >
                        <Plus size={16} /> Afegir Propietat
                    </button>
                </div>

                <div className="px-6 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex justify-end gap-3 shrink-0">
                    <button onClick={onClose} className="px-4 py-2 border border-[var(--border-primary)] rounded-md text-sm font-bold text-[var(--text-secondary)]/60 hover:bg-[var(--bg-primary)] transition-colors">
                        Cancel·lar
                    </button>
                    <button onClick={handleSave} className="btn-gnosi btn-gnosi-primary px-6">
                        Desar Estructura
                    </button>
                </div>
            </div>
        </div>
    );
}
