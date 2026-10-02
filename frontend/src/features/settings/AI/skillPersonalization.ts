import type { NormalizedSkill } from './aiSettingsUtils';

/** Older duplicated copies remain compatible, while settings show the latest. */
export function latestPersonalizations(skills: readonly NormalizedSkill[]) {
    const latest = new Map<string, NormalizedSkill>();
    for (const skill of skills) {
        const sourceId = skill.metadata?.derived_from?.id;
        if (skill.origin.type !== 'user' || !sourceId) continue;
        const current = latest.get(sourceId);
        if (!current || (skill.modified_at ?? 0) > (current.modified_at ?? 0)) latest.set(sourceId, skill);
    }
    return latest;
}

export function currentPersonalizedSkills(skills: readonly NormalizedSkill[]) {
    const latest = latestPersonalizations(skills);
    return skills.filter(skill => !latest.has(skill.id)
        && (!skill.metadata?.derived_from?.id || latest.get(skill.metadata.derived_from.id)?.id === skill.id));
}

export function currentSkillId(skills: readonly NormalizedSkill[], selectedId = '') {
    const sourceId = skills.find(skill => skill.id === selectedId)?.metadata?.derived_from?.id || selectedId;
    return latestPersonalizations(skills).get(sourceId)?.id || selectedId;
}
