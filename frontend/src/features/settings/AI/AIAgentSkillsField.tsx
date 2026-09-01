import { useMemo, useState } from 'react';
import { AlertTriangle, LockKeyhole } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    localizedResourceSearchText,
    skillDisplayDescription,
    skillDisplayName,
} from './aiResourceI18n';
import { originLabel } from './aiResourceLabels';
import type { AIResourceAgent } from './aiResourceSettingsTypes';
import {
    agentSkillWarnings,
    type NormalizedSkill,
    type NormalizedTool,
    requiredSkillIdsForAgent,
    skillEffects,
} from './aiSettingsUtils';
import {
    EffectBadges,
    SearchField,
} from './AIResourcePrimitives';


interface AgentSkillsFieldProps {
    readonly agent: AIResourceAgent;
    readonly onChange: (selectedIds: string[]) => void;
    readonly registry: unknown;
    readonly selectedIds: readonly string[];
    readonly skills: readonly NormalizedSkill[];
    readonly tools: readonly NormalizedTool[];
}


export function AgentSkillsField({
    agent,
    onChange,
    registry,
    selectedIds,
    skills,
    tools,
}: AgentSkillsFieldProps) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const normalizedSearch = search.trim().toLowerCase();
    const assignable = skills.filter((skill) => skill.assignable);
    const requiredIds = requiredSkillIdsForAgent(
        { ...agent, skill_ids: [...selectedIds] },
        assignable,
    );
    const visibleSkills = assignable.filter((skill) => (
        !normalizedSearch
        || localizedResourceSearchText(t, skill, 'skill').includes(normalizedSearch)
    ));
    const knownIds = new Set(assignable.map((skill) => skill.id));
    const missingIds = selectedIds.filter((id) => !knownIds.has(id));
    const warnings = agentSkillWarnings(
        agent,
        selectedIds,
        assignable,
        tools,
        registry,
    );
    const toolsById = useMemo(
        () => new Map(tools.map((tool) => [tool.id, tool])),
        [tools],
    );

    const toggleSkill = (skill: NormalizedSkill): void => {
        if (requiredIds.has(skill.id)) return;
        onChange(
            selectedIds.includes(skill.id)
                ? selectedIds.filter((id) => id !== skill.id)
                : [...selectedIds, skill.id],
        );
    };

    return (
        <div className="ai-agent-skills">
            <SearchField
                onChange={setSearch}
                placeholder={t('settings.ai.resources.search_assignable_skills')}
                value={search}
            />
            <div className="ai-agent-skills__list">
                {missingIds.map((skillId) => (
                    <label
                        className="ai-agent-skill is-selected is-unavailable"
                        key={skillId}
                    >
                        <input
                            checked
                            onChange={() => {
                                onChange(selectedIds.filter((id) => id !== skillId));
                            }}
                            type="checkbox"
                        />
                        <span className="ai-agent-skill__copy">
                            <strong>{t('settings.ai.resources.missing_skill')}</strong>
                            <span>{skillId}</span>
                        </span>
                        <span className="ai-agent-skill__meta">
                            <span>
                                <AlertTriangle size={14} />
                                {t('settings.ai.resources.status_missing')}
                            </span>
                        </span>
                    </label>
                ))}
                {visibleSkills.map((skill) => {
                    const selected = selectedIds.includes(skill.id);
                    const required = requiredIds.has(skill.id);
                    return (
                        <label
                            className={`ai-agent-skill ${selected
                                ? 'is-selected'
                                : ''} ${skill.available
                                ? ''
                                : 'is-unavailable'}`}
                            key={skill.id}
                        >
                            <input
                                checked={selected}
                                disabled={required || (!skill.available && !selected)}
                                onChange={() => {
                                    toggleSkill(skill);
                                }}
                                type="checkbox"
                            />
                            <span className="ai-agent-skill__copy">
                                <strong>{skillDisplayName(t, skill)}</strong>
                                <span>{skillDisplayDescription(t, skill) || skill.id}</span>
                                <EffectBadges effects={skillEffects(skill, toolsById)} />
                            </span>
                            <span className="ai-agent-skill__meta">
                                {required ? (
                                    <span title={t('settings.ai.resources.required_skill')}>
                                        <LockKeyhole size={14} />
                                        {t('settings.ai.resources.required')}
                                    </span>
                                ) : null}
                                <span>{originLabel(t, skill.origin)}</span>
                            </span>
                        </label>
                    );
                })}
                {visibleSkills.length === 0 && missingIds.length === 0 ? (
                    <span className="ai-resource-muted">
                        {t('settings.ai.resources.no_assignable_skills')}
                    </span>
                ) : null}
            </div>
            {warnings.map((warning, index) => (
                <div
                    className="ai-resource-alert is-warning"
                    key={`${warning.type}-${index.toString()}`}
                >
                    <AlertTriangle size={17} />
                    <span>{warning.type === 'model_tools'
                        ? t('settings.ai.resources.model_incompatible')
                        : t('settings.ai.resources.skills_unavailable', {
                            skills: warning.skillNames.map((name) => {
                                const skill = assignable.find((item) => item.name === name);
                                return skill ? skillDisplayName(t, skill) : name;
                            }).join(', '),
                        })}</span>
                </div>
            ))}
        </div>
    );
}
