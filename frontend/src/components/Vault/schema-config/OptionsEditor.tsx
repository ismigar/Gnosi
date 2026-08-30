import React, { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Tag, Plus, Link2 } from 'lucide-react';
import { toast } from '../../../lib/toast';
import PromptModal from '../../PromptModal';
import { normalizeOption, normalizeOptions, STATUS_CATALOG_REF, type NormalizedOption, type OptionColorName } from '../optionCatalogUtils';
import { RULE_PROTECTED_OPTIONS } from './constants';
import { SortableOptionRow } from './SortableOptionRow';
import { RemoveOptionDialog } from './RemoveOptionDialog';
import type { OptionsEditorProps, RemoveOptionState } from './types';
export function OptionsEditor({ options = [], onChange, fieldType = 'select', groups = [], defaultOption = '', onDefaultOptionChange, optionTools = null, fieldId = '', catalogRef = '', sharedCatalogs = {}, onLinkCatalog = null }: OptionsEditorProps) {
    const { t } = useTranslation();
    const [newOption, setNewOption] = useState('');
    const [usage, setUsage] = useState<Record<string, number> | null>(null); // {name: count} or null while loading
    const [confirmRemove, setConfirmRemove] = useState<RemoveOptionState>({ isOpen: false, value: null, usageCount: null, protectedReason: '' });
    const [showNewCatalog, setShowNewCatalog] = useState(false);
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    // With a shared catalog (config.catalog_ref), the options LIVE in the root
    // registry and are edited there (all linked tables see them). Dedicated
    // `status` fields always use the reserved global status catalog.
    const isShared = Boolean(catalogRef);
    const isGlobalStatus = fieldType === 'status' && catalogRef === STATUS_CATALOG_REF;
    const richOptions = normalizeOptions(isShared ? (sharedCatalogs[catalogRef] || []) : options);
    const names = richOptions.map((o) => o.name);
    const applyChange = (next: NormalizedOption[]) => {
        if (isShared) void optionTools?.updateSharedCatalog?.(catalogRef, next);
        else onChange(next);
    };

    // Usage counter per option (server). Only if the field already exists in the
    // registry (persisted fieldId); for new fields there is nothing to count.
    const fetchUsage = useEffectEvent(() => {
        let cancelled = false;
        if (!optionTools?.fetchUsage || !fieldId) return undefined;
        optionTools.fetchUsage(fieldId)
            .then((counts) => { if (!cancelled) setUsage(counts); })
            .catch(() => { if (!cancelled) setUsage(null); });
        return () => { cancelled = true; };
    });
    useEffect(() => fetchUsage(), [fieldId]);

    const addOption = () => {
        const v = newOption.trim();
        if (!v || names.includes(v)) { setNewOption(''); return; }
        const option = normalizeOption(v);
        if (option) applyChange([...richOptions, option]);
        setNewOption('');
    };

    const renameOption = (oldVal: string, newVal: string) => {
        if (names.includes(newVal)) return; // silent: do not duplicate
        if (isShared && !isGlobalStatus) {
            // Row rewriting for arbitrary shared catalogs is not supported yet.
            toast.error(t('schema.shared_catalog_rename_unsupported', "Renaming options of a shared catalog is not supported yet."));
            return;
        }
        if (isGlobalStatus) {
            void optionTools?.renameEverywhere?.(fieldId, oldVal, newVal, usage?.[oldVal] ?? null);
            return;
        }
        onChange(richOptions.map((o) => (o.name === oldVal ? { ...o, name: newVal } : o)));
        if (defaultOption === oldVal) onDefaultOptionChange?.(newVal);
        // Eager rewrite of affected .md files (values are stored by name):
        // ONE call to the server, never N PATCHes from the client.
        void optionTools?.renameEverywhere?.(fieldId, oldVal, newVal, usage?.[oldVal] ?? null);
        if (usage && usage[oldVal] !== undefined) {
            setUsage((u) => {
                const next = { ...u };
                next[newVal] = (next[newVal] || 0) + (next[oldVal] || 0);
                Reflect.deleteProperty(next, oldVal);
                return next;
            });
        }
    };

    const setColor = (name: string, color: OptionColorName) => {
        applyChange(richOptions.map((o) => (o.name === name ? { ...o, color } : o)));
    };

    const setGroup = (name: string, group: string) => {
        applyChange(richOptions.map((o) => {
            if (o.name !== name) return o;
            const next = { ...o };
            if (group) next.group = group; else delete next.group;
            return next;
        }));
    };

    // Deleting an option removes it from ALL records that use it (not
    // just from the catalog) or reassigns them to another option. Always with
    // confirmation (accessibility: never destructive on the first click).
    const requestRemoveOption = (val: string) => {
        if (isShared && !isGlobalStatus) {
            toast.error(t('schema.shared_catalog_remove_unsupported', "Deleting options from a shared catalog is not supported yet."));
            return;
        }
        setConfirmRemove({
            isOpen: true,
            value: val,
            usageCount: usage ? (usage[val] || 0) : null,
            protectedReason: RULE_PROTECTED_OPTIONS.has(val)
                ? t('schema.remove_option_rule_warning', "This option is used by the action rules (translate/publish); if a rule needs it, it will be recreated automatically.")
                : '',
        });
    };
    const executeRemoveOption = (reassignTo: string | null) => {
        const val = confirmRemove.value;
        setConfirmRemove({ isOpen: false, value: null, usageCount: null, protectedReason: '' });
        if (val === null) return;
        if (isGlobalStatus) {
            void optionTools?.removeEverywhere?.(fieldId, val, reassignTo);
        } else {
            onChange(richOptions.filter((o) => o.name !== val));
        }
        if (defaultOption === val) onDefaultOptionChange?.('');
        void optionTools?.removeEverywhere?.(fieldId, val, reassignTo);
        if (usage) {
            setUsage((u) => {
                const next = { ...u };
                if (reassignTo && next[val]) next[reassignTo] = (next[reassignTo] || 0) + next[val];
                Reflect.deleteProperty(next, val);
                return next;
            });
        }
    };

    const handleDragEnd = ({ active, over }: DragEndEvent) => {
        if (over && active.id !== over.id) {
            const oldIndex = names.findIndex((name) => name === active.id);
            const newIndex = names.findIndex((name) => name === over.id);
            if (oldIndex !== -1 && newIndex !== -1) applyChange(arrayMove(richOptions, oldIndex, newIndex));
        }
    };

    // Link the field to a shared catalog (or unlink it). When
    // unlinking, the catalog options are COPIED as local ones so the
    // field doesn't end up without a catalog.
    const handleCatalogLink = (value: string) => {
        if (!onLinkCatalog) return;
        if (value === '__create__') {
            setShowNewCatalog(true);
            return;
        }
        if (!value && isShared) {
            onChange(richOptions); // local copy of the shared catalog
            onLinkCatalog('');
            return;
        }
        if (value) onLinkCatalog(value);
    };

    const doNewCatalog = (name: string) => {
        setShowNewCatalog(false);
        const clean = (name || '').trim();
        if (!clean) return;
        void optionTools?.updateSharedCatalog?.(clean, richOptions);
        onLinkCatalog?.(clean);
    };

    return (
        <>
        <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-2">
                <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1 flex items-center gap-1.5">
                    <Tag size={12} /> {t('schema.options_label', "Options")}
                    {catalogRef && (
                        <span className="normal-case tracking-normal font-medium text-[var(--text-tertiary)]">
                            · {isGlobalStatus
                                ? t('schema.status_catalog_global', 'Global status catalog')
                                : t('schema.options_shared_catalog', { name: catalogRef, defaultValue: "shared catalog “{{name}}”" })}
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
                        {t('schema.options_empty', "No options yet. They're also created automatically when filling records.")}
                    </p>
                )}
                <div className="flex items-center gap-2 pt-1">
                    <input
                        type="text"
                        value={newOption}
                        onChange={(e) => { setNewOption(e.target.value); }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); addOption(); }
                            if (e.key === 'Escape') { e.stopPropagation(); setNewOption(''); }
                        }}
                        placeholder={t('schema.options_add_placeholder', "New option…")}
                        className="flex-1 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1.5 text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                    />
                    <button
                        type="button"
                        onClick={addOption}
                        disabled={!newOption.trim() || names.includes(newOption.trim())}
                        className="btn-gnosi btn-gnosi-primary !text-xs !py-1.5 !px-3 flex items-center gap-1 disabled:opacity-40"
                    >
                        <Plus size={14} /> {t('common.add', "Add")}
                    </button>
                </div>
                {onLinkCatalog && !isGlobalStatus && (
                    <div className="flex items-center gap-2 pt-1">
                        <Link2 size={12} className="text-[var(--text-tertiary)]/60" />
                        <label className="text-[10px] text-[var(--text-tertiary)]/80">
                            {t('schema.shared_catalog_label', "Catalog")}
                        </label>
                        <select
                            value={catalogRef || ''}
                            onChange={(e) => { handleCatalogLink(e.target.value); }}
                            className="text-[11px] border border-[var(--border-primary)] rounded px-1.5 py-0.5 bg-[var(--bg-secondary)] text-[var(--text-secondary)] outline-none"
                            title={t('schema.shared_catalog_hint', "Shares the same option list across tables: editing it in one place updates it everywhere.")}
                        >
                            <option value="">{t('schema.shared_catalog_own', "Field's own")}</option>
                            {Object.keys(sharedCatalogs).sort().map((name) => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                            <option value="__create__">{t('schema.shared_catalog_create', "+ Convert into shared catalog…")}</option>
                        </select>
                    </div>
                )}
            </div>
        </div>
        <RemoveOptionDialog
            key={confirmRemove.value ?? 'closed'}
            state={confirmRemove}
            options={richOptions}
            onCancel={() => { setConfirmRemove({ isOpen: false, value: null, usageCount: null, protectedReason: '' }); }}
            onConfirm={executeRemoveOption}
        />
        <PromptModal
            isOpen={showNewCatalog}
            onClose={() => { setShowNewCatalog(false); }}
            onSubmit={doNewCatalog}
            title={t('schema.shared_catalog_new_title', "New shared catalog")}
            label={t('schema.shared_catalog_new_prompt', "Name of the new shared catalog:")}
            confirmText={t('common.create', "Create")}
            cancelText={t('common.cancel', "Cancel")}
        />
        </>
    );
}
