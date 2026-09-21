import { SkillPackageTools } from '../../agent-learning';
import { useMemo, useState } from 'react';
import {
    AlertTriangle,
    ChevronDown,
    Loader2,
    Plus,
    ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../../shared/notifications/notifyError';
import { toast } from '../../../shared/notifications/toast';
import { jsonString, type JsonRecord } from './aiResourcesApi';
import type {
    NormalizedSkill,
    SkillDraft,
} from './aiSettingsUtils';
import { localizedResourceSearchText, skillDisplayName, skillDisplayDescription, skillCategory } from './aiResourceI18n';
import type {
    AIResourceAgent,
    SkillResources,
} from './aiResourceSettingsTypes';
import { SkillUsage } from './AISkillUsage';
import { SkillCard } from './AISkillCard';
import { SkillEditor } from './AISkillEditor';
import {
    CatalogError,
    EmptyState,
    SearchField,
} from './AIResourcePrimitives';


interface DeletionConflict {
    readonly affectedAgents: readonly JsonRecord[];
    readonly skill: NormalizedSkill;
}


interface SkillsSettingsPanelProps {
    readonly agents: readonly AIResourceAgent[];
    readonly principalAgentId?: string;
    readonly canEdit?: boolean;
    readonly selectedSkillId?: string;
    readonly onAgentsChanged: (agents: AIResourceAgent[]) => void;
    readonly resources: SkillResources;
}


const issueValue = (issue: JsonRecord, key: string): string | undefined => (
    jsonString(issue[key])
);


const issueText = (issue: JsonRecord): string => (
    issueValue(issue, 'message')
    ?? issueValue(issue, 'detail')
    ?? issueValue(issue, 'error')
    ?? JSON.stringify(issue)
);


export function SkillsSettingsPanel({
    agents,
    canEdit = true,
    principalAgentId = '',
    selectedSkillId,
    onAgentsChanged,
    resources,
}: SkillsSettingsPanelProps) {
    const { t } = useTranslation();
    const [search, setSearch] = useState(selectedSkillId || '');
    const [origin, setOrigin] = useState('all');
    const [expandedId, setExpandedId] = useState(selectedSkillId || '');
    const [usage, setUsage] = useState<{ skill: NormalizedSkill; source: NormalizedSkill | null } | null>(null);
    const [source, setSource] = useState<NormalizedSkill | null>(null);
    const [category, setCategory] = useState(resources.skills.some(skill => skill.id === selectedSkillId && skillCategory(skill) === 'legacy') ? 'legacy' : 'all');
    const [editing, setEditing] = useState<NormalizedSkill | null>(null);
    const [creating, setCreating] = useState(false);
    const [deletionConflict, setDeletionConflict] =
        useState<DeletionConflict | null>(null);
    const normalizedSearch = search.trim().toLowerCase();
    const toolsById = useMemo(
        () => new Map(resources.tools.map((tool) => [tool.id, tool])),
        [resources.tools],
    );
    const skillsWithConsumers = useMemo(() => resources.skills.map((skill) => ({
        ...skill,
        agentIds: [...new Set([
            ...skill.agentIds,
            ...agents.filter((agent) => (
                (agent.skill_ids ?? []).includes(skill.id)
            )).map((agent) => agent.id),
        ])],
    })), [agents, resources.skills]);
    const filtered = skillsWithConsumers.filter((skill) => (
        (origin === 'all' || skill.origin.type === origin)
        && (category === 'all' ? skillCategory(skill) !== 'legacy' : skillCategory(skill) === category)
        && (
            !normalizedSearch
            || localizedResourceSearchText(t, skill, 'skill').includes(normalizedSearch)
        )
    ));

    const handleCreate = async (draft: SkillDraft): Promise<void> => {
        try {
            const skill = await resources.createSkill({ ...draft, ...(source ? { sourceSkillId: source.id, sourceRevision: source.revision } : {}) });
            setUsage({ skill, source });
            setSource(null);
            setCreating(false);
            setExpandedId(skill.id);
            toast.success(t('settings.ai.resources.skill_created'));
        } catch (error: unknown) {
            logError('ai-skill-create', error);
            toast.error(t('settings.ai.resources.save_error'));
        }
    };
    const handleUpdate = async (draft: SkillDraft): Promise<void> => {
        if (!editing) return;
        try {
            const skill = await resources.updateSkill(editing, draft);
            setEditing(null);
            setExpandedId(skill.id);
            toast.success(t('settings.ai.resources.skill_updated'));
        } catch (error: unknown) {
            logError('ai-skill-update', error);
            toast.error(t('settings.ai.resources.save_error'));
        }
    };
    const handleClone = (skill: NormalizedSkill): void => {
        setSource(skill);
        setCreating(true);
        setEditing(null);
    };
    const handleDelete = async (skill: NormalizedSkill): Promise<void> => {
        try {
            const result = await resources.deleteSkill(skill);
            if (!result.deleted) {
                setDeletionConflict({
                    affectedAgents: result.affectedAgents,
                    skill,
                });
                return;
            }
            toast.success(t('settings.ai.resources.skill_deleted'));
        } catch (error: unknown) {
            logError('ai-skill-delete', error);
            toast.error(t('settings.ai.resources.delete_error'));
        }
    };
    const confirmConflictDelete = async (): Promise<void> => {
        const conflict = deletionConflict;
        if (!conflict) return;
        try {
            const result = await resources.deleteSkill(conflict.skill, true);
            if (!result.deleted) return;
            const affectedIds = new Set(conflict.affectedAgents
                .map((agent) => jsonString(agent.id))
                .filter((id): id is string => Boolean(id)));
            onAgentsChanged(agents.map((agent) => (
                affectedIds.has(agent.id)
                    ? {
                        ...agent,
                        skill_ids: (agent.skill_ids ?? []).filter((id) => (
                            id !== conflict.skill.id
                        )),
                    }
                    : agent
            )));
            setDeletionConflict(null);
            toast.success(t('settings.ai.resources.skill_deleted'));
        } catch (error: unknown) {
            logError('ai-skill-unassign-delete', error);
            toast.error(t('settings.ai.resources.delete_error'));
        }
    };

    return (
        <div className="ai-resources-panel">
            <SkillPackageTools agentId={principalAgentId || agents[0]?.id || ''} canEdit={canEdit} onSaved={() => { void resources.reload(); }} />
            <div className="ai-resources-toolbar">
                <SearchField
                    onChange={setSearch}
                    placeholder={t('settings.ai.resources.search_skills')}
                    value={search}
                />
                <select
                    className="gnosi-select"
                    onChange={(event) => {
                        setOrigin(event.target.value);
                    }}
                    value={origin}
                >
                    <option value="all">{t('settings.ai.resources.all_origins')}</option>
                    <option value="core">{t('settings.ai.resources.origin_core')}</option>
                    <option value="plugin">{t('settings.ai.resources.origin_plugin')}</option>
                    <option value="user">{t('settings.ai.resources.origin_user')}</option>
                </select>
                <button
                    className="btn-gnosi btn-gnosi-primary"
                    disabled={!canEdit}
                    onClick={() => {
                        setSource(null);
                        setCreating((current) => !current);
                        setEditing(null);
                    }}
                    type="button"
                >
                    {creating ? <ChevronDown size={16} /> : <Plus size={16} />}
                    {t('settings.ai.resources.new_skill')}
                </button>
            </div>

            <select className="gnosi-select" aria-label={t('settings.ai.resources.category_filter')} value={category} onChange={event => { setCategory(event.target.value); }}>
                {['all', 'workflow', 'bundle', 'legacy'].map(value => <option key={value} value={value}>{t(`settings.ai.resources.category_${value}`)}</option>)}
            </select>
            {!canEdit && <p>{t('settings.ai.resources.edit_permission')}</p>}
            <CatalogError error={resources.error} onRetry={resources.reload} />
            {resources.issues.length > 0 ? (
                <div className="ai-resource-alert is-warning">
                    <AlertTriangle size={17} />
                    <div>
                        <strong>{t('settings.ai.resources.catalog_issues')}</strong>
                        <ul>
                            {resources.issues.map((issue, index) => {
                                const path = issueValue(issue, 'path')
                                    ?? issueValue(issue, 'skill_id');
                                return (
                                    <li key={`${path ?? 'issue'}-${index.toString()}`}>
                                        {path ? <code>{path}: </code> : null}
                                        {issueText(issue)}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>
            ) : null}

            {deletionConflict ? (
                <div className="ai-resource-alert is-warning">
                    <ShieldAlert size={19} />
                    <div>
                        <strong>{t('settings.ai.resources.delete_conflict_title')}</strong>
                        <p>{t('settings.ai.resources.delete_conflict_description', {
                            agents: deletionConflict.affectedAgents.map((agent) => (
                                jsonString(agent.name)
                                ?? jsonString(agent.id)
                                ?? ''
                            )).join(', '),
                            count: deletionConflict.affectedAgents.length,
                        })}</p>
                        <div className="ai-resource-alert__actions">
                            <button
                                onClick={() => {
                                    setDeletionConflict(null);
                                }}
                                type="button"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                className="is-danger"
                                onClick={() => {
                                    void confirmConflictDelete();
                                }}
                                type="button"
                            >
                                {t('settings.ai.resources.unassign_and_delete')}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {usage && resources.assignAgentSkills && resources.saveAutomation && <SkillUsage
                key={usage.skill.id} skill={usage.skill} source={usage.source} agents={agents} principalAgentId={principalAgentId} onAgentsChanged={onAgentsChanged}
                resources={{ automations: resources.automations || [], assignAgentSkills: resources.assignAgentSkills, saveAutomation: resources.saveAutomation }}
            />}
            {source && <div className="ai-resource-alert">{t('settings.ai.resources.customize_help')}
                <details><summary>{t('settings.ai.resources.compare_original')}</summary><pre>{source.instructions}</pre></details>
            </div>}
            {creating ? (
                <SkillEditor
                    key={source?.id || 'new'}
                    skill={source ? { ...source, id: '', name: t('settings.ai.resources.clone_name', { name: skillDisplayName(t, source) }), description: skillDisplayDescription(t, source) } : null}
                    onCancel={() => {
                        setCreating(false);
                        setSource(null);
                    }}
                    onSave={handleCreate}
                    tools={resources.tools}
                />
            ) : null}
            {editing ? (
                <SkillEditor
                    key={editing.id}
                    onCancel={() => {
                        setEditing(null);
                    }}
                    onSave={handleUpdate}
                    onValidate={(draft) => resources.validateSkill(editing, draft)}
                    skill={editing}
                    tools={resources.tools}
                />
            ) : null}

            {resources.loading && resources.skills.length === 0 ? (
                <EmptyState>
                    <Loader2 className="animate-spin" size={18} />
                    {' '}
                    {t('common.loading')}
                </EmptyState>
            ) : (
                <div className="ai-resource-list">
                    {filtered.map((skill) => (
                        <SkillCard
                            expanded={expandedId === skill.id}
                            trialAgentId={principalAgentId || agents[0]?.id || ''}
                            onPackageSaved={() => { void resources.reload(); }}
                            baseSkill={resources.skills.find(base => base.id === skill.metadata?.derived_from?.id)}
                            automationNames={(resources.automations || []).filter(item => item.skill_id === skill.id).map(item => String(item.name))}
                            agentNames={new Map(agents.map(agent => [agent.id, agent.name || agent.id]))}
                            onUse={() => { setUsage({ skill, source: resources.skills.find(base => base.id === skill.metadata?.derived_from?.id) || null }); }}
                            canEdit={canEdit}
                            key={skill.id}
                            onClone={() => {
                                handleClone(skill);
                            }}
                            onDelete={() => {
                                void handleDelete(skill);
                            }}
                            onEdit={() => {
                                setEditing(skill);
                                setCreating(false);
                            }}
                            onToggle={() => {
                                setExpandedId((current) => (
                                    current === skill.id ? '' : skill.id
                                ));
                            }}
                            skill={skill}
                            toolsById={toolsById}
                        />
                    ))}
                    {!resources.error && filtered.length === 0 ? (
                        <EmptyState>{t('settings.ai.resources.no_skills')}</EmptyState>
                    ) : null}
                </div>
            )}
        </div>
    );
}
