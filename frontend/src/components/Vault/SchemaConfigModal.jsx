import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { X, Plus, Trash2, Settings, GripVertical, Eye, EyeOff, Layers } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getFieldConfig, getFieldType, getSchemaFieldNames } from './schemaUtils';

const generateId = () => Math.random().toString(36).substr(2, 9);

const getRollupAggregations = (t) => [
    { value: 'count_all', label: t('Count all') },
    { value: 'count_values', label: t('Count values') },
    { value: 'sum', label: t('Sum') },
    { value: 'avg', label: t('Avg') },
    { value: 'min', label: t('Min') },
    { value: 'max', label: t('Max') },
    { value: 'unique_count', label: t('Unique count') },
    { value: 'percent_checked', label: t('% checked') },
    { value: 'earliest', label: t('Earliest') },
    { value: 'latest', label: t('Latest') },
    { value: 'show_original', label: t('Show original') },
];

// Component fill per cada propietat arrossegable
function SortableField({ field, idx, allFields, handleUpdateField, handleRemoveField, allTables = [] }) {
    const { t } = useTranslation();
    const ROLLUP_AGGREGATIONS = getRollupAggregations(t);
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
                        placeholder={t('Property name (ex: Delivery Date)')}
                        className="w-full text-sm font-semibold bg-transparent border-none focus:ring-0 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]/40 outline-none"
                        disabled={field.type === 'title'}
                    />
                </div>

                <div className="w-44">
                    <select
                        value={field.type}
                        onChange={(e) => handleUpdateField(idx, 'type', e.target.value)}
                        className="w-full text-xs font-medium border border-[var(--border-primary)] rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 focus:border-[var(--gnosi-primary)] outline-none bg-[var(--bg-secondary)] text-[var(--text-primary)] disabled:opacity-50"
                        disabled={field.type === 'title'}
                    >
                        <option value="text">{t('Text (Short)')}</option>
                        <option value="rich_text">{t('Long Text')}</option>
                        <option value="number">{t('Number')}</option>
                        <option value="select">{t('Single Select')}</option>
                        <option value="multi_select">{t('Multi Select')}</option>
                        <option value="status">{t('Status')}</option>
                        <option value="date">{t('Date')}</option>
                        <option value="datetime">{t('Date and Time')}</option>
                        <option value="period">{t('Period')}</option>
                        <option value="checkbox">{t('Checkbox')}</option>
                        <option value="url">{t('Link (URL)')}</option>
                        <option value="zotero">{t('Zotero')}</option>
                        <option value="files">{t('Files')}</option>
                        <option value="relation">{t('Relation (Link)')}</option>
                        <option value="formula">{t('Formula')}</option>
                        <option value="rollup">{t('Rollup')}</option>
                        <option value="title">{t('Title (Mandatory)')}</option>
                    </select>
                </div>

                <button 
                    onClick={() => handleUpdateField(idx, 'visible', !field.visible)} 
                    className={`p-2 rounded-lg transition-all ${field.visible ? 'text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10' : 'text-[var(--text-secondary)]/40 hover:bg-[var(--bg-secondary)]'}`}
                    title={field.visible ? t('Visible in table') : t('Hidden in table')}
                >
                    {field.visible ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>

                <button
                    onClick={() => handleRemoveField(idx)}
                    className={`p-2 rounded-lg transition-colors ${field.type === 'title' ? 'text-[var(--text-tertiary)]/20 cursor-not-allowed' : 'btn-gnosi-danger !p-1.5'}`}
                    disabled={field.type === 'title'}
                    title={t('Delete property')}
                >
                    <Trash2 size={18} />
                </button>
            </div>

            {/* Secció de Configuració Específica (Fórmula, Rollup, Relació) */}
            {(field.type === 'relation' || field.type === 'rollup' || field.type === 'formula') && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner">
                        {field.type === 'formula' && (
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('Formula Expression')}</label>
                                <input
                                    type="text"
                                    value={field.formula || ''}
                                    onChange={(e) => handleUpdateField(idx, 'formula', e.target.value)}
                                    placeholder="Ex: {Cabal} * {Temps}"
                                    className="w-full text-sm border-none focus:ring-0 bg-transparent font-mono text-[var(--text-primary)] outline-none"
                                />
                                <p className="text-[10px] text-[var(--text-secondary)]/60 px-1 border-t border-[var(--border-primary)] pt-1">
                                    {t('Formula hint')}
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
                                        <option value="">{t('Relation fields...')}</option>
                                        {relationFieldOptions.map((name) => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('Target Property')}</label>
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
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('Aggregation')}</label>
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
                                        <option value="">{t('Select a table...')}</option>
                                        {(allTables || []).map((t) => (
                                            <option key={t.id} value={t.id}>{t.name || t.title || t.id}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('Relation Cardinality')}</label>
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
                                placeholder={t('Default value or formula (ex: now())')}
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
    const { t } = useTranslation();
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
            toast.error(t('All fields must have a name'));
            return;
        }

        if (fields.some(f => f.type === 'formula' && !f.formula?.trim())) {
            toast.error(t('Formula properties must have an expression'));
            return;
        }

        if (fields.some(f => f.type === 'rollup' && !f.relationField?.trim())) {
            toast.error(t('Rollup properties must have a relation field'));
            return;
        }

        if (fields.some(f => f.type === 'rollup' && f.aggregation !== 'count_all' && !f.targetProperty?.trim())) {
            toast.error(t('Rollup properties must have a target property'));
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
            toast.success(t('Structure updated'));
            onSchemaUpdated(newSchemaObj);
            onClose();
        } catch (err) {
            console.error(err);
            toast.error(t('Error saving structure'));
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4 font-sans backdrop-blur-sm">
            <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] border border-[var(--border-primary)]">
                {/* Header */}
                <div className="px-6 py-4 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Settings size={20} className="text-[var(--gnosi-primary)]" />
                        {t('Structure configured for: {{folder}}', { folder })}
                    </h2>
                    <button onClick={onClose} className="text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)] transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 bg-[var(--bg-primary)]">
                    <div className="bg-[var(--bg-secondary)] p-4 rounded-lg border border-[var(--border-primary)] shadow-sm mb-6">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                            <Layers size={16} className="text-[var(--gnosi-primary)]" />
                            {t('Table Configuration')}
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
                                {t('Allow Subitems (Hierarchy)')}
                            </span>
                        </label>
                        <p className="mt-2 text-xs text-[var(--text-secondary)]/60">
                            {t('Hierarchy hint')}
                        </p>
                    </div>

                    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2 px-1">
                        {t('Columns and Properties')}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)]/60 mb-4 px-1">
                        {t('Columns hint')}
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
                        <Plus size={16} /> {t('Add new Property')}
                    </button>
                </div>

                <div className="px-6 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex justify-end gap-3 shrink-0">
                    <button onClick={onClose} className="px-4 py-2 border border-[var(--border-primary)] rounded-md text-sm font-bold text-[var(--text-secondary)]/60 hover:bg-[var(--bg-primary)] transition-colors">
                        {t('Cancel')}
                    </button>
                    <button onClick={handleSave} className="btn-gnosi btn-gnosi-primary px-6">
                        {t('Save')}
                    </button>
                </div>
            </div>
        </div>
    );
}
