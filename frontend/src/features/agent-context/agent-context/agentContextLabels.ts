import type { TFunction } from 'i18next';


const INTERNAL_SOURCE_KEYS: Readonly<Record<string, string>> = {
    calendar: 'settings.ai.context_internal_calendar',
    contacts: 'settings.ai.context_internal_contacts',
    mail: 'settings.ai.context_internal_mail',
    meetings: 'settings.ai.context_internal_meetings',
    notion: 'settings.ai.context_internal_notion',
    planning: 'settings.ai.context_internal_planning',
    reader: 'settings.ai.context_internal_reader',
    references: 'settings.ai.context_internal_references',
    social: 'settings.ai.context_internal_social',
};


export const internalSourceLabel = (
    t: TFunction,
    sourceId: string,
    fallback = '',
): string => {
    const key = INTERNAL_SOURCE_KEYS[sourceId];
    return key ? t(key, fallback || sourceId) : fallback || sourceId;
};

const OPTION_KEYS: Readonly<Record<string, string>> = {
    project: 'settings.ai.sources.options.project',
    task: 'settings.ai.sources.options.task',
    resource: 'settings.ai.sources.options.resource',
    assignment: 'settings.ai.sources.options.assignment',
    calendar: 'settings.ai.sources.options.calendar',
    recurrence: 'settings.ai.sources.options.recurrence',
    page: 'settings.ai.sources.options.page',
    database: 'settings.ai.sources.options.database',
    local: 'settings.ai.sources.options.local',
    google: 'settings.ai.sources.options.google',
    apple: 'settings.ai.sources.options.apple',
    personal: 'settings.ai.sources.options.personal',
    b2b: 'settings.ai.sources.options.b2b',
    esborrany: 'settings.ai.sources.options.esborrany',
    programada: 'settings.ai.sources.options.programada',
    publicant: 'settings.ai.sources.options.publicant',
    publicada: 'settings.ai.sources.options.publicada',
    parcial: 'settings.ai.sources.options.parcial',
    error: 'settings.ai.sources.options.error',
    cancelada: 'settings.ai.sources.options.cancelada',
    mastodon: 'settings.ai.sources.options.mastodon',
    bluesky: 'settings.ai.sources.options.bluesky',
    linkedin: 'settings.ai.sources.options.linkedin',
    facebook: 'settings.ai.sources.options.facebook',
    telegram: 'settings.ai.sources.options.telegram',
};

export const contextOptionLabel = (t: TFunction, value: string): string => OPTION_KEYS[value] ? t(OPTION_KEYS[value], value) : value;
