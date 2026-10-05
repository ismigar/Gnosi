import { useTranslation } from 'react-i18next';
import type { AiModelComparison } from '../../../shared/api/ai';
import { getIntlLocale } from '../../../shared/i18n/locales/registry';
import { formatComparisonCost } from '../modelComparison';
import { knownPrice, type ComparisonPriceOffer } from './modelRouteCosts';

/** Prices, subscription minimum and evidence always belong to this exact route. */
export function ModelPriceOffer({ offer, field, label, currency, active }: {
    readonly offer: ComparisonPriceOffer;
    readonly field: 'monthly_cost' | 'input_price' | 'output_price';
    readonly label: string;
    readonly currency: AiModelComparison['currency'];
    readonly active: boolean;
}) {
    const { t, i18n } = useTranslation();
    const numberLocale = getIntlLocale(i18n.resolvedLanguage || i18n.language);
    const { route, plan, quotaExceeded } = offer;
    const billing = route.billing;
    const value = field === 'monthly_cost' ? offer.cost : offer[field === 'input_price' ? 'inputPrice' : 'outputPrice'];
    const money = (amount: number) => formatComparisonCost(amount * (currency.usd_rate || 1), currency.symbol || '$');
    const count = (amount: number) => amount.toLocaleString(numberLocale, { maximumFractionDigits: 4 });
    const fee = knownPrice(plan?.monthly_fee_usd) ? money(plan.monthly_fee_usd)
        : knownPrice(plan?.monthly_fee) ? `${count(plan.monthly_fee)} ${plan.currency}` : null;
    const subscription = billing?.kind === 'subscription';
    const notes = (billing?.notes ?? []).map(note => t(`model_comparison.billing.notes.${note}`));
    const hints = [
        `${label} · ${route.model_id}${plan ? ` · ${plan.name}` : ''}`,
        subscription ? t('model_comparison.billing.required') : '',
        fee ? t('model_comparison.billing.fee', { amount: fee }) : '',
        knownPrice(plan?.quota) ? t('model_comparison.billing.quota', { amount: count(plan.quota), unit: t(`model_comparison.billing.units.${plan.quota_unit}`), period: t(`model_comparison.billing.periods.${plan.quota_period}`) }) : '',
        subscription && knownPrice(value) ? t('model_comparison.billing.equivalent_help') : '',
        subscription && !knownPrice(offer.inputPrice) ? t('model_comparison.billing.no_conversion') : '',
        knownPrice(plan?.quota) && plan.quota > 0 && fee ? t('model_comparison.billing.formula', { fee, quota: count(plan.quota), input: plan.input_units_per_million == null ? '—' : count(plan.input_units_per_million), output: plan.output_units_per_million == null ? '—' : count(plan.output_units_per_million), unit: t(`model_comparison.billing.units.${plan.quota_unit}`) }) : '',
        quotaExceeded ? t('model_comparison.billing.exceeded_help') : '',
        billing?.kind === 'unknown' ? t('model_comparison.billing.unverified_help') : '',
        billing?.kind === 'free' ? t('model_comparison.billing.free_help') : '',
        billing?.model_covered === false ? t('model_comparison.billing.coverage_unknown') : '',
        billing?.stale ? t('model_comparison.billing.stale') : '',
        billing?.checked_at ? t('model_comparison.billing.checked', { date: billing.checked_at }) : '',
        ...notes,
        !billing && value === 0 && !route.is_local ? t('model_comparison.zero_tariff_note') : '',
        billing?.source_url ?? '',
        billing?.rate_source_url ?? '',
    ].filter(Boolean).join('\n');
    const mark = subscription || billing?.kind === 'unknown' || billing?.kind === 'free' || value === 0;
    const missingLabel = subscription ? t(quotaExceeded && field === 'monthly_cost' ? 'model_comparison.billing.exceeded' : 'model_comparison.billing.required') : t('model_comparison.unknown_cost');
    return <div title={route.model_id}>
        {label}{plan ? ` · ${plan.name}` : ''} — <strong>
            {knownPrice(value) ? money(value) : missingLabel}
            {mark && <span className="cursor-help" tabIndex={0} title={hints} aria-label={hints}>*</span>}
        </strong>
        {fee && subscription && <small>{t('model_comparison.billing.fee', { amount: fee })}</small>}
        {subscription && knownPrice(value) && field !== 'monthly_cost' && <small>{t('model_comparison.billing.equivalent')}</small>}
        {billing?.model_covered === false && <small>{t('model_comparison.billing.coverage_unknown')}</small>}
        {active && <small>{t('model_comparison.active_tariff')}</small>}
        {route.is_local && <small>{t('model_comparison.local_cost_note')}</small>}
        {billing?.source_url && (mark || billing.checked_at) && <small><a href={billing.source_url} target="_blank" rel="noreferrer" title={hints}>{t('model_comparison.billing.source')}</a>{billing.checked_at ? ` · ${billing.checked_at}` : ''}</small>}
    </div>;
}
