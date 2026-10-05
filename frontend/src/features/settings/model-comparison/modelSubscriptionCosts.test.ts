import { describe, expect, it } from 'vitest';
import type { AiModelComparisonEntry } from '../../../shared/api/ai';
import { comparisonRouteCosts, routeHasPrice, routePriceValue, type BillingPlan } from './modelRouteCosts';

const billingDefaults = { source_url: '', stale: false };
const plan: BillingPlan = { name: 'Go', monthly_fee: 10, currency: 'USD', monthly_fee_usd: 10, quota: 60, quota_unit: 'usd', quota_period: 'month', input_units_per_million: .95, output_units_per_million: 4 };
const route: AiModelComparisonEntry['routes'][number] = { provider: 'opencode-go', provider_name: 'OpenCode Go', model_id: 'kimi-k2.6', model_name: 'Kimi', cost_in: 0, cost_out: 0, context_window: 262144, is_local: false, quality: 4, tags: [], billing: { ...billingDefaults, kind: 'subscription', plans: [plan] } };
const model = { routes: [route, { ...route, provider: 'openrouter', cost_in: .95, cost_out: 4, billing: null }] } as AiModelComparisonEntry;
const offers = (changed = route, input = '5000000', output = '1000000') => comparisonRouteCosts({ ...model, routes: [changed] }, 'all', input, output);

describe('subscription comparison', () => {
    it('amortizes the fee using exact input and output deduction rates', () => {
        const offer = offers()[0];
        expect(offer?.inputPrice).toBeCloseTo(10 / 60 * .95);
        expect(offer?.outputPrice).toBeCloseTo(10 / 60 * 4);
        expect(offer?.cost).toBe(10); // Full monthly fee, not the $1.46 allocation.
        expect(route.cost_in).toBe(0); // No registry/budget tariff mutation.
    });
    it('keeps the selected metered provider price independent of a subscription', () => {
        expect(routePriceValue(model, 'openrouter', 'monthly_cost', '5000000', '1000000')).toBe(8.75);
        expect(routePriceValue(model, 'opencode-go', 'monthly_cost', '5000000', '1000000')).toBe(10);
        expect(routeHasPrice(route, .2)).toBe(true);
        expect(routeHasPrice(route, .1)).toBe(false);
    });
    it('uses a fixed shared token allowance without treating input and output as two quotas', () => {
        const tokens = { ...plan, quota: 2_000_000, quota_unit: 'tokens' as const, input_units_per_million: 1_000_000, output_units_per_million: 1_000_000 };
        const changed = { ...route, billing: { ...billingDefaults, kind: 'subscription' as const, plans: [tokens] } };
        expect(offers(changed, '1000000', '1000000')[0]).toMatchObject({ inputPrice: 5, outputPrice: 5, cost: 10, quotaExceeded: false });
        expect(offers(changed, '2000000', '1')[0]).toMatchObject({ cost: null, quotaExceeded: true });
    });
    it('does not invent top-ups after the quota is exceeded', () => {
        expect(offers(route, '100000000', '0')[0]).toMatchObject({ cost: null, quotaExceeded: true });
        const bigger = { ...route, billing: { ...billingDefaults, kind: 'subscription' as const, plans: [plan, { ...plan, name: 'Plus', monthly_fee_usd: 40, quota: 240 }] } };
        const result = offers(bigger, '100000000', '0');
        expect(result[0]?.plan?.name).toBe('Plus');
        expect(result[0]?.cost).toBe(40);
        expect(result[1]?.cost).toBeNull();
    });
    it.each([
        { ...plan, input_units_per_million: null },
        { ...plan, quota: null },
        { ...plan, quota: 0 },
        { ...plan, quota_period: 'week' as const },
        { ...plan, quota_unit: 'requests' as const, input_units_per_million: null, output_units_per_million: null },
        { ...plan, monthly_fee_usd: null, currency: 'CNY' },
    ])('does not turn unavailable plan conversion into zero: %j', incomplete => {
        const changed = { ...route, billing: { ...billingDefaults, kind: 'subscription' as const, plans: [incomplete] } };
        expect(offers(changed)[0]).toMatchObject({ cost: null, inputPrice: null, outputPrice: null });
        expect(routeHasPrice(changed, Infinity)).toBe(false);
    });
    it('excludes outdated evidence or unconfirmed model coverage from computed prices', () => {
        for (const condition of [{ stale: true }, { model_covered: false }]) {
            const changed = { ...route, billing: { ...billingDefaults, kind: 'subscription' as const, plans: [plan], ...condition } };
            expect(offers(changed)[0]?.cost).toBeNull();
            expect(offers(changed)[0]?.inputPrice).toBeNull();
        }
    });
    it('keeps actual free endpoints distinct from unverified remote zeros', () => {
        expect(offers({ ...route, billing: { ...billingDefaults, kind: 'unknown' } })[0]?.cost).toBeNull();
        expect(offers({ ...route, billing: { ...billingDefaults, kind: 'free' } })[0]?.cost).toBe(0);
        expect(offers({ ...route, billing: { ...billingDefaults, kind: 'free', stale: true } })[0]?.cost).toBeNull();
    });
    it('uses reviewed pay-as-you-go rates when a provider retired its old plan', () => {
        const changed = { ...route, billing: { ...billingDefaults, kind: 'metered' as const, input_price_usd: .15, output_price_usd: .5 } };
        expect(offers(changed)[0]).toMatchObject({ cost: 1.25, inputPrice: .15, outputPrice: .5 });
    });
});
