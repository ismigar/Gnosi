import type { AiModelComparisonEntry } from '../../../shared/api/ai';

type Route = AiModelComparisonEntry['routes'][number];
export type BillingPlan = NonNullable<NonNullable<Route['billing']>['plans']>[number];
export const knownPrice = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Amortized plan rates are display-only; runtime tariffs stay on the route. */
function planPrices(route: Route, plan?: BillingPlan) {
    if (!plan || route.billing?.stale || route.billing?.model_covered === false
        || !knownPrice(plan.monthly_fee_usd) || !knownPrice(plan.quota) || plan.quota <= 0
        || plan.quota_period !== 'month'
        || !knownPrice(plan.input_units_per_million) || !knownPrice(plan.output_units_per_million)) {
        return { inputPrice: null, outputPrice: null };
    }
    const unitPrice = plan.monthly_fee_usd / plan.quota;
    return { inputPrice: unitPrice * plan.input_units_per_million, outputPrice: unitPrice * plan.output_units_per_million };
}

export function comparisonPrices(route: Route, plan?: BillingPlan) {
    const billing = route.billing;
    if (billing?.kind === 'subscription') return planPrices(route, plan);
    if (billing?.kind === 'unknown' || (billing?.kind === 'free' && billing.stale)) return { inputPrice: null, outputPrice: null };
    if (billing?.kind === 'free') return { inputPrice: 0, outputPrice: 0 };
    return { inputPrice: billing?.input_price_usd ?? route.cost_in, outputPrice: billing?.output_price_usd ?? route.cost_out };
}

/** Provider prices are never substituted with the benchmark vendor's prices. */
export function comparisonRouteCosts(model: AiModelComparisonEntry, provider: string, inputTokens: string, outputTokens: string, field: 'monthly_cost' | 'input_price' | 'output_price' = 'monthly_cost') {
    const input = Math.max(0, Number(inputTokens.replaceAll('.', '')) || 0);
    const output = Math.max(0, Number(outputTokens.replaceAll('.', '')) || 0);
    const seen = new Set<string>();
    return model.routes.filter(route => provider === 'all' || route.provider === provider).flatMap(route => {
        const key = JSON.stringify([route.provider, route.model_id, route.cost_in, route.cost_out, route.is_local]);
        if (seen.has(key)) return [];
        seen.add(key);
        const plans = route.billing?.kind === 'subscription' && route.billing.plans?.length ? route.billing.plans : [undefined];
        return plans.map(plan => {
            const prices = comparisonPrices(route, plan);
            const allocated = knownPrice(prices.inputPrice) && knownPrice(prices.outputPrice)
                ? (input * prices.inputPrice + output * prices.outputPrice) / 1_000_000 : null;
            const quotaUsage = plan && knownPrice(plan.quota) && plan.quota > 0
                && knownPrice(plan.input_units_per_million) && knownPrice(plan.output_units_per_million)
                ? (input * plan.input_units_per_million + output * plan.output_units_per_million) / 1_000_000 / plan.quota : null;
            const quotaExceeded = quotaUsage !== null && quotaUsage > 1;
            // A fractional allocation is not a bill. Never promise multiple plans
            // or overflow pricing when the provider's included quota is exceeded.
            const cost = plan ? (allocated !== null && !quotaExceeded && knownPrice(plan.monthly_fee_usd) ? plan.monthly_fee_usd : null) : allocated;
            return { route, plan, cost, quotaExceeded, quotaUsage, ...prices };
        });
    }).sort((a, b) => {
        const first = field === 'monthly_cost' ? a.cost : a[field === 'input_price' ? 'inputPrice' : 'outputPrice'];
        const second = field === 'monthly_cost' ? b.cost : b[field === 'input_price' ? 'inputPrice' : 'outputPrice'];
        if (!knownPrice(first)) return knownPrice(second) ? 1 : 0;
        return knownPrice(second) ? first - second : -1;
    });
}

export type ComparisonPriceOffer = ReturnType<typeof comparisonRouteCosts>[number];

export function routePriceValue(model: AiModelComparisonEntry, provider: string, field: 'input_price' | 'output_price' | 'monthly_cost', input: string, output: string): number | null {
    const costs = comparisonRouteCosts(model, provider, input, output);
    const values = costs.map(offer => field === 'monthly_cost' ? offer.cost : offer[field === 'input_price' ? 'inputPrice' : 'outputPrice']);
    const known = values.filter(knownPrice);
    return known.length ? Math.min(...known) : null;
}

export function routeHasPrice(route: Route, limit: number): boolean {
    const plans = route.billing?.kind === 'subscription' ? route.billing.plans ?? [] : [undefined];
    return plans.some(plan => {
        const { inputPrice } = comparisonPrices(route, plan);
        return knownPrice(inputPrice) && inputPrice <= limit;
    });
}
