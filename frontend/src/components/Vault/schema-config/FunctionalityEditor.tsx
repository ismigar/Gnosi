import React from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { FUNCTIONALITY_ACTIONS } from './constants';
import { AssignmentValueControl } from './AssignmentValueControl';
import type { ActionConfig, Assignment, FunctionalityEditorProps } from './types';
export function FunctionalityEditor({ functionality, index, allFields, availableSkills, onUpdate, onRemove, onProgramWithAi }: FunctionalityEditorProps) {
    const { t } = useTranslation();
    const config = functionality.config;
    const updateConfig = (patch: Partial<ActionConfig>) => { onUpdate(index, { config: { ...config, ...patch } }); };

    return (
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 space-y-3">
            <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer shrink-0">
                    <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${functionality.enabled ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--text-tertiary)]/20'}`}>
                        <input
                            type="checkbox"
                            className="hidden"
                            checked={functionality.enabled}
                            onChange={(event) => { onUpdate(index, { enabled: event.target.checked }); }}
                        />
                        <div className={`bg-[var(--bg-primary)] w-4 h-4 rounded-full shadow-sm transform transition-transform ${functionality.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                    <span className="text-xs font-semibold text-[var(--text-secondary)]">{t('schema.functionality_enabled', 'Enabled')}</span>
                </label>
                <input type="text" value={functionality.label || ''}
                    onChange={(event) => { onUpdate(index, { label: event.target.value }); }}
                    placeholder={t('schema.functionality_label_placeholder', 'Button label')}
                    aria-label={t('schema.functionality_label', 'Functionality label')}
                    className="min-w-0 flex-1 text-sm border border-[var(--border-primary)] rounded-md p-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)]" />
                <select value={functionality.action || 'translate_row'}
                    onChange={(event) => { onUpdate(index, { action: event.target.value, config: {} }); }}
                    aria-label={t('schema.functionality_action', 'Functionality action')}
                    className="w-52 text-xs border border-[var(--border-primary)] rounded-md p-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)]">
                    {FUNCTIONALITY_ACTIONS.map((action) => (
                        <option key={action.id} value={action.id}>{t(action.label_key, action.label_default)}</option>
                    ))}
                </select>
                <button type="button" onClick={() => { onProgramWithAi(index); }}
                    className="p-1.5 rounded-md text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10"
                    title={t('schema.button_program_ai', 'Program with AI')} aria-label={t('schema.button_program_ai', 'Program with AI')}>
                    <Sparkles size={15} />
                </button>
                <button type="button" onClick={() => { onRemove(index); }}
                    className="p-1.5 rounded-md text-red-500 hover:bg-red-500/10"
                    title={t('schema.remove_functionality', 'Remove functionality')} aria-label={t('schema.remove_functionality', 'Remove functionality')}>
                    <Trash2 size={15} />
                </button>
            </div>

            {functionality.action === 'set_fields' && (
                <div className="space-y-2 border-t border-[var(--border-primary)] pt-3">
                    <p className="text-xs font-semibold text-[var(--text-primary)]">{t('schema.button_set_fields_title', 'Field assignments')}</p>
                    {(config.assignments || []).map((assignment, assignmentIndex) => {
                        const targetMeta = allFields.find((field) => field.name === assignment.field);
                        const assignments = config.assignments || [];
                        const updateAssignment = (patch: Partial<Assignment>) => {
                            const next = [...assignments];
                            next[assignmentIndex] = { ...next[assignmentIndex], ...patch };
                            updateConfig({ assignments: next });
                        };
                        return (
                            <div key={assignmentIndex} className="flex items-center gap-2">
                                <select value={assignment.field || ''}
                                    onChange={(event) => { updateAssignment({ field: event.target.value, value: '' }); }}
                                    className="w-1/2 text-xs border border-[var(--border-primary)] rounded p-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)]">
                                    <option value="">{t('schema.button_target_field', 'Target field')}</option>
                                    {allFields.map((field) => <option key={field.id} value={field.name}>{field.name}</option>)}
                                </select>
                                <div className="flex-1">
                                    <AssignmentValueControl value={assignment.value ?? ''} fieldMeta={targetMeta}
                                        custom={assignment.custom === true} onCustomChange={(custom) => { updateAssignment({ custom }); }}
                                        onChange={(value) => { updateAssignment({ value }); }} />
                                </div>
                                <button type="button"
                                    onClick={() => { updateConfig({ assignments: assignments.filter((_, itemIndex) => itemIndex !== assignmentIndex) }); }}
                                    className="p-1.5 rounded text-red-500 hover:bg-red-500/10"
                                    aria-label={t('schema.remove_field_assignment', 'Remove field assignment')}>
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        );
                    })}
                    <button type="button"
                        onClick={() => { updateConfig({ assignments: [...(config.assignments || []), { field: '', value: '' }] }); }}
                        className="text-xs text-[var(--gnosi-primary)] hover:underline inline-flex items-center gap-1">
                        <Plus size={12} /> {t('schema.button_add_field_assignment', 'Add assignment')}
                    </button>
                </div>
            )}

            {functionality.action === 'ai_prompt' && (
                <div className="grid grid-cols-[1fr_13rem] gap-2 border-t border-[var(--border-primary)] pt-3">
                    <textarea rows={2} value={config.prompt || ''} onChange={(event) => { updateConfig({ prompt: event.target.value }); }}
                        placeholder={t('schema.button_ai_prompt_placeholder', 'AI instruction')}
                        className="text-xs border border-[var(--border-primary)] rounded p-2 bg-[var(--bg-primary)] text-[var(--text-primary)]" />
                    <select value={config.target_field || ''} onChange={(event) => { updateConfig({ target_field: event.target.value }); }}
                        className="text-xs border border-[var(--border-primary)] rounded p-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)]">
                        <option value="">{t('schema.button_target_field', 'Target field')}</option>
                        {allFields.map((field) => <option key={field.id} value={field.name}>{field.name}</option>)}
                    </select>
                </div>
            )}

            {functionality.action === 'run_skill' && (
                <select value={config.skill_id || ''} onChange={(event) => { updateConfig({ skill_id: event.target.value }); }}
                    className="w-full text-xs border border-[var(--border-primary)] rounded p-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)]">
                    <option value="">{t('schema.button_select_skill', 'Select Skill')}</option>
                    {availableSkills.map((skill) => (
                        <option key={skill.id || skill.name} value={skill.id || skill.name}>{skill.name || skill.id}</option>
                    ))}
                </select>
            )}
        </div>
    );
}
