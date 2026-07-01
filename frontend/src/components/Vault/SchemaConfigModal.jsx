import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { toast } from '../../lib/toast';
import { X, Plus, Trash2, Settings, GripVertical, Layers, Languages, Zap, Tag, Globe, Loader2, Link2, Send } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getFieldConfig, getFieldType, getSchemaFieldNames } from './schemaUtils';
import {
    OPTION_COLOR_PALETTE,
    normalizeOption,
    normalizeOptions,
    optionColorHex,
    seedOptionsForFeature,
} from './optionCatalogUtils';
import { ConfirmModal } from '../ConfirmModal';
import PromptModal from '../PromptModal';
import { useTranslation } from 'react-i18next';

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
// (no a cada tecla) perquè el nom segueixi sent un id estable per al drag —
// així no apareixen ids duplicats transitoris mentre s'escriu.
function SortableOptionRow({ option, fieldType, groups, usageCount, isDefault, onRename, onRemove, onSetColor, onSetGroup, onSetDefault }) {
    const { t } = useTranslation();
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: option.name });
    // La fila es remunta per key={option.name} quan l'opció es renombra, així
    // que el draft no necessita cap efecte de sincronització.
    const [draft, setDraft] = useState(option.name);
    const [paletteOpen, setPaletteOpen] = useState(false);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.9 : 1,
        zIndex: isDragging ? 50 : 1,
    };

    const commit = () => {
        const next = draft.trim();
        if (!next || next === option.name) { setDraft(option.name); return; }
        onRename(option.name, next);
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`relative flex items-center gap-2 rounded-lg border bg-[var(--bg-primary)] px-2 py-1 transition-colors ${isDragging ? 'border-[var(--gnosi-primary)] shadow-md' : 'border-[var(--border-primary)]'}`}
        >
            <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 rounded text-[var(--text-tertiary)]/40 hover:text-[var(--gnosi-primary)]">
                <GripVertical size={14} />
            </div>
            {/* Color de l'opció: punt clicable que obre la paleta. */}
            <button
                type="button"
                onClick={() => setPaletteOpen((v) => !v)}
                className="shrink-0 w-4 h-4 rounded-full border border-black/10 hover:scale-110 transition-transform"
                style={{ backgroundColor: optionColorHex(option.color) }}
                title={t('schema.option_color', "Color de l'opció")}
            />
            {paletteOpen && (
                <div className="absolute left-8 top-7 z-50 flex gap-1 p-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg">
                    {OPTION_COLOR_PALETTE.map((c) => (
                        <button
                            key={c}
                            type="button"
                            onClick={() => { onSetColor(option.name, c); setPaletteOpen(false); }}
                            className={`w-4 h-4 rounded-full border ${option.color === c ? 'ring-2 ring-[var(--gnosi-primary)] ring-offset-1' : 'border-black/10'}`}
                            style={{ backgroundColor: optionColorHex(c) }}
                            title={c}
                        />
                    ))}
                </div>
            )}
            <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); }
                    if (e.key === 'Escape') { e.stopPropagation(); setDraft(option.name); e.currentTarget.blur(); }
                }}
                className="flex-1 min-w-0 bg-transparent text-sm text-[var(--text-primary)] outline-none border-none focus:ring-0"
            />
            {typeof usageCount === 'number' && (
                <span
                    className="shrink-0 text-[10px] tabular-nums text-[var(--text-tertiary)]/70"
                    title={t('schema.option_usage', { count: usageCount, defaultValue: '{{count}} registres usen aquesta opció' })}
                >
                    {usageCount}
                </span>
            )}
            {fieldType === 'status' && (
                <select
                    value={option.group || ''}
                    onChange={(e) => onSetGroup(option.name, e.target.value)}
                    className="shrink-0 text-[10px] border border-[var(--border-primary)] rounded px-1 py-0.5 bg-[var(--bg-secondary)] text-[var(--text-secondary)] outline-none"
                    title={t('schema.option_group', 'Grup')}
                >
                    <option value="">{t('schema.option_group_none', '— grup —')}</option>
                    {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
            )}
            <button
                type="button"
                onClick={() => onSetDefault(isDefault ? '' : option.name)}
                className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${isDefault ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10' : 'border-transparent text-[var(--text-tertiary)]/50 hover:text-[var(--text-secondary)]'}`}
                title={t('schema.option_default_hint', "Opció per defecte en crear un registre")}
            >
                {t('schema.option_default', 'defecte')}
            </button>
            <button
                type="button"
                onClick={() => onRemove(option.name)}
                className="btn-gnosi-danger !p-1"
                title={t('common.delete', 'Elimina')}
            >
                <Trash2 size={14} />
            </button>
        </div>
    );
}

