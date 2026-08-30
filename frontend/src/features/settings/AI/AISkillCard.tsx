import {
    AlertTriangle,
    ChevronDown,
    ChevronRight,
    ClipboardCopy,
    FilePenLine,
    Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { NormalizedSkill, NormalizedTool } from './aiSettingsUtils';
import { skillEffects } from './aiSettingsUtils';
import {
    skillDisplayDescription,
    skillDisplayInstructions,
    skillDisplayName,
} from './aiResourceI18n';
import { originLabel } from './aiResourceLabels';
import {
    EffectBadges,
    ResourceState,
} from './AIResourcePrimitives';


interface SkillCardProps {
    readonly expanded: boolean;
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
}: Pick<SkillCardProps, 'skill' | 'toolsById'>) {
    const { t } = useTranslation();
    return (
        <div className="ai-resource-details">
            {skill.instructions ? (
                <div>
                    <strong>{t('settings.ai.resources.instructions')}</strong>
                    <pre>{skillDisplayInstructions(t, skill)}</pre>
                </div>
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
                                    <code>{toolId}</code>
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
                    ? skill.agentIds.join(', ')
                    : t('settings.ai.resources.no_agents')}</span>
            </div>
        </div>
    );
}


export function SkillCard({
    expanded,
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
                        <code>{skill.id}</code>
                    </span>
                    <span>{skillDisplayDescription(t, skill)
                        || t('settings.ai.resources.no_description')}</span>
                    <span className="ai-resource-card__meta">
                        <span>{originLabel(t, skill.origin)}</span>
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
                {skill.editable ? (
                    <button onClick={onEdit} type="button">
                        <FilePenLine size={15} />
                        {t('common.edit')}
                    </button>
                ) : null}
                {skill.cloneable ? (
                    <button onClick={onClone} type="button">
                        <ClipboardCopy size={15} />
                        {t('settings.ai.resources.clone')}
                    </button>
                ) : null}
                {skill.deletable ? (
                    <button className="is-danger" onClick={onDelete} type="button">
                        <Trash2 size={15} />
                        {t('common.delete')}
                    </button>
                ) : null}
            </div>
            {expanded ? <SkillDetails skill={skill} toolsById={toolsById} /> : null}
        </article>
    );
}
