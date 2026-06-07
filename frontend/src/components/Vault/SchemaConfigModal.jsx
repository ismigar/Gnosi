import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { toast } from '../../lib/toast';
import { X, Plus, Trash2, Settings, GripVertical, Layers, Languages, Zap, Tag, Globe, Loader2, Link2 } from 'lucide-react';
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

// Tipus de camp que poden marcar-se com a traduïbles. Exclou camps derivats
// (formula/rollup/virtual), camps sense contingut textual i tipus
// estructurals com `button`. El `title` sí que s'admet: el backend
// (translate_row) usa la traducció del títol com a títol del subitem.
const TRANSLATABLE_FIELD_TYPES = new Set([
    'title', 'text', 'rich_text', 'select', 'multi_select', 'status', 'url'
]);

// Catàleg d'accions que pot executar un camp de tipus `button`. Per ara
// només la traducció de fila; afegir-hi noves accions implica registrar-les
// també al backend (skills) i, si convé, a la UI.
const BUTTON_ACTIONS = [
    { id: 'translate_row', label_key: 'schema.button_action_translate_row', label_default: 'Traduir fila a subitems' },
];

// Tipus de camp que tenen un catàleg fix d'opcions triables.
const OPTION_FIELD_TYPES = new Set(['select', 'multi_select', 'status']);

// Una fila d'opció dins de l'OptionsEditor. El rename es confirma onBlur/Enter
// (no a cada tecla) perquè la cadena segueixi sent un id estable per al drag —
// així no apareixen ids duplicats transitoris mentre s'escriu.
function SortableOptionRow({ option, onRename, onRemove }) {
    const { t } = useTranslation();
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: option });
    const [draft, setDraft] = useState(option);
    useEffect(() => { setDraft(option); }, [option]);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.9 : 1,
        zIndex: isDragging ? 50 : 1,
    };

    const commit = () => {
        const next = draft.trim();
        if (!next || next === option) { setDraft(option); return; }
        onRename(option, next);
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`flex items-center gap-2 rounded-lg border bg-[var(--bg-primary)] px-2 py-1 transition-colors ${isDragging ? 'border-[var(--gnosi-primary)] shadow-md' : 'border-[var(--border-primary)]'}`}
        >
            <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 rounded text-[var(--text-tertiary)]/40 hover:text-[var(--gnosi-primary)]">
                <GripVertical size={14} />
            </div>
            <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); }
                    if (e.key === 'Escape') { e.stopPropagation(); setDraft(option); e.currentTarget.blur(); }
                }}
                className="flex-1 min-w-0 bg-transparent text-sm text-[var(--text-primary)] outline-none border-none focus:ring-0"
            />
            <button
                type="button"
                onClick={() => onRemove(option)}
                className="btn-gnosi-danger !p-1"
                title={t('common.delete', 'Elimina')}
            >
                <Trash2 size={14} />
            </button>
        </div>
    );
}

