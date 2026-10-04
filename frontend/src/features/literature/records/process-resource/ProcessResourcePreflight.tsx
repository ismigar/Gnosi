import { useTranslation } from 'react-i18next';
import type { ResourceProcessingEstimate } from '../../../../shared/api/resource-processing';
import { useLocaleSettings } from '../../../../shared/i18n/useLocaleSettings';

interface Props {
    readonly estimate: ResourceProcessingEstimate | null;
    readonly estimateError: string;
    /** Durable budget and provider prices remain in USD. Conversion is presentation only. */
    readonly budgetLimit: number;
    readonly onBudgetLimit: (usd: number) => void;
    readonly batchSize: number;
    readonly onBatchSize: (value: number) => void;
}

export function ProcessResourcePreflight({ estimate, estimateError, budgetLimit, onBudgetLimit, batchSize, onBatchSize }: Props) {
    const { t } = useTranslation();
    const { numberLocale } = useLocaleSettings();
    const translate = (key: string, defaultValue: string, values: Readonly<Record<string, string | number>> = {}): string =>
        t(`llm_wiki.${key}`, { defaultValue, ...values });
    const currency = estimate?.display_currency?.code ?? 'USD';
    const rate = estimate?.display_currency?.usd_rate ?? 1;
    const money = (usd: number): string => new Intl.NumberFormat(numberLocale, {
        style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4,
    }).format(usd * rate);
    const number = (value: number): string => new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 6 }).format(value);
    const spent = estimate?.budget?.spent_usd ?? 0;
    const held = estimate?.budget?.reserved_usd ?? 0;
    const available = Math.max(0, budgetLimit - spent - held);
    const label = translate('budget_limit', 'Spending limit ({{currency}})', { currency });
    const insufficient = estimate?.cost_usd != null && estimate.cost_usd > available;

    return <div className="space-y-3 rounded-lg border border-[var(--border-primary)] p-3 text-xs text-[var(--text-secondary)]">
        <label className="flex items-center justify-between gap-3">
            <span>{label}</span>
            <input aria-label={label} type="number" min="0" max={1000 * rate} step="any" disabled={!estimate}
                value={Number.isFinite(budgetLimit) ? Number((budgetLimit * rate).toFixed(6)) : ''}
                onChange={event => { onBudgetLimit(event.target.valueAsNumber / rate); }}
                className="w-28 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 text-[var(--text-primary)]" />
        </label>
        <label className="flex items-center justify-between gap-3">
            <span>{translate('batch_size', 'Fragments per batch')}</span>
            <select aria-label={translate('batch_size', 'Fragments per batch')} value={batchSize} onChange={event => { onBatchSize(Number(event.target.value)); }}
                className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 text-[var(--text-primary)]">
                {[1, 2, 4].map(size => <option key={size} value={size}>{size}</option>)}
            </select>
        </label>
        {!estimate ? <p>{estimateError || translate('estimate_loading', 'Estimating without AI calls…')}</p> : <>
            <p className="font-semibold text-[var(--text-primary)]">{estimate.model} · {estimate.provider}</p>
            {estimate.incompatible_saved_chunks > 0 && <p className="text-red-500">{translate('checkpoint_incompatible_details', '{{count}} saved fragments cannot be reused with the current source or processing settings. They remain saved. Resuming is blocked to avoid paying for a fresh reading. Choose Reprocess to review a fresh estimate before starting again.', { count: estimate.incompatible_saved_chunks })}</p>}
            <p>{translate('estimate_progress', '{{saved}} saved fragments; {{remaining}} remaining; about {{calls}} calls.', { saved: estimate.saved_chunks, remaining: estimate.remaining_chunks, calls: estimate.planned_calls })}</p>
            <p className="font-semibold">{translate('budget_available', 'Available within your limit: {{amount}}. Processing pauses before a call that cannot fit and saves progress.', { amount: money(available) })}</p>
            {estimate.priced && estimate.cost_usd !== null ? <>
                <p>{translate('estimate_cost', 'Conservative estimate for all remaining work: {{cost}}.', { cost: money(estimate.cost_usd) })}</p>
                {insufficient && <p role="status" className="font-semibold text-[var(--text-primary)]">{translate('estimate_over_budget', 'The calculation exceeds your available budget. Starting may only complete part of the work; your limit is not raised automatically.')}</p>}
                <details className="space-y-2">
                    <summary className="cursor-pointer">{translate('estimate_calculation', 'How this is calculated')}</summary>
                    {estimate.cost_in_per_million_usd != null && estimate.cost_out_per_million_usd != null && <p>{translate('estimate_tariff', 'Saved tariff for {{provider}}, per million tokens: {{input}} input and {{output}} output. Other providers’ offers do not apply to this run.', { provider: estimate.provider, input: money(estimate.cost_in_per_million_usd), output: money(estimate.cost_out_per_million_usd) })}</p>}
                    {estimate.cost_with_repairs_usd !== null && <p>{translate('estimate_repairs', 'Conservative scenario with up to two repairs per call and 10% margin: {{cost}}. This is not an authorized charge.', { cost: money(estimate.cost_with_repairs_usd) })}</p>}
                    <p>{translate('estimate_tokens', 'Input safety bound: {{input}}; output assumption: {{output}} tokens. Input uses UTF-8 byte counts, which overestimate tokens, and includes repeated instructions and memory.', { input: number(estimate.input_token_bound), output: number(estimate.output_tokens_assumed) })}</p>
                    <p>{translate('estimate_explanation', 'These planning assumptions are not metered usage. The actual charge is recorded from the provider. Resuming uses the same spending limit.')}</p>
                    {currency !== 'USD' && <p>{translate('budget_conversion', 'Billing and the saved limit use USD (limit: {{limit}} USD). Display conversion: 1 USD = {{rate}} {{currency}}; {{source}}.', { limit: number(budgetLimit), rate: number(rate), currency, source: estimate.display_currency?.source ?? '' })}</p>}
                </details>
            </> : <p>{translate('estimate_unpriced', 'The selected model has no verified tariff. Processing is blocked until its price is configured.')}</p>}
            {estimate.budget ? <p>{translate('budget_status', 'Reported: {{spent}}; awaiting confirmation: {{held}}; available: {{remaining}}.', { spent: money(spent), held: money(held), remaining: money(available) })}</p> :
                estimate.saved_chunks > 0 && <p>{translate('budget_legacy', 'This limit covers the remaining work. Spending before the limit was introduced is excluded.')}</p>}
        </>}
    </div>;
}
