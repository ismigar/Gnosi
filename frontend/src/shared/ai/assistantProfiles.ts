/** Resolve the configured principal without silently replacing an explicit choice. */
export function principalAssistant<T extends { readonly id: string }>(
    agents: readonly T[], activeId = '',
): T | undefined {
    const personal = agents.filter(agent => !('managed_by' in agent) || !agent.managed_by);
    if (activeId) return personal.find(agent => agent.id === activeId);
    return personal.find(agent => !('enabled' in agent) || agent.enabled !== false);
}

/** Translate shipped profile names without renaming user or third-party profiles. */
const builtinProfileNames: Readonly<Record<string, string>> = {
    'ai-platform': 'Writing and knowledge capture', 'feeds-reader': 'Feeds and podcasts',
    'grounded-notebooks': 'Grounded notebooks', resources: 'Literature assistance',
    mail: 'Mail', 'social-publishing': 'Social publishing', calendar: 'Meetings',
    translation: 'Translation', 'llm-wiki': 'Knowledge',
};

export function profileDisplayName(
    profile: { name?: string; managed_by?: string },
    t: (key: string, options: { defaultValue: string }) => string,
): string {
    const name = profile.name || '';
    const owner = profile.managed_by?.startsWith('builtin:') ? profile.managed_by.slice(8) : '';
    return owner && builtinProfileNames[owner] === name
        ? t(`settings.ai.assistant.builtin_profiles.${owner}`, { defaultValue: name }) : name;
}

/** Include the assigned route beside a profile wherever users choose it. */
export function profileModelLabel(
    name: string | undefined,
    provider?: string,
    model?: string,
): string {
    const route = [provider, model].filter(Boolean).join('/');
    if (route && name) return `${name} — ${route}`;
    return route || name || '';
}

/** Translate a model's catalog recommendation label (distinct from its agent name). */
export function modelRecommendationLabel(
    profile: string | undefined,
    t: (key: string, options?: { defaultValue?: string }) => string,
): string | undefined {
    if (!profile) return undefined;
    const key = `model_comparison.profiles.${profile}`;
    const label = t(key, { defaultValue: '' });
    return label && label !== key ? label : undefined;
}

/** Sort display lists without changing stored routing priority or profile settings. */
export function profilesByDisplayName<T extends { id: string; name?: string; managed_by?: string }>(
    profiles: readonly T[],
    t: (key: string, options: { defaultValue: string }) => string,
    locale?: string,
): T[] {
    const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
    return [...profiles].sort((a, b) => collator.compare(
        profileDisplayName(a, t) || a.id, profileDisplayName(b, t) || b.id,
    ));
}
