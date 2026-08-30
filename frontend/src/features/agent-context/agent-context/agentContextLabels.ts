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
