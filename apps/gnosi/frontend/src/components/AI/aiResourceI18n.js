const BUNDLED_DOMAINS = new Set([
    'brain',
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

const KNOWN_ACTIONS = [
    'add',
    'append',
    'archive',
    'apply',
    'batch',
    'bulk',
    'cancel',
    'change',
    'clone',
    'compose',
    'create',
    'delete',
    'empty',
    'estimate',
    'extract',
    'find',
    'generate',
    'get',
    'interact',
    'invite',
    'list',
    'maintain',
    'mark',
    'merge',
    'move',
    'process',
    'propose',
    'publish',
    'query',
    'read',
    'rename',
    'replace',
    'reply',
    'restore',
    'resume',
    'rsvp',
    'save',
    'schedule',
    'search',
    'send',
    'snooze',
    'star',
    'start',
    'status',
    'summarize',
    'translate',
    'update',
];

const WORKFLOW_IDS = new Set([
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

const safeKey = value => String(value || '').replace(/[^a-zA-Z0-9]+/g, '_');

const isBundled = resource => (
    resource?.origin?.type === 'core'
    || (resource?.origin?.type === 'plugin' && resource?.origin?.id === 'llm-wiki')
    || String(resource?.id || '').startsWith('plugin.llm-wiki.')
);

const resourceTokens = resource => (
    String(resource?.id || '').split('.').at(-1).split('-').filter(Boolean)
);

export const resourceDomain = resource => {
    if (String(resource?.id || '').startsWith('plugin.llm-wiki.')) return 'brain';
    const metadataDomain = resource?.metadata?.domain;
    if (BUNDLED_DOMAINS.has(metadataDomain)) return metadataDomain;
    const tokenDomain = resourceTokens(resource).find(token => BUNDLED_DOMAINS.has(token));
    return tokenDomain || 'vault';
};

const actionFor = resource => {
    const tokens = resourceTokens(resource);
    if (tokens.includes('free') && tokens.includes('busy')) return 'status';
    if (tokens.at(-1) === 'status') return 'status';
    return KNOWN_ACTIONS.find(action => tokens.includes(action)) || 'manage';
};

export const domainLabel = (t, domain) => t(
    `settings.ai.catalog.domains.${domain}`,
    { defaultValue: domain },
);

export const resourceRoleLabel = (t, role) => t(
    `settings.ai.resources.roles.${role}`,
    { defaultValue: role },
);

export const resourceStatusLabel = (t, status) => t(
    `settings.ai.resources.status_${status}`,
    { defaultValue: status },
);

export const operationStatusLabel = (t, status) => {
    if (!status) return t('settings.ai.operations.statuses.never');
    return t(`settings.ai.operations.statuses.${safeKey(status)}`, {
        defaultValue: status,
    });
};

export const skillDisplayName = (t, skill) => {
    if (!isBundled(skill)) return skill?.name || skill?.id || '';
    const id = String(skill?.id || '');
    if (id.startsWith('core.gnosi-') && !WORKFLOW_IDS.has(id) && id !== 'core.legacy-default-v1') {
        return t('settings.ai.catalog.domain_skill_name', {
            domain: domainLabel(t, resourceDomain(skill)),
        });
    }
    if (id.startsWith('plugin.llm-wiki.')) {
        const action = actionFor(skill);
        return t('settings.ai.catalog.tool_name', {
            action: t(`settings.ai.catalog.actions.${action}`),
            domain: domainLabel(t, 'brain'),
        });
    }
    return t(`settings.ai.catalog.skills.${safeKey(id)}`, {
        defaultValue: skill?.name || id,
    });
};

export const skillDisplayDescription = (t, skill) => {
    if (!isBundled(skill)) return skill?.description || '';
    const id = String(skill?.id || '');
    if (id.startsWith('core.gnosi-') && !WORKFLOW_IDS.has(id) && id !== 'core.legacy-default-v1') {
        return t('settings.ai.catalog.domain_skill_description', {
            domain: domainLabel(t, resourceDomain(skill)),
        });
    }
    return t('settings.ai.catalog.workflow_description', {
        name: skillDisplayName(t, skill),
    });
};

export const skillDisplayInstructions = (t, skill) => {
    if (!isBundled(skill)) return skill?.instructions || '';
    return t('settings.ai.catalog.bundled_instructions', {
        name: skillDisplayName(t, skill),
    });
};

export const toolDisplayName = (t, tool) => {
    if (!isBundled(tool)) return tool?.name || tool?.id || '';
    const action = actionFor(tool);
    return t('settings.ai.catalog.tool_name', {
        action: t(`settings.ai.catalog.actions.${action}`),
        domain: domainLabel(t, resourceDomain(tool)),
    });
};

export const toolDisplayDescription = (t, tool) => {
    if (!isBundled(tool)) return tool?.description || '';
    return t('settings.ai.catalog.tool_description', {
        domain: domainLabel(t, resourceDomain(tool)),
    });
};

export const localizedResourceSearchText = (t, resource, kind) => {
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
    ].filter(Boolean).join(' ').toLowerCase();
};
