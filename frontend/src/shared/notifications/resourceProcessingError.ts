import type { TFunction } from 'i18next';

const PROVIDER_TIMEOUT = 'The AI provider did not respond in time. Retry to resume saved progress.';

export function resourceProcessingError(error: string | null | undefined, t: TFunction): string {
    if (error?.includes('agent_empty_result') || error?.includes('reading_batch_response_incomplete')) {
        return t('llm_wiki.error_provider_incomplete');
    }
    if (error?.includes('length limit was reached') || error?.includes('LengthFinishReasonError')) {
        const total = /completion_tokens=(\d+)/u.exec(error)?.[1];
        const reasoning = /reasoning_tokens=(\d+)/u.exec(error)?.[1];
        return t(total && reasoning === total ? 'llm_wiki.error_reasoning_output_limit' : 'llm_wiki.error_output_limit');
    }
    if (['Invalid reading plan:', 'Quote must occur verbatim in the supplied original', 'Invalid repaired passage:']
        .some(message => error?.includes(message))) return t('llm_wiki.error_reading_evidence');
    if (error?.includes('memory_edit_anchor_required')) return t('llm_wiki.error_reading_memory');
    if (error?.includes('reading_map_synthesis_incomplete')) return t('llm_wiki.error_map_synthesis');
    if (error?.trim() === 'Connection error.' || error?.includes('OpenAIConnectionError:')) return t('llm_wiki.error_provider_connection');
    for (const key of ['reading_budget_exhausted', 'reading_budget_pending_cost', 'reading_budget_unknown_price_or_output_limit', 'reading_estimate_changed', 'reading_checkpoint_incompatible']) {
        if (error?.includes(key)) return t(`llm_wiki.${key}`);
    }
    if (error === PROVIDER_TIMEOUT) {
        return t('llm_wiki.error_provider_timeout', { defaultValue: PROVIDER_TIMEOUT });
    }
    return error?.trim() || t('llm_wiki.error_generic', { defaultValue: 'Error processing the resource' });
}
