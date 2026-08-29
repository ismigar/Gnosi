import { useState } from 'react';
import { AlertTriangle, Check, Clock3, Loader2, Play, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../lib/notifyError';
import { toast } from '../../lib/toast';
import { operationStatusLabel, skillDisplayName } from './aiResourceI18n';


type NumericDraftValue = number | string;


interface AutomationBudgetFields {
    max_ai_calls_per_run: NumericDraftValue;
    max_runs_per_day: NumericDraftValue;
    max_runtime_seconds: NumericDraftValue;
}


interface SkillAutomation extends AutomationBudgetFields {
    agent_id: string;
    budgets?: Partial<AutomationBudgetFields>;
    enabled: boolean;
    id: string;
    instruction: string;
    interval_minutes: NumericDraftValue;
    last_status?: string | null;
    name: string;
    revision?: string | number | null;
    skill_id: string;
}


interface AutomationDraft extends AutomationBudgetFields {
    agent_id: string;
    enabled: boolean;
    id?: string;
    instruction: string;
    interval_minutes: NumericDraftValue;
    name: string;
    revision?: string | number | null;
    skill_id: string;
}


interface AISettingsAgent {
    id: string;
    name?: string | null;
    skill_ids?: readonly string[];
}


interface OperationSkill extends Record<string, unknown> {
    assignable: boolean;
    id: string;
    name?: string;
}


interface AutomationsResources {
    automations: readonly SkillAutomation[];
    deleteAutomation: (automationId: string) => Promise<unknown>;
    loading: boolean;
    runAutomation: (automationId: string) => Promise<unknown>;
    saveAutomation: (draft: AutomationDraft) => Promise<unknown>;
    skills: readonly OperationSkill[];
}


interface AutomationsSettingsPanelProps {
    readonly agents: readonly AISettingsAgent[];
    readonly resources: AutomationsResources;
}


const emptyDraft: AutomationDraft = {
    name: '',
    agent_id: '',
    skill_id: '',
    instruction: '',
    interval_minutes: 1440,
    enabled: false,
    max_runs_per_day: 4,
    max_ai_calls_per_run: 4,
    max_runtime_seconds: 180,
};

const toDraft = (automation?: SkillAutomation): AutomationDraft => ({
    ...emptyDraft,
    ...automation,
    ...(automation?.budgets || {}),
});

export const AutomationsSettingsPanel = ({
    resources,
    agents,
}: AutomationsSettingsPanelProps) => {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<AutomationDraft | null>(null);
    const [saving, setSaving] = useState(false);
    const [runningId, setRunningId] = useState('');
    const selectedAgent = agents.find(agent => agent.id === draft?.agent_id);
    const assignedIds = new Set(selectedAgent?.skill_ids || []);
    const skills = resources.skills.filter(skill => (
        skill.assignable && assignedIds.has(skill.id)
    ));
    const valid = draft !== null && Boolean(
        draft.name.trim()
        && draft.agent_id
        && draft.skill_id
        && draft.instruction.trim(),
    );

    const update = (patch: Partial<AutomationDraft>): void => {
        setDraft((current) => current === null ? null : ({ ...current, ...patch }));
    };
    const save = async (): Promise<void> => {
        if (draft === null || !valid || saving) return;
        setSaving(true);
        try {
            await resources.saveAutomation(draft);
            setDraft(null);
            toast.success(t('settings.ai.operations.automation_saved'));
        } catch (error) {
            logError('ai-automation-save', error);
            toast.error(t('settings.ai.operations.automation_save_error'));
        } finally {
            setSaving(false);
        }
    };

    const run = async (automationId: string): Promise<void> => {
        setRunningId(automationId);
        try {
            await resources.runAutomation(automationId);
            toast.success(t('settings.ai.operations.automation_queued'));
        } catch (error) {
            logError('ai-automation-run', error);
            toast.error(t('settings.ai.operations.automation_run_error'));
        } finally {
            setRunningId('');
        }
    };

    const remove = async (automationId: string): Promise<void> => {
        try {
            await resources.deleteAutomation(automationId);
            toast.success(t('settings.ai.operations.automation_deleted'));
        } catch (error) {
            logError('ai-automation-delete', error);
            toast.error(t('settings.ai.operations.automation_delete_error'));
        }
    };

    return (
        <div className="ai-resources-panel">
            <div className="ai-resource-alert">
                <Clock3 size={18} />
                <span>{t('settings.ai.operations.governance_help')}</span>
            </div>
            <div className="ai-resources-toolbar">
                <button
                    type="button"
                    className="btn-gnosi btn-gnosi-primary"
                    onClick={() => {
                        setDraft(toDraft());
                    }}
                >
                    <Plus size={16} /> {t('settings.ai.operations.new_automation')}
                </button>
            </div>
            {draft && (
                <div className="ai-resource-editor">
                    <div className="ai-resource-editor__grid">
                        <label>
                            <span>{t('settings.ai.resources.name')}</span>
                            <input
                                className="gnosi-input"
                                value={draft.name}
                                onChange={(event) => {
                                    update({ name: event.target.value });
                                }}
                            />
                        </label>
                        <label>
                            <span>{t('settings.ai.operations.agent')}</span>
                            <select
                                className="gnosi-select"
                                value={draft.agent_id}
                                onChange={(event) => {
                                    update({
                                        agent_id: event.target.value,
                                        skill_id: '',
                                    });
                                }}
                            >
                                <option value="">—</option>
                                {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>)}
                            </select>
                        </label>
                        <label>
                            <span>{t('settings.ai.operations.skill')}</span>
                            <select
                                className="gnosi-select"
                                value={draft.skill_id}
                                onChange={(event) => {
                                    update({ skill_id: event.target.value });
                                }}
                            >
                                <option value="">—</option>
                                {skills.map(skill => <option key={skill.id} value={skill.id}>{skillDisplayName(t, skill)}</option>)}
                            </select>
                        </label>
                        <label>
                            <span>{t('settings.ai.operations.interval_minutes')}</span>
                            <input
                                className="gnosi-input"
                                type="number"
                                min="5"
                                value={draft.interval_minutes}
                                onChange={(event) => {
                                    update({ interval_minutes: event.target.value });
                                }}
                            />
                        </label>
                    </div>
                    <label>
                        <span>{t('settings.ai.operations.instruction')}</span>
                        <textarea
                            className="gnosi-input"
                            rows={4}
                            value={draft.instruction}
                            onChange={(event) => {
                                update({ instruction: event.target.value });
                            }}
                        />
                    </label>
                    <div className="ai-resource-editor__grid">
                        <label>
                            <span>{t('settings.ai.operations.runs_per_day')}</span>
                            <input
                                className="gnosi-input"
                                type="number"
                                min="1"
                                max="144"
                                value={draft.max_runs_per_day}
                                onChange={(event) => {
                                    update({ max_runs_per_day: event.target.value });
                                }}
                            />
                        </label>
                        <label>
                            <span>{t('settings.ai.operations.ai_calls')}</span>
                            <input
                                className="gnosi-input"
                                type="number"
                                min="1"
                                max="16"
                                value={draft.max_ai_calls_per_run}
                                onChange={(event) => {
                                    update({ max_ai_calls_per_run: event.target.value });
                                }}
                            />
                        </label>
                        <label>
                            <span>{t('settings.ai.operations.runtime_seconds')}</span>
                            <input
                                className="gnosi-input"
                                type="number"
                                min="15"
                                max="900"
                                value={draft.max_runtime_seconds}
                                onChange={(event) => {
                                    update({ max_runtime_seconds: event.target.value });
                                }}
                            />
                        </label>
                        <label>
                            <span>
                                <input
                                    type="checkbox"
                                    checked={draft.enabled}
                                    onChange={(event) => {
                                        update({ enabled: event.target.checked });
                                    }}
                                /> {t('settings.ai.operations.enabled')}
                            </span>
                        </label>
                    </div>
                    {!valid && <div className="ai-resource-validation"><AlertTriangle size={15} />{t('settings.ai.resources.required_fields')}</div>}
                    <div className="ai-resource-editor__actions">
                        <button
                            type="button"
                            className="btn-gnosi-secondary"
                            onClick={() => {
                                setDraft(null);
                            }}
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="button"
                            className="btn-gnosi btn-gnosi-primary"
                            disabled={!valid || saving}
                            onClick={() => {
                                void save();
                            }}
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t('common.save')}
                        </button>
                    </div>
                </div>
            )}
            <div className="ai-resource-list">
                {resources.automations.map(automation => (
                    <article key={automation.id} className="ai-resource-card">
                        <button
                            type="button"
                            className="ai-resource-card__main"
                            onClick={() => {
                                setDraft(toDraft(automation));
                            }}
                        >
                            <Clock3 size={18} />
                            <span className="ai-resource-card__copy">
                                <span className="ai-resource-card__heading"><strong>{automation.name}</strong><code>{automation.skill_id}</code></span>
                                <span>{automation.instruction}</span>
                                <span className="ai-resource-card__meta">
                                    <span>{t('settings.ai.operations.every_minutes', { count: automation.interval_minutes })}</span>
                                    <span>{automation.enabled ? t('settings.ai.operations.enabled') : t('settings.ai.operations.disabled')}</span>
                                    <span>{operationStatusLabel(t, automation.last_status)}</span>
                                </span>
                            </span>
                        </button>
                        <div className="ai-resource-card__actions">
                            <button
                                type="button"
                                onClick={() => {
                                    void run(automation.id);
                                }}
                                disabled={runningId === automation.id}
                            >
                                {runningId === automation.id ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} {t('settings.ai.operations.run_now')}
                            </button>
                            <button
                                type="button"
                                className="is-danger"
                                onClick={() => {
                                    void remove(automation.id);
                                }}
                            >
                                <Trash2 size={15} />{t('common.delete')}
                            </button>
                        </div>
                    </article>
                ))}
                {!resources.loading && resources.automations.length === 0 && <div className="ai-resource-empty">{t('settings.ai.operations.no_automations')}</div>}
            </div>
        </div>
    );
};

export { OperationsHistoryPanel } from './AIOperationsHistoryPanel';
