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
import { localizedResourceSearchText } from './aiResourceI18n';
import type {
    AIResourceAgent,
    SkillResources,
} from './aiResourceSettingsTypes';
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
    onAgentsChanged,
    resources,
}: SkillsSettingsPanelProps) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const [origin, setOrigin] = useState('all');
    const [expandedId, setExpandedId] = useState('');
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
        && (
            !normalizedSearch
            || localizedResourceSearchText(t, skill, 'skill').includes(normalizedSearch)
        )
    ));

    const handleCreate = async (draft: SkillDraft): Promise<void> => {
        try {
            const skill = await resources.createSkill(draft);
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
    const handleClone = async (skill: NormalizedSkill): Promise<void> => {
        try {
            const created = await resources.cloneSkill(
                skill,
                t('settings.ai.resources.clone_name', { name: skill.name }),
            );
            setExpandedId(created.id);
            setEditing(created);
            toast.success(t('settings.ai.resources.skill_cloned'));
        } catch (error: unknown) {
            logError('ai-skill-clone', error);
            toast.error(t('settings.ai.resources.save_error'));
        }
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
                    onClick={() => {
                        setCreating((current) => !current);
                        setEditing(null);
                    }}
                    type="button"
                >
                    {creating ? <ChevronDown size={16} /> : <Plus size={16} />}
                    {t('settings.ai.resources.new_skill')}
                </button>
            </div>

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

            {creating ? (
                <SkillEditor
                    onCancel={() => {
                        setCreating(false);
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
                            key={skill.id}
                            onClone={() => {
                                void handleClone(skill);
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
                    {filtered.length === 0 ? (
                        <EmptyState>{t('settings.ai.resources.no_skills')}</EmptyState>
                    ) : null}
                </div>
            )}
        </div>
    );
}
