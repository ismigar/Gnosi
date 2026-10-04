import type { TFunction } from 'i18next';

const PROVIDER_TIMEOUT = 'The AI provider did not respond in time. Retry to resume saved progress.';

export function resourceProcessingError(error: string | null | undefined, t: TFunction): string {
    for (const key of ['reading_budget_exhausted', 'reading_budget_pending_cost', 'reading_budget_unknown_price_or_output_limit', 'reading_estimate_changed', 'reading_checkpoint_incompatible']) {
        if (error?.includes(key)) return t(`llm_wiki.${key}`);
    }
    if (error === PROVIDER_TIMEOUT) {
        return t('llm_wiki.error_provider_timeout', { defaultValue: PROVIDER_TIMEOUT });
    }
    return error?.trim() || t('llm_wiki.error_generic', { defaultValue: 'Error processing the resource' });
}