// Diàleg d'eliminació d'una opció amb dues sortides: buidar els valors o
// REASSIGNAR-los a una altra opció (estil Notion). Sempre amb confirmació
// (mai destructiu a la primera pulsació) i portal a body, fora del modalRef
// del pare, perquè l'Esc no tanqui tota la configuració.
function RemoveOptionDialog({ state, options, onCancel, onConfirm }) {
    const { t } = useTranslation();
    // El pare remunta el diàleg per key a cada obertura: useState arrenca net.
    const [reassignTo, setReassignTo] = useState('');
    if (!state.isOpen) return null;
    const others = options.filter((o) => o.name !== state.value);
    return createPortal(
        <div
            className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/40"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
        >
            <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl w-full max-w-md p-5 animate-in zoom-in-95 duration-150">
                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">
                    {t('schema.confirm_remove_option_title', 'Eliminar opció')}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mb-3">
                    {typeof state.usageCount === 'number' && state.usageCount > 0
                        ? t('schema.remove_option_in_use', { name: state.value, count: state.usageCount, defaultValue: "L'opció «{{name}}» l'usen {{count}} registres. Què en fem, dels seus valors?" })
                        : t('schema.remove_option_unused', { name: state.value, defaultValue: "Segur que vols eliminar l'opció «{{name}}»?" })}
                </p>
                {state.protectedReason && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
                        {state.protectedReason}
                    </p>
                )}
                {others.length > 0 && (
                    <label className="flex items-center gap-2 mb-4 text-sm text-[var(--text-secondary)]">
                        {t('schema.remove_option_reassign', 'Reassignar a')}
                        <select
                            value={reassignTo}
                            onChange={(e) => setReassignTo(e.target.value)}
                            className="flex-1 text-sm border border-[var(--border-primary)] rounded-md px-2 py-1 bg-[var(--bg-secondary)] text-[var(--text-primary)] outline-none"
                        >
                            <option value="">{t('schema.remove_option_clear', '— buidar els valors —')}</option>
                            {others.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                        </select>
                    </label>
                )}
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-md transition-colors">
                        {t('common.cancel', 'Cancel·lar')}
                    </button>
                    <button type="button" onClick={() => onConfirm(reassignTo || null)} className="btn-gnosi-danger px-3 py-1.5 text-sm rounded-md">
                        {t('schema.confirm_remove_option_confirm', 'Eliminar')}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

// Estats que les action_rules escriuen o comproven: en eliminar-los, la UI
// avisa (el motor els recrearia sol si una regla els necessita — §4.1.5).
const RULE_PROTECTED_OPTIONS = new Set([
    'Esborrany', 'Traduït', 'Publicat a Drupal', 'Publicat a XXSS',
]);

// Editor del catàleg d'opcions d'un camp select/multi_select/status. Afegir,
// reanomenar (amb reescriptura eager de les files al servidor), eliminar amb
// buidat o reassignació, reordenar (drag), color per opció, grup (status) i
// opció per defecte. Viu en un DndContext propi, niat dins del de camps.
function OptionsEditor({ options = [], onChange, fieldType = 'select', groups = [], defaultOption = '', onDefaultOptionChange, optionTools = null, fieldId = '', catalogRef = '', sharedCatalogs = {}, onLinkCatalog = null }) {
    const { t } = useTranslation();
    const [newOption, setNewOption] = useState('');
    const [usage, setUsage] = useState(null); // {nom: recompte} o null mentre carrega
    const [confirmRemove, setConfirmRemove] = useState({ isOpen: false, value: null, usageCount: null, protectedReason: '' });
    const [showNewCatalog, setShowNewCatalog] = useState(false);
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    // Amb catàleg compartit (config.catalog_ref), les opcions VIUEN al registry
    // arrel i s'editen allà (totes les taules enllaçades les veuen). Sense, són
    // locals del camp. Renombrar/eliminar arreu només està suportat per a
    // catàlegs locals (la reescriptura de files és per-taula).
    const isShared = Boolean(catalogRef);
    const richOptions = normalizeOptions(isShared ? (sharedCatalogs[catalogRef] || []) : options);
    const names = richOptions.map((o) => o.name);
    const applyChange = (next) => {
        if (isShared) optionTools?.updateSharedCatalog?.(catalogRef, next);
        else onChange(next);
    };

    // Comptador d'ús per opció (servidor). Només si el camp ja existeix al
    // registry (fieldId persistit); per a camps nous no hi ha res a comptar.
    useEffect(() => {
        let cancelled = false;
        if (!optionTools?.fetchUsage || !fieldId) return undefined;
        optionTools.fetchUsage(fieldId)
            .then((counts) => { if (!cancelled) setUsage(counts || {}); })
            .catch(() => { if (!cancelled) setUsage(null); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fieldId]);

    const addOption = () => {
        const v = newOption.trim();
        if (!v || names.includes(v)) { setNewOption(''); return; }
        applyChange([...richOptions, normalizeOption(v)]);
        setNewOption('');
    };

    const renameOption = (oldVal, newVal) => {
        if (names.includes(newVal)) return; // silenciós: no duplicar
        if (isShared) {
            // La reescriptura de files per a catàlegs compartits (multi-taula)
            // encara no està suportada: renombrar deixaria valors orfes.
            toast.error(t('schema.shared_catalog_rename_unsupported', 'Renombrar opcions d\'un catàleg compartit encara no està suportat.'));
            return;
        }
        onChange(richOptions.map((o) => (o.name === oldVal ? { ...o, name: newVal } : o)));
        if (defaultOption === oldVal) onDefaultOptionChange?.(newVal);
        // Reescriptura eager dels .md afectats (els valors es guarden per nom):
        // UNA crida al servidor, mai N PATCHes des del client.
        optionTools?.renameEverywhere?.(fieldId, oldVal, newVal, usage?.[oldVal] ?? null);
        if (usage && usage[oldVal] !== undefined) {
            setUsage((u) => {
                const next = { ...u };
                next[newVal] = (next[newVal] || 0) + next[oldVal];
                delete next[oldVal];
                return next;
            });
        }
    };

    const setColor = (name, color) => {
        applyChange(richOptions.map((o) => (o.name === name ? { ...o, color } : o)));
    };

    const setGroup = (name, group) => {
        applyChange(richOptions.map((o) => {
            if (o.name !== name) return o;
            const next = { ...o };
            if (group) next.group = group; else delete next.group;
            return next;
        }));
    };

    // Eliminar una opció la treu de TOTS els registres que la facin servir (no
    // només del catàleg) o els reassigna a una altra opció. Sempre amb
    // confirmació (accessibilitat: mai destructiu a la primera pulsació).
    const requestRemoveOption = (val) => {
        if (isShared) {
            toast.error(t('schema.shared_catalog_remove_unsupported', 'Eliminar opcions d\'un catàleg compartit encara no està suportat.'));
            return;
        }
        setConfirmRemove({
            isOpen: true,
            value: val,
            usageCount: usage ? (usage[val] || 0) : null,
            protectedReason: RULE_PROTECTED_OPTIONS.has(val)
                ? t('schema.remove_option_rule_warning', "Aquesta opció l'usen les regles d'acció (traduir/publicar); si una regla la necessita, es recrearà sola.")
                : '',
        });
    };
    const executeRemoveOption = (reassignTo) => {
        const val = confirmRemove.value;
        setConfirmRemove({ isOpen: false, value: null, usageCount: null, protectedReason: '' });
        if (val === null) return;
        onChange(richOptions.filter((o) => o.name !== val));
        if (defaultOption === val) onDefaultOptionChange?.('');
        optionTools?.removeEverywhere?.(fieldId, val, reassignTo);
        if (usage) {
            setUsage((u) => {
                const next = { ...u };
                if (reassignTo && next[val]) next[reassignTo] = (next[reassignTo] || 0) + next[val];
                delete next[val];
                return next;
            });
        }
    };

    const handleDragEnd = ({ active, over }) => {
        if (active && over && active.id !== over.id) {
            const oldIndex = names.indexOf(active.id);
            const newIndex = names.indexOf(over.id);
            if (oldIndex !== -1 && newIndex !== -1) applyChange(arrayMove(richOptions, oldIndex, newIndex));
        }
    };

    // Vincular el camp a un catàleg compartit (o desvincular-lo). En
    // desvincular, les opcions del catàleg es COPIEN com a locals perquè el
    // camp no es quedi sense catàleg.
    const handleCatalogLink = (value) => {
        if (!onLinkCatalog) return;
        if (value === '__create__') {
            setShowNewCatalog(true);
            return;
        }
        if (!value && isShared) {
            onChange(richOptions); // còpia local del catàleg compartit
            onLinkCatalog('');
            return;
        }
        if (value) onLinkCatalog(value);
    };

    const doNewCatalog = async (name) => {
        setShowNewCatalog(false);
        const clean = (name || '').trim();
        if (!clean) return;
        optionTools?.updateSharedCatalog?.(clean, richOptions);
        onLinkCatalog(clean);
    };

    return (
        <>
        <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-2">
                <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1 flex items-center gap-1.5">
                    <Tag size={12} /> {t('schema.options_label', 'Opcions')}
                    {catalogRef && (
                        <span className="normal-case tracking-normal font-medium text-[var(--text-tertiary)]">
                            · {t('schema.options_shared_catalog', { name: catalogRef, defaultValue: 'catàleg compartit «{{name}}»' })}
                        </span>
                    )}
                </label>
                {richOptions.length > 0 ? (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={names} strategy={verticalListSortingStrategy}>
                            <div className="space-y-1.5">
                                {richOptions.map((opt) => (
                                    <SortableOptionRow
                                        key={opt.name}
                                        option={opt}
                                        fieldType={fieldType}
                                        groups={groups}
                                        usageCount={usage ? (usage[opt.name] || 0) : undefined}
                                        isDefault={defaultOption === opt.name}
                                        onRename={renameOption}
                                        onRemove={requestRemoveOption}
                                        onSetColor={setColor}
                                        onSetGroup={setGroup}
                                        onSetDefault={(name) => onDefaultOptionChange?.(name)}
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
                        disabled={!newOption.trim() || names.includes(newOption.trim())}
                        className="btn-gnosi btn-gnosi-primary !text-xs !py-1.5 !px-3 flex items-center gap-1 disabled:opacity-40"
                    >
                        <Plus size={14} /> {t('common.add', 'Afegir')}
                    </button>
                </div>
                {onLinkCatalog && (
                    <div className="flex items-center gap-2 pt-1">
                        <Link2 size={12} className="text-[var(--text-tertiary)]/60" />
                        <label className="text-[10px] text-[var(--text-tertiary)]/80">
                            {t('schema.shared_catalog_label', 'Catàleg')}
                        </label>
                        <select
                            value={catalogRef || ''}
                            onChange={(e) => handleCatalogLink(e.target.value)}
                            className="text-[11px] border border-[var(--border-primary)] rounded px-1.5 py-0.5 bg-[var(--bg-secondary)] text-[var(--text-secondary)] outline-none"
                            title={t('schema.shared_catalog_hint', 'Comparteix la mateixa llista d\'opcions entre taules: editar-la en un lloc l\'actualitza pertot.')}
                        >
                            <option value="">{t('schema.shared_catalog_own', 'Propi del camp')}</option>
                            {Object.keys(sharedCatalogs).sort().map((name) => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                            <option value="__create__">{t('schema.shared_catalog_create', '+ Convertir en catàleg compartit…')}</option>
                        </select>
                    </div>
                )}
            </div>
        </div>
        <RemoveOptionDialog
            key={confirmRemove.value ?? 'closed'}
            state={confirmRemove}
            options={richOptions}
            onCancel={() => setConfirmRemove({ isOpen: false, value: null, usageCount: null, protectedReason: '' })}
            onConfirm={executeRemoveOption}
        />
        <PromptModal
            isOpen={showNewCatalog}
            onClose={() => setShowNewCatalog(false)}
            onSubmit={doNewCatalog}
            title={t('schema.shared_catalog_new_title', 'Nou catàleg compartit')}
            label={t('schema.shared_catalog_new_prompt', 'Nom del nou catàleg compartit:')}
            confirmText={t('common.create', 'Crea')}
            cancelText={t('common.cancel', 'Cancel·la')}
        />
        </>
    );
}

// Child component for each draggable property
function SortableField({ field, idx, allFields, handleUpdateField, handleRemoveField, allTables = [], currentTableName = '', virtualComputers = [], enableTranslation = false, enableDrupalSync = false, drupalBundle = '', drupalFields = [], drupalFieldMapping = {}, setDrupalFieldMapping = () => {}, optionTools = null }) {
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
                        {[
                            { value: 'text', label: t('schema.type_text') },
                            { value: 'rich_text', label: t('schema.type_rich_text') },
                            { value: 'number', label: t('schema.type_number') },
                            { value: 'select', label: t('schema.type_select') },
                            { value: 'multi_select', label: t('schema.type_multi_select') },
                            { value: 'autoria', label: t('schema.type_autoria', 'Autoria') },
                            { value: 'status', label: t('schema.type_status') },
                            { value: 'date', label: t('schema.type_date') },
                            { value: 'datetime', label: t('schema.type_datetime') },
                            { value: 'period', label: t('schema.type_period') },
                            { value: 'checkbox', label: t('schema.type_checkbox') },
                            { value: 'url', label: t('schema.type_url') },
                            { value: 'zotero', label: 'Zotero' },
                            { value: 'files', label: t('schema.type_files') },
                            { value: 'image', label: t('schema.type_image', 'Imatge') },
                            { value: 'relation', label: t('schema.type_relation') },
                            { value: 'formula', label: t('schema.type_formula') },
                            { value: 'rollup', label: t('schema.type_rollup') },
                            { value: 'virtual', label: t('schema.type_virtual', 'Derivat') },
                            { value: 'created_time', label: t('schema.type_created_time', 'Creat el') },
                            { value: 'last_edited_time', label: t('schema.type_last_edited_time', 'Editat el') },
                            { value: 'created_by', label: t('schema.type_created_by', 'Creat per') },
                            { value: 'last_edited_by', label: t('schema.type_last_edited_by', 'Editat per') },
                            { value: 'button', label: t('schema.type_button', 'Botó') },
                            { value: 'title', label: t('schema.type_title') },
                        ]
                            .sort((a, b) => a.label.localeCompare(b.label))
                            .map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
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
                            {/* Fallback: si Drupal no respon (p. ex. 436), mostra igualment
                                el valor guardat perquè el mapping no sembli perdut. */}
                            {drupalFieldMapping[field.id] && !drupalFields.some((df) => df.field_name === drupalFieldMapping[field.id]) && (
                                <option value={drupalFieldMapping[field.id]}>{drupalFieldMapping[field.id]}</option>
                            )}
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
                                {(() => {
                                    const relatedTable = (allTables || []).find(tt => tt.id === field.relation_database_id);
                                    const relatedName = relatedTable ? (relatedTable.name || relatedTable.title || relatedTable.id) : '';
                                    const srcName = currentTableName || '';
                                    // Etiqueta llegible: "[Taula actual] <cardinalitat> [Taula relacionada]".
                                    // Ex: "Recursos molts a un Àrees" = cada recurs pertany a una àrea, però una àrea té molts recursos.
                                    const cardLabel = (key) => {
                                        const base = t(`schema.${key}`);
                                        if (srcName && relatedName) return `${srcName} ${base.toLowerCase()} ${relatedName}`;
                                        return base;
                                    };
                                    return (
                                        <div className="space-y-1">
                                            <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.relation_cardinality')}</label>
                                            <select
                                                value={field.cardinality || 'one-to-many'}
                                                onChange={(e) => handleUpdateField(idx, 'cardinality', e.target.value)}
                                                className="w-full text-xs border border-[var(--border-primary)] rounded-md px-3 py-2 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 focus:border-[var(--gnosi-primary)] outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                            >
                                                <option value="one-to-one">{cardLabel('one_to_one')}</option>
                                                <option value="one-to-many">{cardLabel('one_to_many')}</option>
                                                <option value="many-to-one">{cardLabel('many_to_one')}</option>
                                                <option value="many-to-many">{cardLabel('many_to_many')}</option>
                                            </select>
                                        </div>
                                    );
                                })()}
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
                    fieldType={field.type}
                    groups={Array.isArray(field.rawConfig?.option_groups) && field.rawConfig.option_groups.length > 0 ? field.rawConfig.option_groups : ['Inicial', 'En curs', 'Final']}
                    defaultOption={field.defaultOption || ''}
                    onDefaultOptionChange={(name) => handleUpdateField(idx, 'defaultOption', name)}
                    optionTools={optionTools}
                    fieldId={field.id || ''}
                    catalogRef={field.catalogRef || ''}
                    sharedCatalogs={optionTools?.sharedCatalogs || {}}
                    onLinkCatalog={(name) => handleUpdateField(idx, 'catalogRef', name)}
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

export function SchemaConfigModal({ isOpen, onClose, folder, tableName = '', currentSchema, onSchemaUpdated, onSave, initialEnableSubitems = false, initialVisibleProperties = null, initialEnableTranslation = false, initialEnableDrupalSync = false, initialDrupalBundle = '', initialDrupalFieldMapping = null, tableId = null }) {
    const { t } = useTranslation();
    const [fields, setFields] = useState([]);
    const [allTables, setAllTables] = useState([]);
    const [virtualComputers, setVirtualComputers] = useState([]);
    const [enableSubitems, setEnableSubitems] = useState(initialEnableSubitems);
    const [enableTranslation, setEnableTranslation] = useState(initialEnableTranslation);
    // Catàlegs compartits d'opcions ({nom: [{name,color,group}…]}).
    const [sharedCatalogs, setSharedCatalogs] = useState({});
    // Sincronització amb Drupal (config de taula; es persisteix al registre).
    const [enableDrupalSync, setEnableDrupalSync] = useState(initialEnableDrupalSync);
    const [drupalBundle, setDrupalBundle] = useState(initialDrupalBundle || '');
    const [drupalFieldMapping, setDrupalFieldMapping] = useState(initialDrupalFieldMapping || {});
    // Publicació a XXSS: el senyal viu a l'esquema (columna `system` "XXSS"),
    // com Drupal. L'estat del toggle es deriva de l'esquema en obrir (no és un prop).
    const [enableSocialPublish, setEnableSocialPublish] = useState(false);
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
                    // Catàleg ric: normalitza strings llegats a {name,color,group}.
                    options: normalizeOptions(cfg.options),
                    defaultOption: cfg.default_option || '',
                    catalogRef: cfg.catalog_ref || '',
                    // Config CRU del registry: buildPayload hi arrenca per fer
                    // round-trip de claus que la UI no gestiona (role,
                    // option_groups…) — sense això, cada desat les esborrava.
                    rawConfig: cfg,
                    visible: initialVisibleProperties ? initialVisibleProperties.includes(name) : true
                };
            });
            setFields(fieldsArray);
            setEnableSubitems(initialEnableSubitems);
            setEnableTranslation(initialEnableTranslation);
            setEnableDrupalSync(initialEnableDrupalSync);
            setDrupalBundle(initialDrupalBundle || '');
            setDrupalFieldMapping(initialDrupalFieldMapping || {});
            setEnableSocialPublish(fieldsArray.some((f) => f.system && /xxss|social/i.test(f.name || '')));

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

            // Catàlegs compartits d'opcions (registry arrel `option_catalogs`).
            const fetchSharedCatalogs = async () => {
                try {
                    const response = await axios.get('/api/vault/option-catalogs');
                    setSharedCatalogs(response.data?.catalogs || {});
                } catch (err) {
                    console.error('Error carregant catàlegs compartits:', err);
                }
            };
            fetchSharedCatalogs();

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
    // Confirmació centrada (ConfirmModal estàndard del projecte) en DESACTIVAR
    // un toggle amb conseqüències. Abans s'usava window.confirm; ara fem servir
    // el modal del mig de la pantalla, coherent amb la resta de la UI.
    const [toggleConfirm, setToggleConfirm] = useState({ isOpen: false, title: '', message: '', confirmText: '', onConfirm: null });
    const closeToggleConfirm = () => setToggleConfirm((s) => ({ ...s, isOpen: false }));
    const requestDisableConfirm = ({ title, message, confirmText, onConfirm }) => {
        setToggleConfirm({ isOpen: true, title, message, confirmText, onConfirm });
    };

    // Eines de servidor per a l'editor d'opcions. Sense tableId (taula encara
    // no persistida al registry) queden desactivades i tot el CRUD és local.
    const optionTools = {
        sharedCatalogs,
        fetchUsage: tableId ? async (fieldId) => {
            const res = await axios.get(`/api/vault/tables/${tableId}/options/usage`, { params: { field_id: fieldId } });
            return res.data?.counts || {};
        } : null,
        renameEverywhere: tableId ? async (fieldId, oldVal, newVal) => {
            if (!fieldId) return;
            try {
                const res = await axios.post(`/api/vault/tables/${tableId}/options/rename`, { field_id: fieldId, old: oldVal, new: newVal });
                const n = res.data?.files_changed ?? 0;
                if (n > 0) toast.success(t('schema.option_renamed', { count: n, defaultValue: '{{count}} registres actualitzats' }));
            } catch (err) {
                toast.error(err.response?.data?.detail || t('schema.option_rename_error', "No s'ha pogut renombrar l'opció als registres"));
            }
        } : null,
        removeEverywhere: tableId ? async (fieldId, value, reassignTo) => {
            if (!fieldId) return;
            try {
                const res = await axios.post(`/api/vault/tables/${tableId}/options/remove`, { field_id: fieldId, value, reassign_to: reassignTo || undefined });
                const n = res.data?.files_changed ?? 0;
                if (n > 0) toast.success(t('schema.option_removed_rows', { count: n, defaultValue: '{{count}} registres actualitzats' }));
            } catch (err) {
                toast.error(err.response?.data?.detail || t('schema.option_remove_error', "No s'ha pogut eliminar l'opció dels registres"));
            }
        } : null,
        updateSharedCatalog: async (name, options) => {
            try {
                const res = await axios.put(`/api/vault/option-catalogs/${encodeURIComponent(name)}`, { options });
                setSharedCatalogs((prev) => ({ ...prev, [name]: res.data?.options || options }));
            } catch (err) {
                toast.error(err.response?.data?.detail || t('schema.shared_catalog_save_error', "No s'ha pogut desar el catàleg compartit"));
            }
        },
    };

    // Seed-on-enable (mirall de ensure_status_seed del backend, per a UX
    // immediata): en activar Traduir/Drupal/XXSS, el camp amb rol `status`
    // rep les opcions base i la de la funcionalitat. El servidor ho torna a
    // garantir en desar — això només estalvia esperar l'autosave+refetch.
    const seedStatusOptions = (feature) => {
        setFields((prev) => {
            const isStatusField = (f) =>
                OPTION_FIELD_TYPES.has(f.type) && f.type !== 'multi_select' && (
                    f.rawConfig?.role === 'status' ||
                    ['estat', 'estado', 'status', 'state'].includes(String(f.name || '').trim().toLowerCase())
                );
            const idx = prev.findIndex(isStatusField);
            if (idx === -1) return prev;
            const f = prev[idx];
            if (f.catalogRef) return prev;
            const current = normalizeOptions(f.options);
            const have = new Set(current.map((o) => o.name));
            const additions = [...seedOptionsForFeature('base'), ...seedOptionsForFeature(feature)]
                .filter((o) => !have.has(o.name));
            if (additions.length === 0) return prev;
            const next = [...prev];
            next[idx] = { ...f, options: [...current, ...additions] };
            return next;
        });
    };

    const handleToggleTranslation = (next) => {
        if (!next && enableTranslation && fields.some((f) => f.translatable)) {
            requestDisableConfirm({
                title: t('schema.translation_disable_title', 'Desactivar traducció'),
                message: t('schema.translation_disable_confirm', "Vols desactivar la traducció d'aquesta taula? Les traduccions ja creades es conserven, però la taula deixarà de ser traduïble."),
                confirmText: t('schema.disable', 'Desactivar'),
                onConfirm: () => setEnableTranslation(false),
            });
            return;
        }
        setEnableTranslation(next);
        if (next && !enableSubitems) {
            setEnableSubitems(true);
        }
        if (next) {
            addTranslateButton();
            seedStatusOptions('translation');
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
        // En desactivar, demana confirmació (modal centrat) si hi ha un mapeig
        // configurat: així un clic accidental (amb autosave actiu) no deixa la
        // taula sense sincronitzar sense avís. El mapeig es conserva al backend.
        if (!next && enableDrupalSync && Object.keys(drupalFieldMapping || {}).length > 0) {
            requestDisableConfirm({
                title: t('schema.drupal_sync_disable_title', 'Desactivar sincronització amb Drupal'),
                message: t('schema.drupal_sync_disable_confirm', 'Vols desactivar la sincronització amb Drupal? El mapeig de camps es conservarà per si la tornes a activar.'),
                confirmText: t('schema.disable', 'Desactivar'),
                onConfirm: () => setEnableDrupalSync(false),
            });
            return;
        }
        setEnableDrupalSync(next);
        if (next) {
            addDrupalColumns();
            seedStatusOptions('drupal');
        }
    };

    // Columna `system` que marca la taula com a publicable a XXSS. La seva
    // presència és el senyal que fa aparèixer el botó "Publicar a XXSS" (com les
    // columnes de Drupal). Es persisteix amb l'esquema via l'autosave de `fields`.
    const SOCIAL_PUBLISH_COL = t('schema.social_column', 'XXSS');
    const addSocialPublishColumns = () => {
        setFields((prev) => {
            const have = new Set(prev.map((f) => (f.name || '').trim().toLowerCase()));
            if (have.has(SOCIAL_PUBLISH_COL.toLowerCase())) return prev;
            return [...prev, {
                id: generateFieldId(), name: SOCIAL_PUBLISH_COL, type: 'text',
                formula: '', compute: '', defaultFormula: '', relationField: '',
                targetProperty: '', aggregation: 'count_values', limit: '', fallbackValue: '',
                relation_database_id: '', cardinality: 'one-to-many', file_mode: 'upload',
                storage_folder: '', name_pattern: '', translatable: false, system: true,
                button_action: '', button_label: '', options: [], format: {}, visible: true,
            }];
        });
    };

    // Retira la columna `system` de XXSS de l'esquema. Mateix criteri de
    // detecció que l'estat inicial (system + nom xxss/social), perquè en
    // reobrir el modal el toggle no torni a derivar-se com a actiu.
    const removeSocialPublishColumns = () => {
        setFields((prev) => prev.filter((f) => !(f.system && /xxss|social/i.test(f.name || ''))));
    };

    const handleToggleSocialPublish = (next) => {
        if (!next && enableSocialPublish) {
            requestDisableConfirm({
                title: t('schema.social_disable_title', 'Desactivar publicació a XXSS'),
                message: t('schema.social_publish_disable_confirm', { col: SOCIAL_PUBLISH_COL, defaultValue: "Vols desactivar la publicació a XXSS? S'eliminarà la columna «{{col}}» de l'esquema i la taula deixarà de ser publicable a les xarxes socials." }),
                confirmText: t('schema.disable', 'Desactivar'),
                onConfirm: () => { setEnableSocialPublish(false); removeSocialPublishColumns(); },
            });
            return;
        }
        setEnableSocialPublish(next);
        if (next) {
            addSocialPublishColumns();
            seedStatusOptions('social');
        }
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
        if (key === 'type' && value === 'status' && normalizeOptions(newFields[index].options).length === 0) {
            // Un camp `status` nounat arrenca amb el catàleg base (decisió §9.1).
            newFields[index].options = seedOptionsForFeature('base');
        }
        setFields(newFields);
    };

    // Confirmació abans d'eliminar una propietat: el botó de paperera no ha de
    // ser destructiu a la primera pulsació (accessibilitat — evita esborrats
    // accidentals per tremolor/distonia). Desem índex i nom per mostrar-lo al diàleg.
    const [confirmRemoveField, setConfirmRemoveField] = useState({ isOpen: false, index: null, name: '' });

    const handleRemoveField = (index) => {
        const name = fields[index]?.name?.trim() || t('schema.untitled_property', 'sense nom');
        setConfirmRemoveField({ isOpen: true, index, name });
    };

    const executeRemoveField = () => {
        if (confirmRemoveField.index !== null) {
            setFields((curr) => curr.filter((_, i) => i !== confirmRemoveField.index));
        }
        setConfirmRemoveField({ isOpen: false, index: null, name: '' });
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

    // Claus de config que la UI gestiona explícitament: buildPayload les
    // esborra del config cru abans de re-escriure-les des de l'estat local.
    // La resta (role, option_groups, …) fan round-trip intactes.
    const MANAGED_CONFIG_KEYS = [
        'id', 'system', 'formula', 'compute', 'relationField', 'targetProperty',
        'aggregation', 'limit', 'fallbackValue', 'defaultFormula',
        'relation_database_id', 'cardinality', 'file_mode', 'storage_folder',
        'name_pattern', 'button_action', 'button_label', 'format', 'options',
        'translatable', 'default_option', 'catalog_ref',
    ];

    // Construeix el schema serialitzable que s'envia al backend a partir de
    // l'estat local. Pres directament del bloc anterior de `handleSave`.
    const buildPayload = () => {
        const newSchemaObj = {};
        const visibleProperties = [];
        fields.forEach(f => {
            const cleanName = f.name.trim();
            newSchemaObj[cleanName] = f.type;
            // Round-trip del config del registry: les claus que la UI no
            // gestiona (role, option_groups…) es conserven tal qual.
            const config = { ...(f.rawConfig || {}) };
            for (const k of MANAGED_CONFIG_KEYS) delete config[k];
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
            // Catàleg d'opcions per a select/multi_select/status, en format
            // ric {name,color,group}. Amb `catalog_ref` (catàleg compartit)
            // les opcions viuen al registry arrel i NO es persisteixen al
            // camp. Si la llista queda buida, no escrivim la clau perquè el
            // camp pugui continuar derivant opcions dels valors existents.
            if (OPTION_FIELD_TYPES.has(f.type)) {
                const catalogRef = String(f.catalogRef || '').trim();
                if (catalogRef) {
                    config.catalog_ref = catalogRef;
                } else {
                    const cleaned = normalizeOptions(f.options);
                    if (cleaned.length > 0) {
                        config.options = cleaned;
                    }
                }
                const def = String(f.defaultOption || '').trim();
                if (def && (catalogRef || normalizeOptions(f.options).some((o) => o.name === def))) {
                    config.default_option = def;
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

    // Bandera global mentre el modal és obert: VaultTable la mira per
    // desactivar la navegació de cel·les de la graella. Sense això, amb una
    // cel·la activa, el handler de la graella (a window) es quedava CADA
    // fletxa (movia el cursor sota el modal i el preventDefault matava el
    // scroll natiu del cos) i, amb focus al <body>, una lletra o ⌫ editava o
    // buidava cel·les a cegues sota el modal.
    useEffect(() => {
        if (!isOpen) return;
        document.body.classList.add('gnosi-modal-open');
        return () => document.body.classList.remove('gnosi-modal-open');
    }, [isOpen]);

    // Scroll amb teclat sempre viu dins del modal. El navegador només scrolla
    // l'ancestre scrollable de l'element ENFOCAT, i aquí el focus es perd
    // contínuament: un clic a la capçalera/marc/backdrop el deixa al <body>
    // (i aquells keydown ni bombollegen per modalRef: per això el listener va
    // a document), i un clic "a dins" gairebé sempre cau en un camp, que es
    // queda el focus. Política segons on és el focus:
    //  - body o cromada del modal: totes les tecles de scroll, també Home/End;
    //  - inputs de text (el gruix del modal): fletxes i Re/Av Pàg scrollegen
    //    (amb preventDefault el caret no es mou), però Home/End i les tecles
    //    amb Maj (selecció) queden per al caret; els tipus d'input on les
    //    fletxes SÍ fan feina (number, date, radio…) no es toquen;
    //  - select, textarea i contenteditable: no es toca res (semàntica pròpia);
    //  - nanses de dnd-kit ([aria-roledescription]): no es toca res, que el
    //    drag amb teclat (Espai + fletxes) és seu — per això l'espai tampoc
    //    no es gestiona enlloc (activa botons);
    //  - resta (cos scrollable inclòs): scrollem NOSALTRES amb preventDefault.
    //    No deleguem mai al scroll natiu: verificat en viu que, fins i tot amb
    //    el focus al cos i l'event net de preventDefault, Chrome no scrollava
    //    (i amb el nostre preventDefault, mai no hi pot haver scroll doble);
    //  - focus en un altre overlay (ConfirmModal niat): no es toca res.
    useEffect(() => {
        if (!isOpen) return;
        const FLETXES_DEL_CONTROL = new Set(['number', 'range', 'date', 'time', 'datetime-local', 'month', 'week', 'radio']);
        const handler = (e) => {
            if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            const main = scrollRef.current;
            if (!main) return;
            const t = e.target;
            const focusAlBody = t === document.body || t === document.documentElement;
            const dinsDelModal = t instanceof Element && modalRef.current?.contains(t);
            if (!focusAlBody && !dinsDelModal) return;
            // Esc amb focus al <body> (clic a la cromada): el listener d'Esc de
            // modalRef no veu aquests events (no hi bombollegen). Pels de dins
            // del modal no passem mai d'aquí: aquell listener fa stopPropagation.
            if (e.key === 'Escape' && focusAlBody) {
                onClose();
                return;
            }
            if (dinsDelModal && t.closest('[aria-roledescription]')) return; // nansa dnd-kit
            let nomesVerticals = false;
            const control = dinsDelModal ? t.closest('select, textarea, input, [contenteditable="true"]') : null;
            if (control) {
                const esInputDeText = control.tagName === 'INPUT' && !FLETXES_DEL_CONTROL.has(control.type);
                if (!esInputDeText) return;
                nomesVerticals = true; // Home/End queden per al caret
            }
            const pagina = main.clientHeight * 0.9;
            const salts = { ArrowDown: 48, ArrowUp: -48, PageDown: pagina, PageUp: -pagina };
            if (e.key in salts) {
                main.scrollBy({ top: salts[e.key] });
            } else if (e.key === 'Home' && !nomesVerticals) {
                main.scrollTo({ top: 0 });
            } else if (e.key === 'End' && !nomesVerticals) {
                main.scrollTo({ top: main.scrollHeight });
            } else {
                return;
            }
            e.preventDefault();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Fix scroll (Mac+Chrome): els <select>/<input>/<textarea> natius absorbeixen
    // el wheel quan el cursor hi és a sobre i el cos del modal no scrolleja. Com
    // que aquest modal és ple de controls (camps + mapping de Drupal), redirigim
    // el wheel al cos scrollable. Mateix patró que GlobalSettingsModal.
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e) => {
            if (e.ctrlKey || e.metaKey) return; // respecta pinch/zoom
            const t = e.target;
            const main = scrollRef.current;
            if (!t || !t.closest || !main || !main.contains(t)) return;
            const tag = t.tagName;
            if (tag !== 'SELECT' && tag !== 'INPUT' && tag !== 'TEXTAREA') return;
            // textarea amb scroll propi: deixa que el gestioni ella mateixa
            if (tag === 'TEXTAREA' && t.scrollHeight > t.clientHeight + 1) return;
            if (main.scrollHeight > main.clientHeight) {
                main.scrollTop += e.deltaY;
                e.preventDefault();
            }
        };
        document.addEventListener('wheel', handler, { passive: false, capture: true });
        return () => document.removeEventListener('wheel', handler, { capture: true });
    }, [isOpen]);

    if (!isOpen) return null;

    // Portal a document.body: quan aquest modal s'obre des de dins del modal de
    // Configuració global, l'ancestre `.settings-modal` té un `transform` (que fa
    // que el nostre `fixed inset-0` es resolgui contra ESE caixa, no el viewport) i
    // `.settings-main` és `overflow-y:auto` amb el seu propi handler de wheel en
    // captura → el scroll amb el cursor se l'enduia el panell de fons. Renderitzant
    // al body escapem d'aquell context (igual que el popover intern d'aquest fitxer).
    return createPortal(
        <>
        <div
            ref={modalRef}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[10001] p-4 font-sans backdrop-blur-sm"
        >
            <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] border border-[var(--border-primary)]">
                {/* Header */}
                <div className="px-6 py-4 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Settings size={20} className="text-[var(--gnosi-primary)]" />
                        {t('schema.manage_properties_of')} {folder}{tableName ? ` · ${tableName}` : ''}
                    </h2>
                    <button onClick={onClose} className="gnosi-close-btn" aria-label="Tancar">
                        <X />
                    </button>
                </div>

                <div ref={scrollRef} tabIndex={-1} className="gnosi-modal-scroll p-6 overflow-y-auto flex-1 bg-[var(--bg-primary)] outline-none">
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
                        </div>

                        <div className="border-t border-[var(--border-primary)] pt-4">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${enableSocialPublish ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--text-tertiary)]/20'}`}>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={enableSocialPublish}
                                        onChange={(e) => handleToggleSocialPublish(e.target.checked)}
                                    />
                                    <div className={`bg-[var(--bg-primary)] w-4 h-4 rounded-full shadow-sm transform transition-transform ${enableSocialPublish ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                                <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors flex items-center gap-1.5">
                                    <Send size={14} className={enableSocialPublish ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                                    {t('schema.social_publish_enabled', 'Publicable a XXSS')}
                                </span>
                            </label>
                            <p className="mt-2 text-xs text-[var(--text-secondary)]/60">
                                {t('schema.social_publish_hint', 'Afegeix un botó per generar amb IA i publicar els registres a les xarxes socials configurades.')}
                            </p>
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
                                            {/* Fallback: si Drupal no respon, mostra el bundle guardat
                                                perquè no sembli que s'ha perdut la configuració. */}
                                            {drupalBundle && !drupalContentTypes.some((ct) => ct.machine === drupalBundle) && (
                                                <option value={drupalBundle}>{drupalBundle}</option>
                                            )}
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
                                                        {/* Fallback: valor guardat tot i que Drupal no respongui. */}
                                                        {drupalFieldMapping['__body__'] && !drupalFields.some((df) => df.field_name === drupalFieldMapping['__body__']) && (
                                                            <option value={drupalFieldMapping['__body__']}>{drupalFieldMapping['__body__']}</option>
                                                        )}
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
                                        currentTableName={tableName}
                                        virtualComputers={virtualComputers}
                                        handleUpdateField={handleUpdateField}
                                        handleRemoveField={handleRemoveField}
                                        enableTranslation={enableTranslation}
                                        enableDrupalSync={enableDrupalSync}
                                        drupalBundle={drupalBundle}
                                        drupalFields={drupalFields}
                                        drupalFieldMapping={drupalFieldMapping}
                                        setDrupalFieldMapping={setDrupalFieldMapping}
                                        optionTools={optionTools}
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

        <ConfirmModal
            isOpen={confirmRemoveField.isOpen}
            onClose={() => setConfirmRemoveField({ isOpen: false, index: null, name: '' })}
            onConfirm={executeRemoveField}
            title={t('schema.confirm_remove_field_title', 'Eliminar propietat')}
            message={t('schema.confirm_remove_field_message', { name: confirmRemoveField.name, defaultValue: 'Segur que vols eliminar la propietat «{{name}}»? Aquesta acció no es pot desfer.' })}
            confirmText={t('schema.confirm_remove_field_confirm', 'Eliminar')}
            isDestructive={true}
        />

        <ConfirmModal
            isOpen={toggleConfirm.isOpen}
            onClose={closeToggleConfirm}
            onConfirm={async () => { await toggleConfirm.onConfirm?.(); closeToggleConfirm(); }}
            title={toggleConfirm.title}
            message={toggleConfirm.message}
            confirmText={toggleConfirm.confirmText || t('schema.disable', 'Desactivar')}
            cancelText={t('common.cancel', 'Cancel·lar')}
            isDestructive={true}
        />
        </>,
        document.body
    );
}
