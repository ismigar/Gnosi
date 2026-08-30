import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SortableFieldProps } from './types';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Languages, Globe, Trash2 } from 'lucide-react';
import { OPTION_FIELD_TYPES, TRANSLATABLE_FIELD_TYPES } from './constants';
import { OptionsEditor } from './OptionsEditor';
import { readStringArray } from './readers';
import { FieldFormats } from './FieldFormats';
import { ButtonFieldConfig } from './ButtonFieldConfig';
import { FilesFieldConfig } from './FilesFieldConfig';
import { DerivedFieldConfig } from './DerivedFieldConfig';
export function SortableField(props: SortableFieldProps) {
    const {
        field, idx, handleUpdateField, handleRemoveField, enableTranslation, enableDrupalSync,
        drupalBundle, drupalFields, drupalFieldMapping, setDrupalFieldMapping, optionTools,
    } = props;
    const { t } = useTranslation();
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });

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

                <div className="flex-1 min-w-[150px] flex flex-col gap-1">
                    <input
                        type="text"
                        value={field.name}
                        onChange={(e) => { handleUpdateField(idx, 'name', e.target.value); }}
                        placeholder={t('schema.property_name_placeholder')}
                        className="w-full text-sm font-semibold bg-transparent border-none focus:ring-0 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]/40 outline-none"
                    />
                    <input
                        type="text"
                        value={field.description || ''}
                        onChange={(e) => { handleUpdateField(idx, 'description', e.target.value); }}
                        placeholder={t('schema.field_description_placeholder', "Description or help explanation for this field...")}
                        className="w-full text-xs bg-transparent border-b border-transparent focus:border-[var(--gnosi-primary)]/40 focus:ring-0 text-[var(--text-secondary)] placeholder:text-[var(--text-tertiary)]/30 outline-none px-0.5 py-0.5 transition-colors"
                    />
                </div>

                <div className={`w-44 ${field.type === 'title' ? 'mr-10' : ''}`}>
                    <select
                        value={field.type}
                        onChange={(e) => { handleUpdateField(idx, 'type', e.target.value); }}
                        className="w-full text-xs font-medium border border-[var(--border-primary)] rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 focus:border-[var(--gnosi-primary)] outline-none bg-[var(--bg-secondary)] text-[var(--text-primary)] disabled:opacity-50"
                        disabled={field.type === 'title'}
                    >
                        {[
                            { value: 'text', label: t('schema.type_text') },
                            { value: 'rich_text', label: t('schema.type_rich_text') },
                            { value: 'number', label: t('schema.type_number') },
                            { value: 'select', label: t('schema.type_select') },
                            { value: 'multi_select', label: t('schema.type_multi_select') },
                            { value: 'autoria', label: t('schema.type_autoria', "Authorship") },
                            { value: 'status', label: t('schema.type_status') },
                            { value: 'date', label: t('schema.type_date') },
                            { value: 'datetime', label: t('schema.type_datetime') },
                            { value: 'period', label: t('schema.type_period') },
                            { value: 'checkbox', label: t('schema.type_checkbox') },
                            { value: 'url', label: t('schema.type_url') },
                            { value: 'zotero', label: t('schema.type_zotero', 'Zotero') },
                            { value: 'files', label: t('schema.type_files') },
                            { value: 'image', label: t('schema.type_image', "Image") },
                            { value: 'relation', label: t('schema.type_relation') },
                            { value: 'formula', label: t('schema.type_formula') },
                            { value: 'rollup', label: t('schema.type_rollup') },
                            { value: 'virtual', label: t('schema.type_virtual', "Derived") },
                            { value: 'created_time', label: t('schema.type_created_time', "Created at") },
                            { value: 'last_edited_time', label: t('schema.type_last_edited_time', "Edited at") },
                            { value: 'created_by', label: t('schema.type_created_by', "Created by") },
                            { value: 'last_edited_by', label: t('schema.type_last_edited_by', "Edited by") },
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
                        title={t('schema.field_translatable_hint', "Mark this field as translatable — the translate button will process it.")}
                    >
                        <input
                            type="checkbox"
                            checked={field.translatable}
                            onChange={(e) => { handleUpdateField(idx, 'translatable', e.target.checked); }}
                            className="w-3.5 h-3.5 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)] cursor-pointer"
                        />
                        <Languages size={13} className={field.translatable ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                        <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-secondary)]">
                            {t('schema.field_translatable', "Translatable")}
                        </span>
                    </label>
                )}

                {enableDrupalSync && drupalBundle && field.name.trim() && field.type !== 'button' && !field.system && (
                    <div
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md"
                        title={t('schema.field_drupal_map_hint', "Map this field to a field of the Drupal content type.")}
                    >
                        <Globe size={13} className={drupalFieldMapping[field.id] ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                        <select
                            value={drupalFieldMapping[field.id] || ''}
                            onChange={(e) => { setDrupalFieldMapping((prev) => {
                                const next = { ...prev };
                                if (e.target.value) next[field.id] = e.target.value;
                                else Reflect.deleteProperty(next, field.id);
                                return next;
                            }); }}
                            className="text-xs px-2 py-1 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] max-w-[150px]"
                        >
                            <option value="">{t('schema.drupal_no_map', "— Do not sync —")}</option>
                            {drupalFields.map((df) => (
                                <option key={df.field_name} value={df.field_name}>{df.label} · {df.field_type}</option>
                            ))}
                            {/* Fallback: if Drupal doesn't respond (e.g. 436), still show
                                the saved value so the mapping doesn't look lost. */}
                            {drupalFieldMapping[field.id] && !drupalFields.some((df) => df.field_name === drupalFieldMapping[field.id]) && (
                                <option value={drupalFieldMapping[field.id]}>{drupalFieldMapping[field.id]}</option>
                            )}
                        </select>
                    </div>
                )}

                {field.type !== 'title' && (
                    <button
                        onClick={() => { handleRemoveField(idx); }}
                        className="btn-gnosi-danger !p-1.5"
                        title={t('schema.remove_property')}
                    >
                        <Trash2 size={18} />
                    </button>
                )}
            </div>

            <FieldFormats {...props} />

            <ButtonFieldConfig {...props} />

            <FilesFieldConfig {...props} />

            <DerivedFieldConfig {...props} />

            {/* Options Section (select / multi_select / status) */}
            {OPTION_FIELD_TYPES.has(field.type) && (
                <OptionsEditor
                    options={field.options}
                    onChange={(opts) => { handleUpdateField(idx, 'options', opts); }}
                    fieldType={field.type}
                    groups={Array.isArray(field.rawConfig?.option_groups) && field.rawConfig.option_groups.length > 0 ? readStringArray(field.rawConfig.option_groups) : ['Inicial', 'En curs', 'Final']}
                    defaultOption={field.defaultOption || ''}
                    onDefaultOptionChange={(name) => { handleUpdateField(idx, 'defaultOption', name); }}
                    optionTools={optionTools}
                    fieldId={field.id || ''}
                    catalogRef={field.catalogRef || ''}
                    sharedCatalogs={optionTools.sharedCatalogs}
                    onLinkCatalog={(name) => { handleUpdateField(idx, 'catalogRef', name); }}
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
                                onChange={(e) => { handleUpdateField(idx, 'defaultFormula', e.target.value); }}
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
