import type { TFunction } from 'i18next';

type DisplayScalar = string | number | boolean | null | undefined;

interface ResourceOrigin {
    id?: string;
    type?: string;
}

interface ResourceMetadata {
    domain?: string;
    core_domain?: string;
    [key: string]: unknown;
}

interface DisplayResource {
    description?: string;
    id?: string;
    instructions?: string;
    metadata?: ResourceMetadata;
    name?: string;
    origin?: ResourceOrigin;
    [key: string]: unknown;
}

type ResourceKind = 'skill' | 'tool';

const BUNDLED_DOMAINS = new Set<string>([
    'brain',
    'notebooks',
    'literature',
    'media',
    'activity',
    'calendar',
    'contacts',
    'jobs',
    'mail',
    'memory',
    'notion',
    'planning',
    'reader',
    'social',
    'translation',
    'vault',
]);

const WORKFLOW_IDS = new Set<string>([
    'core.gnosi-operation-writing',
    'core.gnosi-operation-tables',
    'core.gnosi-operation-knowledge',
    'core.gnosi-operation-learning',
    'core.gnosi-daily-briefing',
    'core.gnosi-follow-up-manager',
    'core.gnosi-inbox-triage',
    'core.gnosi-knowledge-capture',
    'core.gnosi-meeting-preparation',
    'core.gnosi-notion-migration',
    'core.gnosi-project-status',
    'core.gnosi-reader-topic-evolution',
    'core.gnosi-relationship-brief',
    'core.gnosi-research-dossier',
    'core.gnosi-social-publishing',
    'core.gnosi-translation-workflow',
    'core.gnosi-weekly-review',
]);

const safeKey = (value: DisplayScalar): string => (
    String(value || '').replace(/[^a-zA-Z0-9]+/g, '_')
);

const isBundled = (resource: DisplayResource | null | undefined): boolean => (
    resource?.origin?.type === 'core'
    || (resource?.origin?.type === 'plugin' && resource.origin.id === 'llm-wiki')
    || (resource?.id || '').startsWith('plugin.llm-wiki.')
);

const resourceTokens = (resource: DisplayResource | null | undefined): string[] => (
    ((resource?.id || '').split('.').at(-1) ?? '').split('-').filter(Boolean)
);

export const resourceDomain = (
    resource: DisplayResource | null | undefined,
): string => {
    if ((resource?.id || '').startsWith('plugin.llm-wiki.')) return 'brain';
    const metadataDomain = resource?.metadata?.domain || resource?.metadata?.core_domain;
    if (metadataDomain && BUNDLED_DOMAINS.has(metadataDomain)) return metadataDomain;
    const tokenDomain = resourceTokens(resource).find(token => BUNDLED_DOMAINS.has(token));
    return tokenDomain || 'vault';
};

export const domainLabel = (t: TFunction, domain: string): string => t(
    `settings.ai.catalog.domains.${domain}`,
    { defaultValue: domain },
);

export const resourceRoleLabel = (t: TFunction, role: string): string => t(
    `settings.ai.resources.roles.${role}`,
    { defaultValue: role },
);

export const resourceStatusLabel = (t: TFunction, status: string): string => t(
    `settings.ai.resources.status_${status}`,
    { defaultValue: status },
);

export const operationStatusLabel = (t: TFunction, status?: string | null): string => {
    if (!status) return t('settings.ai.operations.statuses.never');
    return t(`settings.ai.operations.statuses.${safeKey(status)}`, {
        defaultValue: status,
    });
};

export const skillDisplayName = (
    t: TFunction,
    skill: DisplayResource | null | undefined,
): string => {
    if (!isBundled(skill)) return skill?.name || skill?.id || '';
    const id = skill?.id || '';
    if (id.startsWith('core.gnosi-') && !WORKFLOW_IDS.has(id) && id !== 'core.legacy-default-v1') {
        return t('settings.ai.catalog.domain_skill_name', {
            domain: domainLabel(t, resourceDomain(skill)),
        });
    }

    return t(`settings.ai.catalog.skills.${safeKey(id)}`, {
        defaultValue: skill?.name || id,
    });
};

export const skillDisplayDescription = (t: TFunction, skill: DisplayResource | null | undefined): string => (
    isBundled(skill)
        ? t(`settings.ai.catalog.skill_descriptions.${safeKey(skill?.id)}`, { defaultValue: skill?.description || '' })
        : skill?.description || ''
);

/** Instructions are executable user content: never replace them with a UI summary. */
export const skillDisplayInstructions = (_t: TFunction, skill: DisplayResource | null | undefined): string => skill?.instructions || '';

export const toolDisplayName = (t: TFunction, tool: DisplayResource | null | undefined): string => (
    isBundled(tool)
        ? t(`settings.ai.catalog.tool_names.${safeKey((tool?.id || '').replace('core.gnosi.', ''))}`, { defaultValue: tool?.name || tool?.id || '' })
        : tool?.name || tool?.id || ''
);

export const toolDisplayDescription = (t: TFunction, tool: DisplayResource | null | undefined): string => (
    isBundled(tool)
        ? t(`settings.ai.catalog.tool_descriptions.${safeKey((tool?.id || '').replace('core.gnosi.', ''))}`, { defaultValue: tool?.description || '' })
        : tool?.description || ''
);

export const resourceExample = (t: TFunction, resource: DisplayResource): string => t(
    `settings.ai.catalog.examples.${safeKey(resource.id)}`, { defaultValue: '' },
);

export const skillCategory = (skill: DisplayResource): 'workflow' | 'bundle' | 'legacy' => (
    skill.id === 'core.legacy-default-v1' ? 'legacy'
        : WORKFLOW_IDS.has(skill.id || '') || skill.origin?.type === 'user' ? 'workflow' : 'bundle'
);

export const localizedResourceSearchText = (
    t: TFunction,
    resource: DisplayResource | null | undefined,
    kind: ResourceKind,
): string => {
    const localizedName = kind === 'skill'
        ? skillDisplayName(t, resource)
        : toolDisplayName(t, resource);
    const localizedDescription = kind === 'skill'
        ? skillDisplayDescription(t, resource)
        : toolDisplayDescription(t, resource);
    return [
        localizedName,
        localizedDescription,
        resource?.name,
        resource?.description,
        resource?.id,
    ].filter((value): value is string => Boolean(value)).join(' ').toLowerCase();
};
