import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SortableFieldProps } from './types';
import { Zap, Sparkles, Plus, Trash2 } from 'lucide-react';
import { FUNCTIONALITY_ACTIONS } from './constants';
import { AssignmentValueControl } from './AssignmentValueControl';
import type { Assignment } from './types';
export function ButtonFieldConfig({ field, idx, allFields, handleUpdateField, setAiActionModalFieldIndex, setAiActionPrompt, availableSkills }: SortableFieldProps) {
    const { t } = useTranslation();
    return <>
            {/* Button: action + label + custom config */}
            {field.type === 'button' && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold flex items-center gap-1.5">
                                <Zap size={12} /> {t('schema.button_action', "Button action")}
                            </label>
                            <button
                                type="button"
                                onClick={() => {
                                    setAiActionModalFieldIndex(idx);
                                    setAiActionPrompt('');
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded font-medium bg-gradient-to-r from-[var(--gnosi-primary)]/10 to-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] dark:text-[var(--gnosi-primary)] border border-[var(--gnosi-primary)]/30 hover:from-[var(--gnosi-primary)]/20 hover:to-[var(--gnosi-primary)]/20 transition-all shadow-sm"
                            >
                                <Sparkles size={12} />
                                {t('schema.button_program_ai', "Programar amb IA ✨")}
                            </button>
                        </div>

                        <select
                            value={field.button_action || 'translate_row'}
                            onChange={(e) => { handleUpdateField(idx, 'button_action', e.target.value); }}
                            className="w-full text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                        >
                            {FUNCTIONALITY_ACTIONS.map(action => (
                                <option key={action.id} value={action.id}>
                                    {t(action.label_key, action.label_default)}
                                </option>
                            ))}
                        </select>

                        <div>
                            <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold block mb-1">
                                {t('schema.button_label', "Button label")}
                            </label>
                            <input
                                type="text"
                                value={field.button_label || ''}
                                onChange={(e) => { handleUpdateField(idx, 'button_label', e.target.value); }}
                                placeholder={t('schema.button_label_placeholder', "e.g. Translate")}
                                className="w-full text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                            />
                        </div>

                        {/* Custom config for set_fields */}
                        {field.button_action === 'set_fields' && (
                            <div className="pt-2 border-t border-[var(--border-primary)]/50 space-y-2">
                                <label className="text-xs font-semibold text-[var(--text-primary)] block">
                                    {t('schema.button_set_fields_title', "Field assignments")}
                                </label>
                                {(field.button_config?.assignments || []).map((assign, aIdx) => {
                                    const targetMeta = allFields.find(f => f.name === assign.field);
                                    const targetIsMulti = targetMeta?.type === 'multi_select';
                                    const usesTypedControl = !!targetMeta && ['select', 'status', 'multi_select', 'checkbox', 'date', 'datetime', 'period', 'number', 'currency', 'percent', 'formula', 'rollup'].includes(targetMeta.type);
                                    const updateAssignment = (patch: Partial<Assignment>) => {
                                        const nextAssignments = [...(field.button_config?.assignments || [])];
                                        nextAssignments[aIdx] = { ...nextAssignments[aIdx], ...patch };
                                        handleUpdateField(idx, 'button_config', { ...field.button_config, assignments: nextAssignments });
                                    };
                                    return (
                                        <div key={aIdx} className="flex items-center gap-2">
                                            <select
                                                value={assign.field || ''}
                                                onChange={(e) => {
                                                    const pickedName = e.target.value;
                                                    const pickedMeta = allFields.find(f => f.name === pickedName);
                                                    // When switching to multi_select, coerce a string value
                                                    // into an array so the multi-select renders correctly.
                                                    let nextValue = assign.value;
                                                    if (pickedMeta?.type === 'multi_select') {
                                                        nextValue = Array.isArray(nextValue)
                                                            ? nextValue
                                                            : (nextValue ? [String(nextValue)] : []);
                                                    } else if (Array.isArray(nextValue)) {
                                                        nextValue = nextValue.join(', ');
                                                    }
                                                    updateAssignment({ field: pickedName, value: nextValue });
                                                }}
                                                className="w-1/2 text-xs border border-[var(--border-primary)] rounded p-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none"
                                            >
                                                <option value="">-- {t('schema.button_target_field', "Target field")} --</option>
                                                {allFields.filter(f => f.name !== field.name).map(f => (
                                                    <option key={f.id} value={f.name}>{f.name}</option>
                                                ))}
                                            </select>
                                            <div className="flex items-center gap-1 w-1/2">
                                                <AssignmentValueControl
                                                    value={assign.value ?? (targetIsMulti ? [] : '')}
                                                    fieldMeta={targetMeta}
                                                    custom={assign.custom === true}
                                                    onCustomChange={(c) => { updateAssignment({ custom: c }); }}
                                                    onChange={(v) => { updateAssignment({ value: v }); }}
                                                />
                                                {usesTypedControl && assign.custom !== true && (
                                                    <button
                                                        type="button"
                                                        onClick={() => { updateAssignment({ custom: true }); }}
                                                        title={t('schema.button_value_custom', "Custom value / formula")}
                                                        className="shrink-0 px-1.5 py-1.5 text-[10px] rounded border border-[var(--border-primary)] text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 transition-colors"
                                                    >
                                                        {t('schema.button_value_custom', "Custom")}
                                                    </button>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const nextAssignments = (field.button_config?.assignments || []).filter((_, i) => i !== aIdx);
                                                    handleUpdateField(idx, 'button_config', { ...field.button_config, assignments: nextAssignments });
                                                }}
                                                className="p-1.5 text-red-500 hover:bg-red-500/10 rounded transition-colors"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    );
                                })}
                                <button
                                    type="button"
                                    onClick={() => {
                                        const current = field.button_config?.assignments || [];
                                        handleUpdateField(idx, 'button_config', {
                                            ...field.button_config,
                                            assignments: [...current, { field: '', value: '' }]
                                        });
                                    }}
                                    className="text-xs text-[var(--gnosi-primary)] hover:underline inline-flex items-center gap-1 font-medium pt-1"
                                >
                                    <Plus size={12} /> {t('schema.button_add_field_assignment', "Add assignment")}
                                </button>
                            </div>
                        )}

                        {/* Custom config for ai_prompt */}
                        {field.button_action === 'ai_prompt' && (
                            <div className="pt-2 border-t border-[var(--border-primary)]/50 space-y-2">
                                <div>
                                    <label className="text-xs font-semibold text-[var(--text-primary)] block mb-1">
                                        {t('schema.button_ai_prompt_label', "AI Instruction (Prompt)")}
                                    </label>
                                    <textarea
                                        rows={3}
                                        value={field.button_config?.prompt || ''}
                                        onChange={(e) => { handleUpdateField(idx, 'button_config', { ...field.button_config, prompt: e.target.value }); }}
                                        placeholder={t('schema.button_ai_prompt_placeholder', "e.g. Summarize the Description field in 2 sentences...")}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded p-2 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[var(--text-primary)] block mb-1">
                                        {t('schema.button_target_field', "Target field")}
                                    </label>
                                    <select
                                        value={field.button_config?.target_field || ''}
                                        onChange={(e) => { handleUpdateField(idx, 'button_config', { ...field.button_config, target_field: e.target.value }); }}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded p-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none"
                                    >
                                        <option value="">-- {t('schema.button_target_field', "Target field")} --</option>
                                        {allFields.filter(f => f.name !== field.name).map(f => (
                                            <option key={f.id} value={f.name}>{f.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}

                        {/* Custom config for run_skill */}
                        {field.button_action === 'run_skill' && (
                            <div className="pt-2 border-t border-[var(--border-primary)]/50 space-y-2">
                                <label className="text-xs font-semibold text-[var(--text-primary)] block mb-1">
                                    {t('schema.button_select_skill', "Select Skill")}
                                </label>
                                <select
                                    value={field.button_config?.skill_id || ''}
                                    onChange={(e) => { handleUpdateField(idx, 'button_config', { ...field.button_config, skill_id: e.target.value }); }}
                                    className="w-full text-xs border border-[var(--border-primary)] rounded p-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none"
                                >
                                    <option value="">-- {t('schema.button_select_skill', "Select Skill")} --</option>
                                    {availableSkills.map(sk => (
                                        <option key={sk.id || sk.name} value={sk.id || sk.name}>{sk.name || sk.id}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <p className="text-[10px] text-[var(--text-secondary)]/70 px-1">
                            {t('schema.button_hint', "The button runs the selected action on the row and, for translation, creates one subitem per target language.")}
                        </p>
                    </div>
                </div>
            )}

    </>;
}