// Editor del catàleg d'opcions d'un camp select/multi_select/status. Afegir,
// reanomenar, eliminar i reordenar (drag). Viu en un DndContext propi, niat
// dins del de camps; cada draggable té el seu grip, així no es solapen.
function OptionsEditor({ options = [], onChange }) {
    const { t } = useTranslation();
    const [newOption, setNewOption] = useState('');
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const addOption = () => {
        const v = newOption.trim();
        if (!v || options.includes(v)) { setNewOption(''); return; }
        onChange([...options, v]);
        setNewOption('');
    };

    const renameOption = (oldVal, newVal) => {
        if (options.includes(newVal)) return; // silenciós: no duplicar
        onChange(options.map((o) => (o === oldVal ? newVal : o)));
    };

    const removeOption = (val) => onChange(options.filter((o) => o !== val));

    const handleDragEnd = ({ active, over }) => {
        if (active && over && active.id !== over.id) {
            const oldIndex = options.indexOf(active.id);
            const newIndex = options.indexOf(over.id);
            if (oldIndex !== -1 && newIndex !== -1) onChange(arrayMove(options, oldIndex, newIndex));
        }
    };

    return (
        <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-2">
                <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1 flex items-center gap-1.5">
                    <Tag size={12} /> {t('schema.options_label', 'Opcions')}
                </label>
                {options.length > 0 ? (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={options} strategy={verticalListSortingStrategy}>
                            <div className="space-y-1.5">
                                {options.map((opt) => (
                                    <SortableOptionRow
                                        key={opt}
                                        option={opt}
                                        onRename={renameOption}
                                        onRemove={removeOption}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                ) : (
                    <p className="text-[11px] text-[var(--text-secondary)]/60 px-1 italic">
                        {t('schema.options_empty', 'Encara no hi ha opcions. També se\'n creen automàticament en omplir registres.')}
                    </p>
                )}
                <div className="flex items-center gap-2 pt-1">
                    <input
                        type="text"
                        value={newOption}
                        onChange={(e) => setNewOption(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); addOption(); }
                            if (e.key === 'Escape') { e.stopPropagation(); setNewOption(''); }
                        }}
                        placeholder={t('schema.options_add_placeholder', 'Nova opció…')}
                        className="flex-1 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1.5 text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                    />
                    <button
                        type="button"
                        onClick={addOption}
                        disabled={!newOption.trim() || options.includes(newOption.trim())}
                        className="btn-gnosi btn-gnosi-primary !text-xs !py-1.5 !px-3 flex items-center gap-1 disabled:opacity-40"
                    >
                        <Plus size={14} /> {t('common.add', 'Afegir')}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Child component for each draggable property
function SortableField({ field, idx, allFields, handleUpdateField, handleRemoveField, allTables = [], virtualComputers = [], enableTranslation = false, enableDrupalSync = false, drupalBundle = '', drupalFields = [], drupalFieldMapping = {}, setDrupalFieldMapping = () => {} }) {
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
                        <option value="autoria">{t('schema.type_autoria', 'Autoria')}</option>
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
                        <option value="button">{t('schema.type_button', 'Botó')}</option>
                        <option value="title">{t('schema.type_title')}</option>
                    </select>
                </div>

                {enableTranslation && TRANSLATABLE_FIELD_TYPES.has(field.type) && (
                    <label
                        className="flex items-center gap-1.5 cursor-pointer select-none px-2 py-1 rounded-md hover:bg-[var(--bg-secondary)] transition-colors"
                        title={t('schema.field_translatable_hint', 'Marca aquest camp com a traduïble — el botó de traducció el processarà.')}
                    >
                        <input
                            type="checkbox"
                            checked={!!field.translatable}
                            onChange={(e) => handleUpdateField(idx, 'translatable', e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)] cursor-pointer"
                        />
                        <Languages size={13} className={field.translatable ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                        <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-secondary)]">
                            {t('schema.field_translatable', 'Traduïble')}
                        </span>
                    </label>
                )}

                {enableDrupalSync && drupalBundle && field.name?.trim() && field.type !== 'button' && !field.system && (
                    <div
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md"
                        title={t('schema.field_drupal_map_hint', 'Associa aquest camp a un camp del tipus de contingut de Drupal.')}
                    >
                        <Globe size={13} className={drupalFieldMapping[field.id] ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                        <select
                            value={drupalFieldMapping[field.id] || ''}
                            onChange={(e) => setDrupalFieldMapping((prev) => {
                                const next = { ...prev };
                                if (e.target.value) next[field.id] = e.target.value;
                                else delete next[field.id];
                                return next;
                            })}
                            className="text-xs px-2 py-1 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] max-w-[150px]"
                        >
                            <option value="">{t('schema.drupal_no_map', '— No sincronitzar —')}</option>
                            {drupalFields.map((df) => (
                                <option key={df.field_name} value={df.field_name}>{df.label} · {df.field_type}</option>
                            ))}
                        </select>
                    </div>
                )}

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

            {/* Number: format (número / moneda / percentatge + decimals) */}
            {field.type === 'number' && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-2">
                        <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1 block">
                            {t('schema.number_format', 'Format del número')}
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            <select
                                value={field.format?.kind || 'number'}
                                onChange={(e) => handleUpdateField(idx, 'format', { ...(field.format || {}), kind: e.target.value })}
                                className="text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                            >
                                <option value="number">{t('schema.number_plain', 'Número')}</option>
                                <option value="currency">{t('schema.number_currency', 'Moneda')}</option>
                                <option value="percent">{t('schema.number_percent', 'Percentatge')}</option>
                                <option value="year">{t('schema.number_year', 'Any')}</option>
                            </select>
                            {field.format?.kind !== 'year' && (
                                <input
                                    type="number"
                                    min="0"
                                    max="6"
                                    value={field.format?.decimals ?? ''}
                                    onChange={(e) => handleUpdateField(idx, 'format', { ...(field.format || {}), decimals: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                    placeholder={t('schema.number_decimals', 'Decimals')}
                                    className="text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                />
                            )}
                            {field.format?.kind === 'currency' && (
                                <select
                                    value={field.format?.currency || ''}
                                    onChange={(e) => handleUpdateField(idx, 'format', { ...(field.format || {}), currency: e.target.value })}
                                    className="text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                >
                                    <option value="">{t('schema.currency_default', 'Per defecte')}</option>
                                    <option value="EUR (€)">EUR (€)</option>
                                    <option value="USD ($)">USD ($)</option>
                                    <option value="GBP (£)">GBP (£)</option>
                                    <option value="JPY (¥)">JPY (¥)</option>
                                    <option value="CHF (₣)">CHF (₣)</option>
                                </select>
                            )}
                        </div>
                        <p className="text-[10px] text-[var(--text-secondary)]/70 px-1">
                            {t('schema.number_format_hint', "Buit/«Número» = format global de Settings. El percentatge mostra el valor tal qual amb «%». «Any» suprimeix el punt de milers (2024, no 2.024).")}
                        </p>
                    </div>
                </div>
            )}

            {/* Date/datetime: format de presentació */}
            {(field.type === 'date' || field.type === 'datetime') && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-2">
                        <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1 block">
                            {t('schema.date_format', 'Format de data')}
                        </label>
                        <select
                            value={field.format?.dateFormat || ''}
                            onChange={(e) => handleUpdateField(idx, 'format', { ...(field.format || {}), dateFormat: e.target.value || undefined })}
                            className="w-full text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                        >
                            <option value="">{t('schema.date_format_global', 'Global (Settings)')}</option>
                            <option value="locale">{t('schema.date_format_locale', "Segons l'idioma")}</option>
                            <option value="DD/MM/YYYY">DD/MM/AAAA</option>
                            <option value="MM/DD/YYYY">MM/DD/AAAA</option>
                            <option value="YYYY-MM-DD">AAAA-MM-DD (ISO)</option>
                        </select>
                    </div>
                </div>
            )}

            {/* Button: action + label config */}
            {field.type === 'button' && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-2">
                        <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1 flex items-center gap-1.5">
                            <Zap size={12} /> {t('schema.button_action', 'Acció del botó')}
                        </label>
                        <select
                            value={field.button_action || 'translate_row'}
                            onChange={(e) => handleUpdateField(idx, 'button_action', e.target.value)}
                            className="w-full text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                        >
                            {BUTTON_ACTIONS.map(action => (
                                <option key={action.id} value={action.id}>
                                    {t(action.label_key, action.label_default)}
                                </option>
                            ))}
                        </select>
                        <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1 mt-2 block">
                            {t('schema.button_label', 'Etiqueta del botó')}
                        </label>
                        <input
                            type="text"
                            value={field.button_label || ''}
                            onChange={(e) => handleUpdateField(idx, 'button_label', e.target.value)}
                            placeholder={t('schema.button_label_placeholder', 'p.ex. Traduir')}
                            className="w-full text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                        />
                        <p className="text-[10px] text-[var(--text-secondary)]/70 px-1">
                            {t('schema.button_hint', "El botó executarà l'acció seleccionada sobre la fila i, en el cas de la traducció, crearà subitems amb les traduccions.")}
                        </p>
                    </div>
                </div>
            )}

            {/* Files: storage folder config */}
            {field.type === 'files' && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-2">
                        <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">
                            {t('schema.file_mode', 'Mode')}
                        </label>
                        <div className="flex gap-2">
                            {[
                                { value: 'link', label: t('schema.file_mode_link', 'Enllaç') },
                                { value: 'upload', label: t('schema.file_mode_upload', 'Pujar') },
                            ].map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => handleUpdateField(idx, 'file_mode', opt.value)}
                                    className={`flex-1 text-xs rounded-lg border px-2 py-1.5 font-semibold transition-colors ${
                                        (field.file_mode || 'upload') === opt.value
                                            ? 'bg-[var(--gnosi-primary)] text-white border-[var(--gnosi-primary)]'
                                            : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] text-[var(--text-secondary)]/70 px-1">
                            {(field.file_mode || 'upload') === 'link'
                                ? t('schema.file_mode_link_desc', 'Enllaça un fitxer local sense copiar-lo (referència).')
                                : t('schema.file_mode_upload_desc', 'Copia el fitxer a la carpeta de destinació.')}
                        </p>

                        {(field.file_mode || 'upload') === 'upload' && (
                        <div className="pt-2 mt-1 space-y-2 border-t border-[var(--border-primary)]/50">
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

                        <div className="pt-2 mt-1 space-y-1 border-t border-[var(--border-primary)]/50">
                            <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">
                                {t('schema.name_pattern', 'Patró de nom')}
                            </label>
                            <input
                                type="text"
                                value={field.name_pattern || ''}
                                onChange={(e) => handleUpdateField(idx, 'name_pattern', e.target.value)}
                                placeholder={t('schema.name_pattern_ph', 'Ex: {Authors} - {Any} - {Títol}')}
                                className="w-full text-xs rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1.5 text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                            />
                            {allFields.filter(f => f !== field && (f.name || '').trim()).length > 0 && (
                                <div className="flex flex-wrap gap-1 px-1">
                                    {allFields.filter(f => f !== field && (f.name || '').trim()).sort((a, b) => (a.name || '').localeCompare(b.name || '')).flatMap(f => (
                                        (f.type === 'autoria' ? [`${f.name}.nom`, `${f.name}.cognom1`, `${f.name}.cognom2`] : [f.name]).map(tok => (
                                            <button
                                                key={tok}
                                                type="button"
                                                onClick={() => handleUpdateField(idx, 'name_pattern', `${field.name_pattern || ''}{${tok}}`)}
                                                className="text-[10px] rounded border border-[var(--border-primary)] px-1.5 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                                                title={t('schema.name_pattern_insert', 'Insereix el camp al patró')}
                                            >
                                                {`{${tok}}`}
                                            </button>
                                        ))
                                    ))}
                                </div>
                            )}
                            <p className="text-[10px] text-[var(--text-secondary)]/70 px-1">
                                {t('schema.name_pattern_hint', 'En pujar, el fitxer es reanomena al disc segons el patró (els camps buits s\'ometen). Per a autors: {Autor.nom}, {Autor.cognom1} i {Autor.cognom2} (i {Autor} sol, el nom complet).')}
                            </p>
                        </div>
                        </div>
                        )}
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

            {/* Options Section (select / multi_select / status) */}
            {OPTION_FIELD_TYPES.has(field.type) && (
                <OptionsEditor
                    options={field.options || []}
                    onChange={(opts) => handleUpdateField(idx, 'options', opts)}
                />
            )}

            {/* Default Value Section */}
            {field.type !== 'title' && field.type !== 'button' && (
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

export function SchemaConfigModal({ isOpen, onClose, folder, currentSchema, onSchemaUpdated, onSave, initialEnableSubitems = false, initialVisibleProperties = null, initialEnableTranslation = false, initialEnableDrupalSync = false, initialDrupalBundle = '', initialDrupalFieldMapping = null, tableId = null }) {
    const { t } = useTranslation();
    const [fields, setFields] = useState([]);
    const [allTables, setAllTables] = useState([]);
    const [virtualComputers, setVirtualComputers] = useState([]);
    const [enableSubitems, setEnableSubitems] = useState(initialEnableSubitems);
    const [enableTranslation, setEnableTranslation] = useState(initialEnableTranslation);
    // Sincronització amb Drupal (config de taula; es persisteix al registre).
    const [enableDrupalSync, setEnableDrupalSync] = useState(initialEnableDrupalSync);
    const [drupalBundle, setDrupalBundle] = useState(initialDrupalBundle || '');
    const [drupalFieldMapping, setDrupalFieldMapping] = useState(initialDrupalFieldMapping || {});
    // Catàlegs descoberts de Drupal (efímers; només alimenten els <select>).
    const [drupalContentTypes, setDrupalContentTypes] = useState([]);
    const [drupalFields, setDrupalFields] = useState([]);
    const [drupalLoading, setDrupalLoading] = useState(false);
    const [drupalError, setDrupalError] = useState('');
    const [matching, setMatching] = useState(false);
    // Guard d'inicialització: només volem sincronitzar l'estat local amb les
    // props quan el modal s'obre. Si el pare re-renderitza mentre està obert
    // (p.ex. fetchRegistry posterior a una acció no relacionada), les props
    // arriben amb noves referències i sobreescriurien edicions de l'usuari
    // que encara no ha desat (toggles, camps afegits, etc.).
    const initializedRef = useRef(false);
    // Ref per saltar-se el primer trigger d'autosave: just després de la
    // inicialització, els setters causen un re-render que faria saltar
    // l'autosave amb un payload idèntic al backend. No té sentit enviar-ho.
    const skipNextAutosaveRef = useRef(false);
    // Ref a l'element arrel del modal: hi enganxem el listener d'Esc (vegeu avall).
    const modalRef = useRef(null);
    // Ref al cos scrollable del modal: hi posem el focus en obrir perquè es
    // pugui fer scroll amb el teclat (fletxes / Re Pàg) i l'Esc funcioni.
    const scrollRef = useRef(null);
    // Desat pendent (debounce encara no disparat). El fem flush en desmuntar
    // perquè tancar (Esc/X) just després d'editar no perdi l'últim canvi.
    const pendingSaveRef = useRef(null);

    useEffect(() => {
        if (!isOpen) {
            initializedRef.current = false;
            skipNextAutosaveRef.current = false;
            return;
        }
        if (initializedRef.current) return;
        initializedRef.current = true;
        skipNextAutosaveRef.current = true;
        {
            // Transform object to array for editing.
            const fieldsArray = getSchemaFieldNames(currentSchema || {}).map((name) => {
                const cfg = getFieldConfig(currentSchema || {}, name);
                return {
                    // Reusem el field_id immutable del config si existeix; en cas
                    // contrari generem-ne un de nou que es persistirà al desar.
                    id: cfg.id || generateFieldId(),
                    name,
                    type: getFieldType(currentSchema || {}, name),
                    formula: cfg.formula || '',
                    compute: cfg.compute || '',
                    defaultFormula: cfg.defaultFormula || '',
                    relationField: cfg.relationField || '',
                    targetProperty: cfg.targetProperty || '',
                    aggregation: cfg.aggregation || 'count_values',
                    limit: cfg.limit ?? '',
                    fallbackValue: cfg.fallbackValue ?? '',
                    relation_database_id: cfg.relation_database_id || '',
                    cardinality: cfg.cardinality || 'one-to-many',
                    file_mode: cfg.file_mode || 'upload',
                    storage_folder: cfg.storage_folder || '',
                    name_pattern: cfg.name_pattern || '',
                    translatable: !!cfg.translatable,
                    system: !!cfg.system,
                    button_action: cfg.button_action || '',
                    button_label: cfg.button_label || '',
                    format: (cfg.format && typeof cfg.format === 'object') ? cfg.format : {},
                    options: Array.isArray(cfg.options) ? cfg.options : [],
                    visible: initialVisibleProperties ? initialVisibleProperties.includes(name) : true
                };
            });
            setFields(fieldsArray);
            setEnableSubitems(initialEnableSubitems);
            setEnableTranslation(initialEnableTranslation);
            setEnableDrupalSync(initialEnableDrupalSync);
            setDrupalBundle(initialDrupalBundle || '');
            setDrupalFieldMapping(initialDrupalFieldMapping || {});

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
    }, [isOpen, currentSchema, initialEnableSubitems, initialVisibleProperties, initialEnableTranslation, initialEnableDrupalSync, initialDrupalBundle, initialDrupalFieldMapping]);

    // Comprova si ja existeix un camp botó amb l'acció de traducció.
    // Tot camp `button` rep `button_action` al crear-se (handleUpdateField i
    // addTranslateButton el posen explícitament), així que la comparació
    // directa és correcta: si arribés un botó amb button_action buit, voldria
    // dir que la configuració és incompleta i el banner d'avís ha d'aparèixer.
    const hasTranslateButton = fields.some(
        (f) => f.type === 'button' && f.button_action === 'translate_row'
    );

    // Afegeix un camp `button` amb acció `translate_row` si encara no n'hi ha.
    // Tria un nom únic basat en l'etiqueta "Traduir" per evitar col·lisions amb
    // camps existents (validació silenciosa).
    const addTranslateButton = () => {
        if (hasTranslateButton) return;
        const baseName = t('schema.button_label_translate', 'Traduir');
        const usedNames = new Set(fields.map((f) => (f.name || '').trim()).filter(Boolean));
        let candidate = baseName;
        let i = 2;
        while (usedNames.has(candidate)) {
            candidate = `${baseName} ${i++}`;
        }
        setFields([...fields, {
            id: generateFieldId(),
            name: candidate,
            type: 'button',
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
            file_mode: 'upload',
            storage_folder: '',
            name_pattern: '',
            translatable: false,
            button_action: 'translate_row',
            button_label: '',
            options: [],
            visible: true,
        }]);
    };

    // En activar traducció per primera vegada, els subitems són necessaris
    // (les traduccions es desen com a fills). Si l'usuari el desactiva
    // explícitament després, respectem la seva decisió. A més, si encara no
    // hi ha cap camp `button` amb acció `translate_row`, n'afegim un perquè
    // l'usuari tingui immediatament un disparador visible a la taula.
    const handleToggleTranslation = (next) => {
        setEnableTranslation(next);
        if (next && !enableSubitems) {
            setEnableSubitems(true);
        }
        if (next) {
            addTranslateButton();
        }
    };

    // --- Sincronització amb Drupal -----------------------------------------
    // Noms de les columnes gestionades pel sistema on el sync desa el NID i
    // l'URL del node de Drupal. Read-only a la graella (config.system).
    const DRUPAL_NID_COL = t('schema.drupal_nid_column', 'Drupal NID');
    const DRUPAL_URL_COL = t('schema.drupal_url_column', 'Drupal URL');

    // Afegeix les dues columnes de sortida (NID/URL) si encara no hi són. Es
    // gestionen com a part de l'esquema (com el botó de traduir): així es
    // persisteixen via buildPayload i no les esborra l'autosave continu.
    const addDrupalColumns = () => {
        const mk = (name, type) => ({
            id: generateFieldId(), name, type,
            formula: '', compute: '', defaultFormula: '', relationField: '',
            targetProperty: '', aggregation: 'count_values', limit: '', fallbackValue: '',
            relation_database_id: '', cardinality: 'one-to-many', file_mode: 'upload',
            storage_folder: '', name_pattern: '', translatable: false, system: true,
            button_action: '', button_label: '', options: [], format: {}, visible: true,
        });
        setFields((prev) => {
            const have = new Set(prev.map((f) => (f.name || '').trim().toLowerCase()));
            const additions = [];
            if (!have.has(DRUPAL_NID_COL.toLowerCase())) additions.push(mk(DRUPAL_NID_COL, 'text'));
            if (!have.has(DRUPAL_URL_COL.toLowerCase())) additions.push(mk(DRUPAL_URL_COL, 'url'));
            return additions.length ? [...prev, ...additions] : prev;
        });
    };

    const handleToggleDrupalSync = (next) => {
        setEnableDrupalSync(next);
        if (next) addDrupalColumns();
    };

    // Vincula les files existents amb nodes de Drupal pel títol (backfill de
    // nid/url, sense crear res a Drupal). Útil per a contingut creat abans
    // d'activar la sinc, o en afegir registres nous.
    const handleMatchExisting = async () => {
        if (!tableId || !drupalBundle) return;
        setMatching(true);
        try {
            const res = await axios.post('/api/vault/skills/match-drupal-rows', { table_id: tableId, dry_run: false });
            const c = res.data?.counts || {};
            toast.success(t('schema.drupal_match_done', { matched: c.matched || 0, unmatched: c.unmatched || 0, defaultValue: '{{matched}} vinculats · {{unmatched}} sense match.' }));
        } catch (err) {
            toast.error(err.response?.data?.detail || t('schema.drupal_match_error', 'Error vinculant amb Drupal.'));
        } finally {
            setMatching(false);
        }
    };

    // Descobreix els tipus de contingut de Drupal en activar la sincronització.
    useEffect(() => {
        if (!isOpen || !enableDrupalSync || drupalContentTypes.length > 0) return;
        let cancelled = false;
        setDrupalLoading(true);
        setDrupalError('');
        axios.get('/api/vault/drupal/content-types')
            .then((res) => { if (!cancelled) setDrupalContentTypes(res.data?.content_types || []); })
            .catch((err) => { if (!cancelled) setDrupalError(err.response?.data?.detail || t('schema.drupal_load_error', "No s'ha pogut connectar amb Drupal.")); })
            .finally(() => { if (!cancelled) setDrupalLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, enableDrupalSync]);

    // Descobreix els camps del tipus de contingut triat.
    useEffect(() => {
        if (!isOpen || !enableDrupalSync || !drupalBundle) { setDrupalFields([]); return; }
        let cancelled = false;
        setDrupalLoading(true);
        setDrupalError('');
        axios.get(`/api/vault/drupal/content-types/${encodeURIComponent(drupalBundle)}/fields`)
            .then((res) => { if (!cancelled) setDrupalFields(res.data?.fields || []); })
            .catch((err) => { if (!cancelled) setDrupalError(err.response?.data?.detail || t('schema.drupal_fields_error', "No s'han pogut carregar els camps.")); })
            .finally(() => { if (!cancelled) setDrupalLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, enableDrupalSync, drupalBundle]);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

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
            file_mode: 'upload',
            storage_folder: '',
            name_pattern: '',
            translatable: false,
            button_action: '',
            button_label: '',
            options: [],
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
        if (key === 'type' && value !== 'button') {
            newFields[index].button_action = '';
            newFields[index].button_label = '';
        }
        if (key === 'type' && value === 'button') {
            // Defaults sensats: l'acció més comuna és la traducció.
            if (!newFields[index].button_action) newFields[index].button_action = 'translate_row';
            // Els botons no són traduïbles per ells mateixos.
            newFields[index].translatable = false;
        }
        if (key === 'type' && !TRANSLATABLE_FIELD_TYPES.has(value)) {
            newFields[index].translatable = false;
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

    // Validació silenciosa: retorna un missatge si cal corregir alguna cosa,
    // null si tot OK. No mostra toasts: l'estat es reflecteix a la barra
    // d'autosave del peu.
    const validate = () => {
        if (fields.some(f => !f.name.trim())) return t('schema.error_name_required');
        if (fields.some(f => f.type === 'formula' && !f.formula?.trim())) return t('schema.error_formula_required');
        if (fields.some(f => f.type === 'virtual' && !f.compute?.trim())) return t('schema.error_compute_required', 'Cal seleccionar un computador per al camp derivat.');
        if (fields.some(f => f.type === 'rollup' && !f.relationField?.trim())) return t('schema.error_relation_field_required');
        if (fields.some(f => f.type === 'rollup' && f.aggregation !== 'count_all' && !f.targetProperty?.trim())) return t('schema.error_target_property_required');
        if (fields.some(f => f.type === 'button' && !f.button_action?.trim())) return t('schema.error_button_action_required', "Cal seleccionar una acció per al camp de tipus botó.");
        if (enableTranslation && !fields.some(f => f.translatable)) return t('schema.error_no_translatable_fields', 'Si la taula és traduïble, marca almenys un camp com a traduïble.');
        return null;
    };

    // Construeix el schema serialitzable que s'envia al backend a partir de
    // l'estat local. Pres directament del bloc anterior de `handleSave`.
    const buildPayload = () => {
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
            // Columna gestionada pel sistema (Drupal NID/URL): read-only a la
            // graella. El sync n'escriu el valor; l'usuari no l'edita.
            if (f.system === true) {
                config.system = true;
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
            if (f.type === 'files') {
                if (f.file_mode) config.file_mode = f.file_mode;
                if (f.storage_folder) config.storage_folder = f.storage_folder;
                if (f.name_pattern?.trim()) config.name_pattern = f.name_pattern.trim();
            }
            if (f.type === 'button') {
                config.button_action = (f.button_action || 'translate_row').trim();
                if (f.button_label?.trim()) {
                    config.button_label = f.button_label.trim();
                }
            }
            // Format per camp (override del global): només es persisteix si té
            // valors significatius, perquè un camp sense format derivi del global.
            if (f.type === 'number' && f.format) {
                const fmt = {};
                if (f.format.kind && f.format.kind !== 'number') fmt.kind = f.format.kind;
                if (f.format.decimals != null && f.format.decimals !== '') fmt.decimals = Number(f.format.decimals);
                if (f.format.currency) fmt.currency = f.format.currency;
                if (Object.keys(fmt).length > 0) config.format = fmt;
            }
            if ((f.type === 'date' || f.type === 'datetime') && f.format?.dateFormat) {
                config.format = { ...(config.format || {}), dateFormat: f.format.dateFormat };
            }
            // Catàleg d'opcions per a select/multi_select/status. Només el
            // persistim si en queda alguna (netejant buits i duplicats); si
            // la llista queda buida, no escrivim la clau perquè el camp pugui
            // continuar derivant opcions dels valors existents.
            if (f.type === 'select' || f.type === 'multi_select' || f.type === 'status') {
                const cleaned = (Array.isArray(f.options) ? f.options : [])
                    .map((o) => String(o).trim())
                    .filter((o, i, arr) => o && arr.indexOf(o) === i);
                if (cleaned.length > 0) {
                    config.options = cleaned;
                }
            }
            // Només persistim `translatable: true` quan el camp està marcat
            // i el seu tipus el suporta. Si no, no afegim la clau.
            if (enableTranslation && f.translatable && TRANSLATABLE_FIELD_TYPES.has(f.type)) {
                config.translatable = true;
            }
            if (Object.keys(config).length > 0) {
                newSchemaObj[`${cleanName}_config`] = config;
            }
            if (f.visible) {
                visibleProperties.push(cleanName);
            }
        });
        return { newSchemaObj, visibleProperties };
    };

    // Autosave amb debounce: després d'un canvi, espera 600ms d'inactivitat,
    // valida i envia. Si la validació falla silenciosament: l'estat queda
    // sense desar fins que l'usuari completi els camps requerits. Només
    // notifiquem amb toast quan el servidor falla — els altres modals de
    // l'app també segueixen aquest patró (silenci per defecte).
    useEffect(() => {
        if (!isOpen) return;
        if (!initializedRef.current) return; // primera renderització: no autosave
        if (skipNextAutosaveRef.current) {
            // Els setters d'inicialització acaben de causar aquest trigger.
            // El payload és idèntic al backend; res a desar.
            skipNextAutosaveRef.current = false;
            return;
        }
        if (validate()) return; // validació silenciosa
        // Desa l'estat actual. El desem en un ref perquè el puguem disparar
        // també en desmuntar (flush) si el debounce encara no ha saltat.
        const doSave = async () => {
            pendingSaveRef.current = null;
            try {
                const { newSchemaObj, visibleProperties } = buildPayload();
                if (onSave) {
                    await onSave(newSchemaObj, { enableSubitems, visibleProperties, enableTranslation, enableDrupalSync, drupalBundle, drupalFieldMapping });
                } else {
                    await axios.post(`/api/vault/schema?folder=${encodeURIComponent(folder)}`, newSchemaObj);
                }
                onSchemaUpdated?.(newSchemaObj);
            } catch (err) {
                console.error(err);
                toast.error(t('schema.error_saving'));
            }
        };
        pendingSaveRef.current = doSave;
        const handle = setTimeout(doSave, 600);
        return () => clearTimeout(handle);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, fields, enableSubitems, enableTranslation, enableDrupalSync, drupalBundle, drupalFieldMapping]);

    // Flush del desat pendent en desmuntar el modal (p.ex. tancar amb Esc o la X
    // just després d'editar, abans dels 600ms del debounce). Fire-and-forget:
    // el POST es completa encara que el component ja no hi sigui. Sense això,
    // el `clearTimeout` de l'efecte d'autosave cancel·lava l'últim canvi.
    useEffect(() => {
        return () => { pendingSaveRef.current?.(); };
    }, []);

    // Tancament amb Esc — listener NATIU directament a l'element del modal (via
    // ref), no a `window`. Provat al navegador amb tecles REALS: el de `window`
    // no responia de manera fiable a la pulsació real des d'un camp de dins del
    // modal (sí amb la X), mentre que un listener a l'element sí. Deps només
    // [isOpen] per no re-vincular a cada render (el churn deixava finestres on el
    // listener no hi era). `onClose` és estable de comportament, així que el
    // capturem directament.
    useEffect(() => {
        if (!isOpen) return;
        const el = modalRef.current;
        if (!el) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
            }
        };
        el.addEventListener('keydown', handleKeyDown);
        // Focus al COS scrollable (no a l'arrel): així l'Esc funciona (el keydown
        // hi bombolla cap a `el`) i, a més, es pot fer scroll amb el teclat.
        // Donar focus a l'arrel (no scrollable) trencava el scroll amb teclat.
        scrollRef.current?.focus();
        return () => el.removeEventListener('keydown', handleKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div
            ref={modalRef}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4 font-sans backdrop-blur-sm"
        >
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

                <div ref={scrollRef} tabIndex={-1} className="p-6 overflow-y-auto flex-1 bg-[var(--bg-primary)] outline-none">
                    <div className="bg-[var(--bg-secondary)] p-4 rounded-lg border border-[var(--border-primary)] shadow-sm mb-6 space-y-4">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                            <Layers size={16} className="text-[var(--gnosi-primary)]" />
                            {t('schema.table_config')}
                        </h3>

                        <div>
                            <label
                                className={`flex items-center gap-3 group ${enableTranslation ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                                title={enableTranslation ? t('schema.subitems_locked_by_translation', 'Els subitems són necessaris per a la traducció. Desactiva primer "Taula traduïble".') : undefined}
                            >
                                <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${enableSubitems ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--text-tertiary)]/20'} ${enableTranslation ? 'opacity-60' : ''}`}>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={enableSubitems}
                                        disabled={enableTranslation}
                                        onChange={(e) => {
                                            // Bloquejat mentre la taula sigui traduïble: les
                                            // traduccions es persisteixen com a subitems.
                                            if (enableTranslation && !e.target.checked) return;
                                            setEnableSubitems(e.target.checked);
                                        }}
                                    />
                                    <div className={`bg-[var(--bg-primary)] w-4 h-4 rounded-full shadow-sm transform transition-transform ${enableSubitems ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                                <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
                                    {t('schema.allow_subitems')}
                                </span>
                            </label>
                            <p className="mt-2 text-xs text-[var(--text-secondary)]/60">
                                {enableTranslation
                                    ? t('schema.subitems_required_for_translation', 'Activat automàticament: les traduccions es desen com a subitems.')
                                    : t('schema.subitems_hint')}
                            </p>
                        </div>

                        <div className="border-t border-[var(--border-primary)] pt-4">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${enableTranslation ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--text-tertiary)]/20'}`}>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={enableTranslation}
                                        onChange={(e) => handleToggleTranslation(e.target.checked)}
                                    />
                                    <div className={`bg-[var(--bg-primary)] w-4 h-4 rounded-full shadow-sm transform transition-transform ${enableTranslation ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                                <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors flex items-center gap-1.5">
                                    <Languages size={14} className={enableTranslation ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                                    {t('schema.translation_enabled', 'Taula traduïble')}
                                </span>
                            </label>
                            <p className="mt-2 text-xs text-[var(--text-secondary)]/60">
                                {t('schema.translation_hint', 'Permet marcar camps com a traduïbles i afegir botons que generen subitems amb la traducció a altres idiomes.')}
                            </p>
                            {enableTranslation && !hasTranslateButton && (
                                <div className="mt-3 flex items-center justify-between gap-3 p-3 rounded-lg border border-[var(--gnosi-primary)]/30 bg-[var(--gnosi-primary)]/5">
                                    <p className="text-xs text-[var(--text-secondary)] flex-1">
                                        {t('schema.translate_button_missing', "Aquesta taula encara no té cap botó per disparar la traducció.")}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={addTranslateButton}
                                        className="btn-gnosi btn-gnosi-primary !px-3 !py-1.5 flex items-center gap-1.5 text-xs shrink-0"
                                    >
                                        <Plus size={12} />
                                        {t('schema.add_translate_button', 'Afegir botó de traducció')}
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="border-t border-[var(--border-primary)] pt-4">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${enableDrupalSync ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--text-tertiary)]/20'}`}>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={enableDrupalSync}
                                        onChange={(e) => handleToggleDrupalSync(e.target.checked)}
                                    />
                                    <div className={`bg-[var(--bg-primary)] w-4 h-4 rounded-full shadow-sm transform transition-transform ${enableDrupalSync ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                                <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors flex items-center gap-1.5">
                                    <Globe size={14} className={enableDrupalSync ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                                    {t('schema.drupal_sync_enabled', 'Sincronitzar amb Drupal')}
                                </span>
                            </label>
                            <p className="mt-2 text-xs text-[var(--text-secondary)]/60">
                                {t('schema.drupal_sync_hint', 'Publica els registres com a nodes de Drupal. Tria el tipus de contingut; després associa cada camp des de la llista de columnes de sota.')}
                            </p>

                            {enableDrupalSync && (
                                <div className="mt-3 space-y-3">
                                    {drupalError && (
                                        <p className="text-xs text-red-500">{drupalError}</p>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs font-medium text-[var(--text-secondary)] w-36 shrink-0">
                                            {t('schema.drupal_content_type', 'Tipus de contingut')}
                                        </label>
                                        <select
                                            value={drupalBundle}
                                            onChange={(e) => setDrupalBundle(e.target.value)}
                                            className="flex-1 text-sm px-2 py-1.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                        >
                                            <option value="">{drupalLoading && drupalContentTypes.length === 0 ? t('common.loading', 'Carregant…') : t('schema.drupal_pick_type', '— Tria un tipus —')}</option>
                                            {drupalContentTypes.map((ct) => (
                                                <option key={ct.machine} value={ct.machine}>{ct.label} ({ct.machine})</option>
                                            ))}
                                        </select>
                                    </div>

                                    {drupalBundle && (
                                        <div className="rounded-lg border border-[var(--border-primary)] overflow-hidden">
                                            <div className="px-3 py-2 bg-[var(--bg-tertiary)] text-xs font-semibold text-[var(--text-secondary)] flex items-center justify-between">
                                                <span>{t('schema.drupal_field_mapping', 'Associació de camps')}</span>
                                                <span className="text-[var(--text-tertiary)] font-normal">{t('schema.drupal_field_drupal', 'camp de Drupal')}</span>
                                            </div>
                                            <div className="divide-y divide-[var(--border-primary)]">
                                                <div className="flex items-center gap-2 px-3 py-1.5">
                                                    <span className="text-xs italic text-[var(--text-secondary)] w-36 shrink-0 truncate" title={t('schema.drupal_body_hint', 'El text Markdown del cos de la pàgina')}>{t('schema.drupal_body_field', 'Cos de la pàgina')}</span>
                                                    <span className="text-[var(--text-tertiary)] text-xs">→</span>
                                                    <select
                                                        value={drupalFieldMapping['__body__'] || ''}
                                                        onChange={(e) => setDrupalFieldMapping((prev) => {
                                                            const next = { ...prev };
                                                            if (e.target.value) next['__body__'] = e.target.value;
                                                            else delete next['__body__'];
                                                            return next;
                                                        })}
                                                        className="flex-1 text-xs px-2 py-1 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                                    >
                                                        <option value="">{t('schema.drupal_no_map', '— No sincronitzar —')}</option>
                                                        {drupalFields.map((df) => (
                                                            <option key={df.field_name} value={df.field_name}>{df.label} · {df.field_type}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="px-3 py-2 text-[11px] text-[var(--text-secondary)]/60">
                                                    {t('schema.drupal_perfield_note', "L'associació de cada camp es configura a la llista de columnes de sota, al costat de cada camp.")}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {drupalBundle && tableId && (
                                        <button
                                            type="button"
                                            onClick={handleMatchExisting}
                                            disabled={matching}
                                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                                            title={t('schema.drupal_match_hint', 'Cerca per títol nodes ja existents a Drupal i n\'omple el NID/URL a les files (no crea res).')}
                                        >
                                            {matching ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
                                            {t('schema.drupal_match_existing', 'Vincular registres existents per títol')}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

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
                                        enableTranslation={enableTranslation}
                                        enableDrupalSync={enableDrupalSync}
                                        drupalBundle={drupalBundle}
                                        drupalFields={drupalFields}
                                        drupalFieldMapping={drupalFieldMapping}
                                        setDrupalFieldMapping={setDrupalFieldMapping}
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

            </div>
        </div>
    );
}
