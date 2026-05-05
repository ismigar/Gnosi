import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from '../../lib/toast';
import { X, Plus, Trash2, Settings, GripVertical, Layers } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getFieldConfig, getFieldType, getSchemaFieldNames } from './schemaUtils';
import { useTranslation } from 'react-i18next';

const generateId = () => Math.random().toString(36).substr(2, 9);

// ID immutable per a properties: 'fld_' + 8 hex chars. Es persisteix al
// schema de la taula i es manté entre renames del nom de camp.
const generateFieldId = () => {
    const bytes = new Uint8Array(4);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return 'fld_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
};

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

// Child component for each draggable property
function SortableField({ field, idx, allFields, handleUpdateField, handleRemoveField, allTables = [], virtualComputers = [] }) {
    const { t } = useTranslation();
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
            {/* Upper Row: Grip, Name, Type and Actions */}
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
                        placeholder={t('schema.property_name_placeholder')}
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
                        <option value="text">{t('schema.type_text')}</option>
                        <option value="rich_text">{t('schema.type_rich_text')}</option>
                        <option value="number">{t('schema.type_number')}</option>
                        <option value="select">{t('schema.type_select')}</option>
                        <option value="multi_select">{t('schema.type_multi_select')}</option>
                        <option value="status">{t('schema.type_status')}</option>
                        <option value="date">{t('schema.type_date')}</option>
                        <option value="datetime">{t('schema.type_datetime')}</option>
                        <option value="period">{t('schema.type_period')}</option>
                        <option value="checkbox">{t('schema.type_checkbox')}</option>
                        <option value="url">{t('schema.type_url')}</option>
                        <option value="zotero">Zotero</option>
                        <option value="files">{t('schema.type_files')}</option>
                        <option value="relation">{t('schema.type_relation')}</option>
                        <option value="formula">{t('schema.type_formula')}</option>
                        <option value="rollup">{t('schema.type_rollup')}</option>
                        <option value="virtual">{t('schema.type_virtual', 'Derivat')}</option>
                        <option value="title">{t('schema.type_title')}</option>
                    </select>
                </div>

                {field.type !== 'title' && (
                    <button
                        onClick={() => handleRemoveField(idx)}
                        className="btn-gnosi-danger !p-1.5"
                        title={t('schema.remove_property')}
                    >
                        <Trash2 size={18} />
                    </button>
                )}
            </div>

            {/* Files: storage folder config */}
            {field.type === 'files' && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-2">
                        <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">
                            {t('schema.storage_folder', 'Carpeta de destinació')}
                        </label>
                        <div className="flex gap-2">
                            {[
                                { value: 'assets',    label: 'Assets',    desc: t('schema.storage_assets_desc', 'Carpeta Assets del vault') },
                                { value: 'biblioteca', label: 'Biblioteca', desc: t('schema.storage_biblioteca_desc', 'Biblioteca de referència compartida') },
                                { value: 'free',      label: t('schema.storage_free', 'Lliure'), desc: t('schema.storage_free_desc', "L'usuari tria la carpeta o fitxer en cada adjunt") },
                            ].map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => handleUpdateField(idx, 'storage_folder', opt.value)}
                                    title={opt.desc}
                                    className={`flex-1 text-xs rounded-lg border px-2 py-1.5 font-semibold transition-colors ${
                                        (field.storage_folder || 'assets') === opt.value
                                            ? 'bg-[var(--gnosi-primary)] text-white border-[var(--gnosi-primary)]'
                                            : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] text-[var(--text-secondary)]/70 px-1">
                            {{
                                assets:    t('schema.storage_assets_desc', 'Carpeta Assets del vault'),
                                biblioteca: t('schema.storage_biblioteca_desc', 'Biblioteca de referència compartida (OneDrive/Biblioteca)'),
                                free:      t('schema.storage_free_desc', "L'usuari tria la carpeta de destinació o el fitxer existent en cada adjunt"),
                            }[field.storage_folder || 'assets']}
                        </p>
                    </div>
                </div>
            )}

            {/* Specific Configuration Section (Formula, Rollup, Relation, Virtual) */}
            {(field.type === 'relation' || field.type === 'rollup' || field.type === 'formula' || field.type === 'virtual') && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner">
                        {field.type === 'virtual' && (
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">
                                    {t('schema.virtual_compute', 'Computador derivat')}
                                </label>
                                <select
                                    value={field.compute || ''}
                                    onChange={(e) => handleUpdateField(idx, 'compute', e.target.value)}
                                    className="w-full text-sm bg-transparent text-[var(--text-primary)] outline-none border-none focus:ring-0"
                                >
                                    <option value="">{t('schema.virtual_pick', '— Tria un computador —')}</option>
                                    {(virtualComputers || []).map(c => (
                                        <option key={c.compute} value={c.compute}>
                                            {c.label} ({c.compute})
                                        </option>
                                    ))}
                                </select>
                                {field.compute && (
                                    <p className="text-[10px] text-[var(--text-secondary)]/80 px-1 border-t border-[var(--border-primary)] pt-1">
                                        {(virtualComputers || []).find(c => c.compute === field.compute)?.description || ''}
                                    </p>
                                )}
                                <p className="text-[10px] text-[var(--text-secondary)]/60 px-1">
                                    {t('schema.virtual_hint', 'Camp derivat (read-only). El backend el calcula a partir del graf o altres índexs.')}
                                </p>
                            </div>
                        )}
                        {field.type === 'formula' && (
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.formula_expression')}</label>
                                <input
                                    type="text"
                                    value={field.formula || ''}
                                    onChange={(e) => handleUpdateField(idx, 'formula', e.target.value)}
                                    placeholder={t('schema.formula_placeholder')}
                                    className="w-full text-sm border-none focus:ring-0 bg-transparent font-mono text-[var(--text-primary)] outline-none"
                                />
                                <p className="text-[10px] text-[var(--text-secondary)]/60 px-1 border-t border-[var(--border-primary)] pt-1">
                                    {t('schema.formula_hint')}
                                </p>
                            </div>
                        )}

                        {field.type === 'rollup' && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.relation')}</label>
                                    <select
                                        value={field.relationField || ''}
                                        onChange={(e) => handleUpdateField(idx, 'relationField', e.target.value)}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        <option value="">{t('schema.relation_fields_placeholder')}</option>
                                        {relationFieldOptions.map((name) => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.target_property')}</label>
                                    <select
                                        value={field.targetProperty || ''}
                                        onChange={(e) => handleUpdateField(idx, 'targetProperty', e.target.value)}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        <option value="">{t('schema.select_property_placeholder')}</option>
                                        <option value="title">title</option>
                                        {targetPropertyOptions.map((name) => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1 text-xs">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.aggregation')}</label>
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
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.related_table')}</label>
                                    <select
                                        value={field.relation_database_id || ''}
                                        onChange={(e) => handleUpdateField(idx, 'relation_database_id', e.target.value)}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md px-3 py-2 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 focus:border-[var(--gnosi-primary)] outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        <option value="">{t('schema.select_table_placeholder')}</option>
                                        {(allTables || []).map((t) => (
                                            <option key={t.id} value={t.id}>{t.name || t.title || t.id}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.relation_cardinality')}</label>
                                    <select
                                        value={field.cardinality || 'one-to-many'}
                                        onChange={(e) => handleUpdateField(idx, 'cardinality', e.target.value)}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md px-3 py-2 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 focus:border-[var(--gnosi-primary)] outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        <option value="one-to-one">{t('schema.one_to_one')}</option>
                                        <option value="one-to-many">{t('schema.one_to_many')}</option>
                                        <option value="many-to-many">{t('schema.many_to_many')}</option>
                                    </select>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Default Value Section */}
            {field.type !== 'title' && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)]">
                    <div className="flex gap-3 items-center px-1">
                        <div className="flex-1">
                            <input
                                type="text"
                                value={field.defaultFormula || ''}
                                onChange={(e) => handleUpdateField(idx, 'defaultFormula', e.target.value)}
                                placeholder={t('schema.default_formula_placeholder')}
                                className="w-full text-[11px] font-mono bg-transparent border-none focus:ring-0 text-[var(--text-secondary)]/60 placeholder:text-[var(--text-tertiary)]/20 outline-none"
                            />
                        </div>
                        <span className="text-[10px] text-[var(--text-tertiary)]/40 italic">{t('schema.default_label')}</span>
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
    const [virtualComputers, setVirtualComputers] = useState([]);
    const [enableSubitems, setEnableSubitems] = useState(initialEnableSubitems);

    useEffect(() => {
        if (isOpen) {
            // Transform object to array for editing.
            const fieldsArray = getSchemaFieldNames(currentSchema || {}).map((name) => ({
                // Reusem el field_id immutable del config si existeix; en cas
                // contrari generem-ne un de nou que es persistirà al desar.
                id: getFieldConfig(currentSchema || {}, name).id || generateFieldId(),
                name,
                type: getFieldType(currentSchema || {}, name),
                formula: getFieldConfig(currentSchema || {}, name).formula || '',
                compute: getFieldConfig(currentSchema || {}, name).compute || '',
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

            // Load all tables for relations
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

            // Load virtual computers catalogue for "type: virtual" properties
            const fetchVirtualComputers = async () => {
                try {
                    const response = await axios.get('/api/vault/virtual-fields');
                    setVirtualComputers(response.data?.computers || []);
                } catch (err) {
                    console.error('Error carregant catàleg de computadors virtuals:', err);
                }
            };
            fetchVirtualComputers();
        }
    }, [isOpen, currentSchema, initialEnableSubitems, initialVisibleProperties]);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    if (!isOpen) return null;

    const handleAddField = () => {
        setFields([...fields, {
            id: generateFieldId(),
            name: '',
            type: 'text',
            formula: '',
            compute: '',
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
        if (key === 'type' && value !== 'virtual') {
            newFields[index].compute = '';
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
            toast.error(t('schema.error_name_required'));
            return;
        }

        if (fields.some(f => f.type === 'formula' && !f.formula?.trim())) {
            toast.error(t('schema.error_formula_required'));
            return;
        }

        if (fields.some(f => f.type === 'virtual' && !f.compute?.trim())) {
            toast.error(t('schema.error_compute_required', 'Cal seleccionar un computador per al camp derivat.'));
            return;
        }

        if (fields.some(f => f.type === 'rollup' && !f.relationField?.trim())) {
            toast.error(t('schema.error_relation_field_required'));
            return;
        }

        if (fields.some(f => f.type === 'rollup' && f.aggregation !== 'count_all' && !f.targetProperty?.trim())) {
            toast.error(t('schema.error_target_property_required'));
            return;
        }

        // Convert back to object
        const newSchemaObj = {};
        const visibleProperties = [];
        fields.forEach(f => {
            const cleanName = f.name.trim();
            newSchemaObj[cleanName] = f.type;
            const config = {};
            // Persisteix el field_id immutable: és la clau estable per a
            // referenciar el camp en notes, vistes, filtres i seccions.
            // No es regenera mai un cop assignat.
            if (f.id && /^fld_[0-9a-f]{8}$/.test(f.id)) {
                config.id = f.id;
            }
            if (f.type === 'formula') {
                config.formula = f.formula.trim();
            }
            if (f.type === 'virtual') {
                config.compute = f.compute.trim();
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
            toast.success(t('schema.success_updated'));
            onSchemaUpdated(newSchemaObj);
            onClose();
        } catch (err) {
            console.error(err);
            toast.error(t('schema.error_saving'));
        }
    };

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                onClose();
            } else if (e.key === 'Enter') {
                if (document.activeElement.tagName === 'INPUT') {
                   // Permetem Enter en inputs de nom de propietat etc.
                }
                handleSave();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, handleSave]);

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4 font-sans backdrop-blur-sm">
            <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] border border-[var(--border-primary)]">
                {/* Header */}
                <div className="px-6 py-4 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Settings size={20} className="text-[var(--gnosi-primary)]" />
                        {t('schema.manage_properties_of')} {folder}
                    </h2>
                    <button onClick={onClose} className="gnosi-close-btn" aria-label="Tancar">
                        <X />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 bg-[var(--bg-primary)]">
                    <div className="bg-[var(--bg-secondary)] p-4 rounded-lg border border-[var(--border-primary)] shadow-sm mb-6">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                            <Layers size={16} className="text-[var(--gnosi-primary)]" />
                            {t('schema.table_config')}
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
                                {t('schema.allow_subitems')}
                            </span>
                        </label>
                        <p className="mt-2 text-xs text-[var(--text-secondary)]/60">
                            {t('schema.subitems_hint')}
                        </p>
                    </div>

                    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2 px-1">
                        {t('schema.columns_and_properties')}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)]/60 mb-4 px-1">
                        {t('schema.columns_hint')}
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
                                        virtualComputers={virtualComputers}
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
                        <Plus size={16} /> {t('schema.add_property')}
                    </button>
                </div>

                <div className="px-6 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex justify-end gap-3 shrink-0">
                    <button onClick={onClose} className="px-4 py-2 border border-[var(--border-primary)] rounded-md text-sm font-bold text-[var(--text-secondary)]/60 hover:bg-[var(--bg-primary)] transition-colors">
                        {t('common.cancel')}
                    </button>
                    <button onClick={handleSave} className="btn-gnosi btn-gnosi-primary px-6">
                        {t('schema.save_structure')}
                    </button>
                </div>
            </div>
        </div>
    );
}
