import type { TFunction } from 'i18next';

const PROVIDER_TIMEOUT = 'The AI provider did not respond in time. Retry to resume saved progress.';

export function resourceProcessingError(error: string | null | undefined, t: TFunction): string {
    if (error === PROVIDER_TIMEOUT) {
        return t('llm_wiki.error_provider_timeout', { defaultValue: PROVIDER_TIMEOUT });
    }
    return error?.trim() || t('llm_wiki.error_generic', { defaultValue: 'Error processing the resource' });
}
