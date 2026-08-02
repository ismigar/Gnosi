import React, { useMemo, useState } from 'react';
import {
    AlertTriangle,
    Check,
    ChevronDown,
    ChevronRight,
    CircleSlash2,
    ClipboardCopy,
    CloudDownload,
    Code2,
    Coins,
    Bell,
    BadgeDollarSign,
    ExternalLink,
    Files,
    FilePenLine,
    Loader2,
    LockKeyhole,
    Plus,
    RefreshCw,
    Search,
    ShieldAlert,
    Sparkles,
    Trash2,
    UserRound,
    Wrench,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { toast } from '../../lib/toast';
import {
    agentSkillWarnings,
    requiredSkillIdsForAgent,
    skillEffects,
} from './aiSettingsUtils';

const EFFECT_ICONS = {
    read: Search,
    local_write: FilePenLine,
    external_write: ExternalLink,
    destructive: ShieldAlert,
    code_execution: Code2,
    ai_cost: Coins,
    external_read: CloudDownload,
    personal_data: UserRound,
    data_egress: ExternalLink,
    bulk_write: Files,
    financial_cost: BadgeDollarSign,
    notification: Bell,
};

const effectLabel = (t, effect) => t(`settings.ai.resources.effects.${effect}`, {
    defaultValue: effect.replaceAll('_', ' '),
});

const originLabel = (t, origin) => {
    if (origin.type === 'plugin' && origin.id) {
        return t('settings.ai.resources.origin_plugin_name', { name: origin.id });
    }
    return t(`settings.ai.resources.origin_${origin.type}`, {
        defaultValue: origin.label,
    });
};

const statusLabel = (t, status) => t(`settings.ai.resources.status_${status}`, {
    defaultValue: status,
});

const EffectBadges = ({ effects }) => {
    const { t } = useTranslation();
    if (effects.length === 0) {
        return <span className="ai-resource-muted">{t('settings.ai.resources.no_effects')}</span>;
    }
    return (
        <div className="ai-resource-badges">
            {effects.map(effect => {
                const Icon = EFFECT_ICONS[effect] || Wrench;
                return (
                    <span key={effect} className={`ai-resource-badge ai-resource-badge--${effect}`}>
                        <Icon size={13} />
                        {effectLabel(t, effect)}
                    </span>
                );
            })}
        </div>
    );
};

const ResourceState = ({ available, status }) => {
    const { t } = useTranslation();
    return (
        <span className={`ai-resource-status ${available ? 'is-available' : 'is-unavailable'}`}>
            {available ? <Check size={13} /> : <CircleSlash2 size={13} />}
            {statusLabel(t, status)}
        </span>
    );
};

const EmptyState = ({ children }) => (
    <div className="ai-resource-empty">
        <Sparkles size={28} />
        <span>{children}</span>
    </div>
);

const SearchField = ({ value, onChange, placeholder }) => (
    <label className="ai-resource-search">
        <Search size={16} aria-hidden="true" />
        <input
            type="search"
            value={value}
            onChange={event => onChange(event.target.value)}
            placeholder={placeholder}
        />
    </label>
);

const createDraft = skill => ({
    name: skill?.name || '',
    description: skill?.description || '',
    instructions: skill?.instructions || '',
    activation: skill?.activation || 'automatic',
    toolIds: skill?.toolIds || [],
});

export const SkillEditor = ({ skill = null, tools, onSave, onValidate, onCancel }) => {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(() => createDraft(skill));
    const [toolSearch, setToolSearch] = useState('');
    const [saving, setSaving] = useState(false);
    const [validation, setValidation] = useState(null);
    const [validating, setValidating] = useState(false);
    const normalizedSearch = toolSearch.trim().toLowerCase();
    const visibleTools = tools.filter(tool => (
        !normalizedSearch
        || tool.name.toLowerCase().includes(normalizedSearch)
        || tool.id.toLowerCase().includes(normalizedSearch)
    ));
    const canSave = draft.name.trim() && draft.instructions.trim();

    const toggleTool = toolId => {
        setDraft(current => ({
            ...current,
            toolIds: current.toolIds.includes(toolId)
                ? current.toolIds.filter(id => id !== toolId)
                : [...current.toolIds, toolId],
        }));
    };

    const handleSave = async () => {
        if (!canSave || saving) return;
        setSaving(true);
        try {
            await onSave(draft);
        } finally {
            setSaving(false);
        }
    };

    const handleValidate = async () => {
        if (!onValidate || validating) return;
        setValidating(true);
        try {
            setValidation(await onValidate(draft));
        } catch (error) {
            console.error('Error validating AI skill:', error);
            setValidation({ valid: false, errors: [error.message] });
        } finally {
            setValidating(false);
        }
    };

    return (
        <div className="ai-resource-editor">
            <div className="ai-resource-editor__title">
                <Sparkles size={19} />
                <strong>
                    {skill
                        ? t('settings.ai.resources.edit_skill')
                        : t('settings.ai.resources.create_skill')}
                </strong>
            </div>
            <div className="ai-resource-editor__grid">
                <label>
                    <span>{t('settings.ai.resources.name')}</span>
                    <input
                        className="gnosi-input"
                        value={draft.name}
                        onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
                    />
                </label>
                <label>
                    <span>{t('settings.ai.resources.activation')}</span>
                    <select
                        className="gnosi-select"
                        value={draft.activation}
                        onChange={event => setDraft(current => ({ ...current, activation: event.target.value }))}
                    >
                        <option value="always">{t('settings.ai.resources.activation_always')}</option>
                        <option value="automatic">{t('settings.ai.resources.activation_automatic')}</option>
                        <option value="explicit">{t('settings.ai.resources.activation_explicit')}</option>
                    </select>
                </label>
            </div>
            <label>
                <span>{t('settings.ai.resources.description')}</span>
                <textarea
                    className="gnosi-input"
                    rows={2}
                    value={draft.description}
                    onChange={event => setDraft(current => ({ ...current, description: event.target.value }))}
                />
            </label>
            <label>
                <span>{t('settings.ai.resources.instructions')}</span>
                <textarea
                    className="gnosi-input"
                    rows={7}
                    value={draft.instructions}
                    onChange={event => setDraft(current => ({ ...current, instructions: event.target.value }))}
                />
            </label>
            <div className="ai-resource-editor__tools">
                <div>
                    <strong>{t('settings.ai.resources.approved_tools')}</strong>
                    <p>{t('settings.ai.resources.approved_tools_help')}</p>
                </div>
                <SearchField
                    value={toolSearch}
                    onChange={setToolSearch}
                    placeholder={t('settings.ai.resources.search_tools')}
                />
                <div className="ai-resource-tool-options">
                    {visibleTools.map(tool => (
                        <label
                            key={tool.id}
                            className={`ai-resource-tool-option ${tool.available ? '' : 'is-unavailable'}`}
                        >
                            <input
                                type="checkbox"
                                checked={draft.toolIds.includes(tool.id)}
                                disabled={!tool.available && !draft.toolIds.includes(tool.id)}
                                onChange={() => toggleTool(tool.id)}
                            />
                            <span className="ai-resource-tool-option__copy">
                                <strong>{tool.name}</strong>
                                <code>{tool.id}</code>
                                <EffectBadges effects={tool.effects} />
                            </span>
                            <ResourceState available={tool.available} status={tool.status} />
                        </label>
                    ))}
                    {visibleTools.length === 0 && (
                        <span className="ai-resource-muted">{t('settings.ai.resources.no_matching_tools')}</span>
                    )}
                </div>
            </div>
            {!draft.name.trim() || !draft.instructions.trim() ? (
                <div className="ai-resource-validation">
                    <AlertTriangle size={15} />
                    {t('settings.ai.resources.required_fields')}
                </div>
            ) : null}
            {validation && (
                <div className={`ai-resource-alert ${validation.valid ? '' : 'is-warning'}`}>
                    {validation.valid ? <Check size={16} /> : <AlertTriangle size={16} />}
                    <span>
                        {validation.valid
                            ? t('settings.ai.resources.validation_valid')
                            : t('settings.ai.resources.validation_invalid', {
                                errors: (validation.errors || validation.missing_tool_ids || []).join(', '),
                            })}
                    </span>
                </div>
            )}
            <div className="ai-resource-editor__actions">
                <button type="button" className="btn-gnosi-secondary" onClick={onCancel}>
                    {t('common.cancel')}
                </button>
                {skill && onValidate && (
                    <button
                        type="button"
                        className="btn-gnosi-secondary"
                        onClick={handleValidate}
                        disabled={validating || !canSave}
                    >
                        {validating ? <Loader2 size={16} className="animate-spin" /> : <ShieldAlert size={16} />}
                        {t('settings.ai.resources.validate')}
                    </button>
                )}
                <button type="button" className="btn-gnosi-primary" onClick={handleSave} disabled={!canSave || saving}>
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    {t('common.save')}
                </button>
            </div>
        </div>
    );
};

const SkillDetails = ({ skill, toolsById }) => {
    const { t } = useTranslation();
    const effects = skillEffects(skill, toolsById);
    return (
        <div className="ai-resource-details">
            {skill.instructions && (
                <div>
                    <strong>{t('settings.ai.resources.instructions')}</strong>
                    <pre>{skill.instructions}</pre>
                </div>
            )}
            <div>
                <strong>{t('settings.ai.resources.effects_title')}</strong>
                <EffectBadges effects={effects} />
            </div>
            <div>
                <strong>{t('settings.ai.resources.tools')}</strong>
                {skill.toolIds.length > 0 ? (
                    <ul>
                        {skill.toolIds.map(toolId => {
                            const tool = toolsById.get(toolId);
                            return (
                                <li key={toolId} className={!tool?.available ? 'is-unavailable' : ''}>
                                    <code>{toolId}</code>
                                    {!tool?.available && <AlertTriangle size={14} />}
                                </li>
                            );
                        })}
                    </ul>
                ) : <span className="ai-resource-muted">{t('settings.ai.resources.no_tools')}</span>}
            </div>
            <div>
                <strong>{t('settings.ai.resources.consuming_agents')}</strong>
                <span>
                    {skill.agentIds.length > 0
                        ? skill.agentIds.join(', ')
                        : t('settings.ai.resources.no_agents')}
                </span>
            </div>
        </div>
    );
};

const SkillCard = ({
    skill,
    toolsById,
    expanded,
    onToggle,
    onEdit,
    onClone,
    onDelete,
}) => {
    const { t } = useTranslation();
    const effects = skillEffects(skill, toolsById);
    return (
        <article className={`ai-resource-card ${expanded ? 'is-expanded' : ''}`}>
            <button type="button" className="ai-resource-card__main" onClick={onToggle}>
                {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <span className="ai-resource-card__copy">
                    <span className="ai-resource-card__heading">
                        <strong>{skill.name}</strong>
                        <code>{skill.id}</code>
                    </span>
                    <span>{skill.description || t('settings.ai.resources.no_description')}</span>
                    <span className="ai-resource-card__meta">
                        <span>{originLabel(t, skill.origin)}</span>
                        <span>{t(`settings.ai.resources.activation_${skill.activation}`)}</span>
                        <span>{t('settings.ai.resources.tool_count', { count: skill.toolIds.length })}</span>
                    </span>
                    <EffectBadges effects={effects} />
                </span>
                <ResourceState available={skill.available} status={skill.status} />
            </button>
            <div className="ai-resource-card__actions">
                {skill.editable && (
                    <button type="button" onClick={onEdit}>
                        <FilePenLine size={15} />
                        {t('common.edit')}
                    </button>
                )}
                {skill.cloneable && (
                    <button type="button" onClick={onClone}>
                        <ClipboardCopy size={15} />
                        {t('settings.ai.resources.clone')}
                    </button>
                )}
                {skill.deletable && (
                    <button type="button" className="is-danger" onClick={onDelete}>
                        <Trash2 size={15} />
                        {t('common.delete')}
                    </button>
                )}
            </div>
            {expanded && <SkillDetails skill={skill} toolsById={toolsById} />}
        </article>
    );
};

export const SkillsSettingsPanel = ({
    resources,
    agents,
    onAgentsChanged,
}) => {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const [origin, setOrigin] = useState('all');
    const [expandedId, setExpandedId] = useState('');
    const [editing, setEditing] = useState(null);
    const [creating, setCreating] = useState(false);
    const [deletionConflict, setDeletionConflict] = useState(null);
    const normalizedSearch = search.trim().toLowerCase();
    const toolsById = useMemo(
        () => new Map(resources.tools.map(tool => [tool.id, tool])),
        [resources.tools],
    );
    const skillsWithConsumers = useMemo(() => resources.skills.map(skill => ({
        ...skill,
        agentIds: [
            ...new Set([
                ...skill.agentIds,
                ...agents
                    .filter(agent => (agent.skill_ids || []).includes(skill.id))
                    .map(agent => agent.id),
            ]),
        ],
    })), [agents, resources.skills]);
    const filtered = skillsWithConsumers.filter(skill => (
        (origin === 'all' || skill.origin.type === origin)
        && (
            !normalizedSearch
            || skill.name.toLowerCase().includes(normalizedSearch)
            || skill.id.toLowerCase().includes(normalizedSearch)
            || skill.description.toLowerCase().includes(normalizedSearch)
        )
    ));

    const handleCreate = async draft => {
        try {
            const skill = await resources.createSkill(draft);
            setCreating(false);
            setExpandedId(skill.id);
            toast.success(t('settings.ai.resources.skill_created'));
        } catch (error) {
            console.error('Error creating AI skill:', error);
            toast.error(t('settings.ai.resources.save_error'));
        }
    };

    const handleUpdate = async draft => {
        try {
            const skill = await resources.updateSkill(editing, draft);
            setEditing(null);
            setExpandedId(skill.id);
            toast.success(t('settings.ai.resources.skill_updated'));
        } catch (error) {
            console.error('Error updating AI skill:', error);
            toast.error(t('settings.ai.resources.save_error'));
        }
    };

    const handleClone = async skill => {
        try {
            const created = await resources.cloneSkill(
                skill,
                t('settings.ai.resources.clone_name', { name: skill.name }),
            );
            setExpandedId(created.id);
            setEditing(created);
            toast.success(t('settings.ai.resources.skill_cloned'));
        } catch (error) {
            console.error('Error cloning AI skill:', error);
            toast.error(t('settings.ai.resources.save_error'));
        }
    };

    const handleDelete = async skill => {
        try {
            const result = await resources.deleteSkill(skill);
            if (!result.deleted) {
                setDeletionConflict({ skill, affectedAgents: result.affectedAgents });
                return;
            }
            toast.success(t('settings.ai.resources.skill_deleted'));
        } catch (error) {
            console.error('Error deleting AI skill:', error);
            toast.error(t('settings.ai.resources.delete_error'));
        }
    };

    const confirmConflictDelete = async () => {
        const conflict = deletionConflict;
        if (!conflict) return;
        try {
            const result = await resources.deleteSkill(conflict.skill, true);
            if (!result.deleted) return;
            const affectedIds = new Set(conflict.affectedAgents.map(agent => (
                typeof agent === 'string' ? agent : agent.id
            )));
            onAgentsChanged(agents.map(agent => (
                affectedIds.has(agent.id)
                    ? {
                        ...agent,
                        skill_ids: (agent.skill_ids || []).filter(id => id !== conflict.skill.id),
                    }
                    : agent
            )));
            setDeletionConflict(null);
            toast.success(t('settings.ai.resources.skill_deleted'));
        } catch (error) {
            console.error('Error unassigning and deleting AI skill:', error);
            toast.error(t('settings.ai.resources.delete_error'));
        }
    };

    return (
        <div className="ai-resources-panel">
            <div className="ai-resources-toolbar">
                <SearchField
                    value={search}
                    onChange={setSearch}
                    placeholder={t('settings.ai.resources.search_skills')}
                />
                <select className="gnosi-select" value={origin} onChange={event => setOrigin(event.target.value)}>
                    <option value="all">{t('settings.ai.resources.all_origins')}</option>
                    <option value="core">{t('settings.ai.resources.origin_core')}</option>
                    <option value="plugin">{t('settings.ai.resources.origin_plugin')}</option>
                    <option value="user">{t('settings.ai.resources.origin_user')}</option>
                </select>
                <button
                    type="button"
                    className="btn-gnosi-primary"
                    onClick={() => {
                        setCreating(current => !current);
                        setEditing(null);
                    }}
                >
                    {creating ? <ChevronDown size={16} /> : <Plus size={16} />}
                    {t('settings.ai.resources.new_skill')}
                </button>
                <button
                    type="button"
                    className="ai-resource-icon-button"
                    onClick={resources.reload}
                    aria-label={t('settings.ai.resources.reload')}
                    title={t('settings.ai.resources.reload')}
                >
                    <RefreshCw size={17} className={resources.loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {resources.error && (
                <div className="ai-resource-alert is-error">
                    <AlertTriangle size={17} />
                    <span>{t('settings.ai.resources.load_error')}: {resources.error}</span>
                </div>
            )}
            {resources.issues?.length > 0 && (
                <div className="ai-resource-alert is-warning">
                    <AlertTriangle size={17} />
                    <div>
                        <strong>{t('settings.ai.resources.catalog_issues')}</strong>
                        <ul>
                            {resources.issues.map((issue, index) => (
                                <li key={`${issue?.path || issue?.skill_id || 'issue'}-${index}`}>
                                    {issue?.path || issue?.skill_id
                                        ? <code>{issue.path || issue.skill_id}: </code>
                                        : null}
                                    {issue?.message || issue?.detail || issue?.error || String(issue)}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}

            {deletionConflict && (
                <div className="ai-resource-alert is-warning">
                    <ShieldAlert size={19} />
                    <div>
                        <strong>{t('settings.ai.resources.delete_conflict_title')}</strong>
                        <p>
                            {t('settings.ai.resources.delete_conflict_description', {
                                count: deletionConflict.affectedAgents.length,
                                agents: deletionConflict.affectedAgents.map(agent => (
                                    typeof agent === 'string' ? agent : agent.name || agent.id
                                )).join(', '),
                            })}
                        </p>
                        <div className="ai-resource-alert__actions">
                            <button type="button" onClick={() => setDeletionConflict(null)}>
                                {t('common.cancel')}
                            </button>
                            <button type="button" className="is-danger" onClick={confirmConflictDelete}>
                                {t('settings.ai.resources.unassign_and_delete')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {creating && (
                <SkillEditor
                    tools={resources.tools}
                    onSave={handleCreate}
                    onCancel={() => setCreating(false)}
                />
            )}
            {editing && (
                <SkillEditor
                    key={editing.id}
                    skill={editing}
                    tools={resources.tools}
                    onSave={handleUpdate}
                    onValidate={draft => resources.validateSkill(editing, draft)}
                    onCancel={() => setEditing(null)}
                />
            )}

            {resources.loading && resources.skills.length === 0 ? (
                <EmptyState><Loader2 size={18} className="animate-spin" /> {t('common.loading')}</EmptyState>
            ) : (
                <div className="ai-resource-list">
                    {filtered.map(skill => (
                        <SkillCard
                            key={skill.id}
                            skill={skill}
                            toolsById={toolsById}
                            expanded={expandedId === skill.id}
                            onToggle={() => setExpandedId(current => current === skill.id ? '' : skill.id)}
                            onEdit={() => {
                                setEditing(skill);
                                setCreating(false);
                            }}
                            onClone={() => handleClone(skill)}
                            onDelete={() => handleDelete(skill)}
                        />
                    ))}
                    {filtered.length === 0 && (
                        <EmptyState>{t('settings.ai.resources.no_skills')}</EmptyState>
                    )}
                </div>
            )}
        </div>
    );
};

const JsonSchemaDetails = ({ label, schema }) => {
    const [open, setOpen] = useState(false);
    if (!schema) return null;
    return (
        <div className="ai-tool-schema">
            <button type="button" onClick={() => setOpen(current => !current)}>
                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                {label}
            </button>
            {open && <pre>{JSON.stringify(schema, null, 2)}</pre>}
        </div>
    );
};

export const ToolsSettingsPanel = ({ resources }) => {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('all');
    const [expandedId, setExpandedId] = useState('');
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = resources.tools.filter(tool => (
        (status === 'all' || tool.status === status)
        && (
            !normalizedSearch
            || tool.name.toLowerCase().includes(normalizedSearch)
            || tool.id.toLowerCase().includes(normalizedSearch)
            || tool.description.toLowerCase().includes(normalizedSearch)
        )
    ));

    return (
        <div className="ai-resources-panel">
            <div className="ai-resource-alert">
                <LockKeyhole size={18} />
                <span>{t('settings.ai.resources.tools_governance')}</span>
            </div>
            <div className="ai-resources-toolbar">
                <SearchField
                    value={search}
                    onChange={setSearch}
                    placeholder={t('settings.ai.resources.search_tools')}
                />
                <select className="gnosi-select" value={status} onChange={event => setStatus(event.target.value)}>
                    <option value="all">{t('settings.ai.resources.all_statuses')}</option>
                    <option value="available">{t('settings.ai.resources.status_available')}</option>
                    <option value="pending">{t('settings.ai.resources.status_pending')}</option>
                    <option value="suspended">{t('settings.ai.resources.status_suspended')}</option>
                    <option value="rejected">{t('settings.ai.resources.status_rejected')}</option>
                    <option value="revoked">{t('settings.ai.resources.status_revoked')}</option>
                    <option value="unavailable">{t('settings.ai.resources.status_unavailable')}</option>
                </select>
                <button
                    type="button"
                    className="ai-resource-icon-button"
                    onClick={resources.reload}
                    aria-label={t('settings.ai.resources.reload')}
                    title={t('settings.ai.resources.reload')}
                >
                    <RefreshCw size={17} className={resources.loading ? 'animate-spin' : ''} />
                </button>
            </div>
            {resources.error && (
                <div className="ai-resource-alert is-error">
                    <AlertTriangle size={17} />
                    <span>{t('settings.ai.resources.load_error')}: {resources.error}</span>
                </div>
            )}
            <div className="ai-resource-list">
                {filtered.map(tool => {
                    const expanded = expandedId === tool.id;
                    return (
                        <article key={tool.id} className={`ai-resource-card ${expanded ? 'is-expanded' : ''}`}>
                            <button
                                type="button"
                                className="ai-resource-card__main"
                                onClick={() => setExpandedId(current => current === tool.id ? '' : tool.id)}
                            >
                                {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                <span className="ai-resource-card__copy">
                                    <span className="ai-resource-card__heading">
                                        <strong>{tool.name}</strong>
                                        <code>{tool.id}</code>
                                    </span>
                                    <span>{tool.description || t('settings.ai.resources.no_description')}</span>
                                    <span className="ai-resource-card__meta">
                                        <span>{originLabel(t, tool.origin)}</span>
                                        <span>{t('settings.ai.resources.version', { version: tool.version })}</span>
                                        {tool.minimumRole && (
                                            <span>{t('settings.ai.resources.minimum_role', { role: tool.minimumRole })}</span>
                                        )}
                                    </span>
                                    <EffectBadges effects={tool.effects} />
                                </span>
                                <ResourceState available={tool.available} status={tool.status} />
                            </button>
                            {expanded && (
                                <div className="ai-resource-details">
                                    <div>
                                        <strong>{t('settings.ai.resources.confirmation')}</strong>
                                        <span>{statusLabel(t, tool.confirmation)}</span>
                                    </div>
                                    <div>
                                        <strong>{t('settings.ai.resources.consuming_skills')}</strong>
                                        <span>
                                            {tool.skillIds.length > 0
                                                ? tool.skillIds.join(', ')
                                                : t('settings.ai.resources.no_skills_using_tool')}
                                        </span>
                                    </div>
                                    {tool.approvalStatus && (
                                        <div>
                                            <strong>{t('settings.ai.resources.approval')}</strong>
                                            <span>{statusLabel(t, tool.approvalStatus)}</span>
                                        </div>
                                    )}
                                    <JsonSchemaDetails
                                        label={t('settings.ai.resources.input_schema')}
                                        schema={tool.inputSchema}
                                    />
                                    <JsonSchemaDetails
                                        label={t('settings.ai.resources.output_schema')}
                                        schema={tool.outputSchema}
                                    />
                                </div>
                            )}
                        </article>
                    );
                })}
                {!resources.loading && filtered.length === 0 && (
                    <EmptyState>{t('settings.ai.resources.no_tools_catalog')}</EmptyState>
                )}
            </div>
        </div>
    );
};

export const AgentSkillsField = ({
    agent,
    skills,
    tools,
    registry,
    selectedIds,
    onChange,
}) => {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const normalizedSearch = search.trim().toLowerCase();
    const assignable = skills.filter(skill => skill.assignable);
    const requiredIds = requiredSkillIdsForAgent(
        { ...agent, skill_ids: selectedIds },
        assignable,
    );
    const visibleSkills = assignable.filter(skill => (
        !normalizedSearch
        || skill.name.toLowerCase().includes(normalizedSearch)
        || skill.id.toLowerCase().includes(normalizedSearch)
        || skill.description.toLowerCase().includes(normalizedSearch)
    ));
    const knownIds = new Set(assignable.map(skill => skill.id));
    const missingIds = selectedIds.filter(id => !knownIds.has(id));
    const warnings = agentSkillWarnings(agent, selectedIds, assignable, tools, registry);
    const toolsById = useMemo(
        () => new Map(tools.map(tool => [tool.id, tool])),
        [tools],
    );

    const toggleSkill = skill => {
        if (requiredIds.has(skill.id)) return;
        onChange(
            selectedIds.includes(skill.id)
                ? selectedIds.filter(id => id !== skill.id)
                : [...selectedIds, skill.id],
        );
    };

    return (
        <div className="ai-agent-skills">
            <SearchField
                value={search}
                onChange={setSearch}
                placeholder={t('settings.ai.resources.search_assignable_skills')}
            />
            <div className="ai-agent-skills__list">
                {missingIds.map(skillId => (
                    <label key={skillId} className="ai-agent-skill is-selected is-unavailable">
                        <input
                            type="checkbox"
                            checked
                            onChange={() => onChange(selectedIds.filter(id => id !== skillId))}
                        />
                        <span className="ai-agent-skill__copy">
                            <strong>{t('settings.ai.resources.missing_skill')}</strong>
                            <span>{skillId}</span>
                        </span>
                        <span className="ai-agent-skill__meta">
                            <span><AlertTriangle size={14} /> {t('settings.ai.resources.status_missing')}</span>
                        </span>
                    </label>
                ))}
                {visibleSkills.map(skill => {
                    const selected = selectedIds.includes(skill.id);
                    const required = requiredIds.has(skill.id);
                    return (
                        <label
                            key={skill.id}
                            className={`ai-agent-skill ${selected ? 'is-selected' : ''} ${skill.available ? '' : 'is-unavailable'}`}
                        >
                            <input
                                type="checkbox"
                                checked={selected}
                                disabled={required || (!skill.available && !selected)}
                                onChange={() => toggleSkill(skill)}
                            />
                            <span className="ai-agent-skill__copy">
                                <strong>{skill.name}</strong>
                                <span>{skill.description || skill.id}</span>
                                <EffectBadges effects={skillEffects(skill, toolsById)} />
                            </span>
                            <span className="ai-agent-skill__meta">
                                {required && (
                                    <span title={t('settings.ai.resources.required_skill')}>
                                        <LockKeyhole size={14} />
                                        {t('settings.ai.resources.required')}
                                    </span>
                                )}
                                <span>{originLabel(t, skill.origin)}</span>
                            </span>
                        </label>
                    );
                })}
                {visibleSkills.length === 0 && missingIds.length === 0 && (
                    <span className="ai-resource-muted">{t('settings.ai.resources.no_assignable_skills')}</span>
                )}
            </div>
            {warnings.map((warning, index) => (
                <div key={`${warning.type}-${index}`} className="ai-resource-alert is-warning">
                    <AlertTriangle size={17} />
                    <span>
                        {warning.type === 'model_tools'
                            ? t('settings.ai.resources.model_incompatible')
                            : t('settings.ai.resources.skills_unavailable', {
                                skills: warning.skillNames.join(', '),
                            })}
                    </span>
                </div>
            ))}
        </div>
    );
};
