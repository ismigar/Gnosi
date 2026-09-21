import { SkillPackageTools } from '../../agent-learning';
import {
    AlertTriangle,
    ChevronDown,
    ChevronRight,
    ClipboardCopy,
    FilePenLine,
    Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SkillInstructions } from './SkillInstructions';

import type { NormalizedSkill, NormalizedTool } from './aiSettingsUtils';
import { skillEffects } from './aiSettingsUtils';
import {
    skillDisplayDescription,
    skillDisplayName,
    toolDisplayName,
    toolDisplayDescription,
    skillCategory,
    resourceExample,
    domainLabel,
} from './aiResourceI18n';
import { originLabel } from './aiResourceLabels';
import {
    EffectBadges,
    ResourceState,
} from './AIResourcePrimitives';


interface SkillCardProps {
    readonly expanded: boolean;
    readonly trialAgentId?: string;
    readonly onPackageSaved?: () => void;
    readonly baseSkill?: NormalizedSkill;
    readonly automationNames?: readonly string[];
    readonly agentNames?: ReadonlyMap<string, string>;
    readonly canEdit?: boolean;
    readonly onUse?: () => void;
    readonly onClone: () => void;
    readonly onDelete: () => void;
    readonly onEdit: () => void;
    readonly onToggle: () => void;
    readonly skill: NormalizedSkill;
    readonly toolsById: ReadonlyMap<string, NormalizedTool>;
}


function SkillDetails({
    skill,
    toolsById,
    agentNames,
}: Pick<SkillCardProps, 'skill' | 'toolsById' | 'agentNames'>) {
    const { t } = useTranslation();
    return (
        <div className="ai-resource-details">
            {skill.instructions ? (
                <SkillInstructions skill={skill} />
            ) : null}
            <div>
                <strong>{t('settings.ai.resources.effects_title')}</strong>
                <EffectBadges effects={skillEffects(skill, toolsById)} />
            </div>
            <div>
                <strong>{t('settings.ai.resources.tools')}</strong>
                {skill.toolIds.length > 0 ? (
                    <ul>
                        {skill.toolIds.map((toolId) => {
                            const tool = toolsById.get(toolId);
                            return (
                                <li
                                    className={tool?.available ? '' : 'is-unavailable'}
                                    key={toolId}
                                >
                                    <span><strong>{toolDisplayName(t, tool ?? { id: toolId })}</strong><p>{toolDisplayDescription(t, tool)}</p></span>
                                    {!tool?.available ? <AlertTriangle size={14} /> : null}
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <span className="ai-resource-muted">
                        {t('settings.ai.resources.no_tools')}
                    </span>
                )}
            </div>
            <div>
                <strong>{t('settings.ai.resources.consuming_agents')}</strong>
                <span>{skill.agentIds.length > 0
                    ? skill.agentIds.map(id => agentNames?.get(id) || id).join(', ')
                    : t('settings.ai.resources.no_agents')}</span>
            </div>
        </div>
    );
}


export function SkillCard({
    expanded,
    trialAgentId = '',
    onPackageSaved,
    baseSkill,
    automationNames = [],
    agentNames,
    canEdit = true,
    onUse,
    onClone,
    onDelete,
    onEdit,
    onToggle,
    skill,
    toolsById,
}: SkillCardProps) {
    const { t } = useTranslation();
    const effects = skillEffects(skill, toolsById);
    return (
        <article className={`ai-resource-card ${expanded ? 'is-expanded' : ''}`}>
            <button
                className="ai-resource-card__main"
                onClick={onToggle}
                type="button"
            >
                {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <span className="ai-resource-card__copy">
                    <span className="ai-resource-card__heading">
                        <strong>{skillDisplayName(t, skill)}</strong>

                    </span>
                    <span>{skillDisplayDescription(t, skill)
                        || t('settings.ai.resources.no_description')}</span>
                    <span className="ai-resource-card__meta">
                        <span>{originLabel(t, skill.origin)}</span>
                        <span>{t(`settings.ai.resources.category_${skillCategory(skill)}`)}</span>
                        <span>{t(`settings.ai.resources.activation_${skill.activation}`)}</span>
                        <span>{t('settings.ai.resources.tool_count', {
                            count: skill.toolIds.length,
                        })}</span>
                    </span>
                    <EffectBadges effects={effects} />
                </span>
                <ResourceState available={skill.available} status={skill.status} />
            </button>
            <div className="ai-resource-card__actions">
                {canEdit && skill.editable && onUse && <button onClick={onUse} type="button">{t('settings.ai.resources.assign_copy')}</button>}
                {canEdit && skill.editable ? (
                    <button onClick={onEdit} type="button">
                        <FilePenLine size={15} />
                        {t('common.edit')}
                    </button>
                ) : null}
                {canEdit && skill.cloneable ? (
                    <button onClick={onClone} type="button">
                        <ClipboardCopy size={15} />
                        {t('settings.ai.resources.customize')}
                    </button>
                ) : null}
                {canEdit && skill.deletable ? (
                    <button className="is-danger" onClick={onDelete} type="button">
                        <Trash2 size={15} />
                        {t('common.delete')}
                    </button>
                ) : null}
            </div>
            {expanded ? <>
                <SkillPackageTools skillId={skill.id} agentId={trialAgentId} canEdit={canEdit} onSaved={onPackageSaved} />
                {resourceExample(t, skill) && <p className="ai-resource-details">{t('settings.ai.resources.example')}: {resourceExample(t, skill)}</p>}
                {(skill.metadata?.required_source_ids || baseSkill?.metadata?.required_source_ids)?.length ? <p className="ai-resource-details">{t('settings.ai.resources.required_sources')}: {(skill.metadata?.required_source_ids || baseSkill?.metadata?.required_source_ids || []).map(id => domainLabel(t, id)).join(', ')}</p> : null}
                {skill.required && <p className="ai-resource-details">{t('settings.ai.resources.required_skill')} · {t('settings.ai.resources.required_copy_help')}</p>}
                {!canEdit && <p>{t('settings.ai.resources.edit_permission')}</p>}
                {skill.cloneable && <p className="ai-resource-details">{t('settings.ai.resources.customize_help')}</p>}
                {skill.metadata?.derived_from && <div className="ai-resource-details">
                    <p>{t('settings.ai.resources.based_on', { name: baseSkill ? skillDisplayName(t, baseSkill) : skill.metadata.derived_from.name, version: skill.metadata.derived_from.version })}</p>
                    {baseSkill && baseSkill.revision !== skill.metadata.derived_from.revision && <p role="status">{t('settings.ai.resources.source_changed')}</p>}
                    <details><summary>{t('settings.ai.resources.compare_original')}</summary><pre>{baseSkill?.instructions || skill.metadata.derived_from.instructions}</pre></details>
                </div>}
                <div className="ai-resource-details"><strong>{t('settings.ai.resources.consuming_automations')}</strong><span>{automationNames.join(', ') || t('settings.ai.resources.no_automations')}</span></div>
                <SkillDetails skill={skill} toolsById={toolsById} agentNames={agentNames} />
                <details className="ai-resource-details"><summary>{t('settings.ai.resources.technical_details')}</summary><code>{skill.id}</code><span>{skill.version}</span></details>
            </> : null}
        </article>
    );
}
