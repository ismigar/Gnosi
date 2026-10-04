import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, expect, it } from 'vitest';
import ca from '../../../shared/i18n/locales/ca/translation.json';
import { GlobalTooltip } from '../../../shared/ui/tooltip/GlobalTooltip';
import type { AiModelComparisonEntry } from '../../../shared/api/ai';
import { comparisonRouteCosts } from './modelRouteCosts';
import { ModelPriceOffer } from './ModelPriceOffer';

const billingDefaults = { source_url: '', stale: false };
const i18n = createInstance();
const currency = { code: 'EUR', symbol: '€', usd_rate: .9, source: 'test', fetched_at: '2026-10-04' };
const base: AiModelComparisonEntry['routes'][number] = { provider: 'opencode-go', provider_name: 'OpenCode Go', model_id: 'kimi-k2.6', model_name: 'Kimi', cost_in: 0, cost_out: 0, context_window: 262144, is_local: false, quality: 4, tags: [] };
const subscribed = { ...base, billing: { ...billingDefaults, kind: 'subscription' as const, source_url: 'https://opencode.ai/docs/go', checked_at: '2026-10-04', plans: [{ name: 'Go', currency: 'USD', monthly_fee: 10, monthly_fee_usd: 10, quota: 60, quota_unit: 'usd' as const, quota_period: 'month' as const, input_units_per_million: .95, output_units_per_million: 4 }] } };
let root: Root | undefined;
let container: HTMLDivElement;

beforeAll(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await i18n.init({ lng: 'ca', resources: { ca: { translation: ca } }, interpolation: { escapeValue: false } });
});
afterEach(() => {
    act(() => { root?.unmount(); });
    container.remove();
});
async function mount(route: typeof base, field: 'monthly_cost' | 'input_price' = 'input_price') {
    const offer = comparisonRouteCosts({ routes: [route] } as AiModelComparisonEntry, 'all', '5000000', '1000000')[0];
    if (!offer) throw new Error('Missing offer');
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root?.render(<I18nextProvider i18n={i18n}><ModelPriceOffer offer={offer} field={field} label={route.provider_name} currency={currency} active /><GlobalTooltip /></I18nextProvider>);
        await Promise.resolve();
    });
}

it('shows the equivalent tariff, subscription minimum and official evidence in the configured currency', async () => {
    await mount(subscribed);
    expect(container.textContent).toContain('0.14 €*');
    expect(container.textContent).toContain('Quota mensual: 9.00 €');
    expect(container.textContent).toContain('Equivalent amb tota la quota consumida');
    expect(container.querySelector('a')?.href).toBe('https://opencode.ai/docs/go');
    const star = container.querySelector('span[tabindex="0"]');
    if (!star) throw new Error('Missing subscription marker');
    act(() => { star.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    const tooltip = document.getElementById('gnosi-global-tooltip')?.textContent;
    expect(tooltip).toContain('OpenCode Go · kimi-k2.6 · Go');
    expect(tooltip).toContain('Requereix quota');
    expect(tooltip).toContain('60 USD de consum');
    expect(tooltip).toContain('2026-10-04');
    expect(tooltip).toContain('no es factura només la fracció consumida');
});

it('shows the full monthly subscription instead of a misleading fractional bill', async () => {
    await mount(subscribed, 'monthly_cost');
    expect(container.querySelector('strong')?.textContent).toBe('9.00 €*');
});

it('labels an unconvertible credit plan and explains it on keyboard focus', async () => {
    const unknown = { ...base, provider: 'alibaba-token-plan', provider_name: 'Alibaba Token Plan', billing: { ...billingDefaults, ...subscribed.billing, source_url: 'https://www.alibabacloud.com/help/en/model-studio/token-plan-personal-overview', model_covered: false, plans: [{ name: 'Lite', monthly_fee: 8, currency: 'USD', monthly_fee_usd: 8, quota: 11500, quota_unit: 'credits' as const, quota_period: 'month' as const }] } };
    await mount(unknown);
    expect(container.querySelector('strong')?.textContent).toBe('Requereix quota*');
    expect(container.textContent).not.toContain('0.00 €');
    expect(container.textContent).toContain('Quota mensual: 7.20 €');
    const star = container.querySelector<HTMLSpanElement>('span[tabindex="0"]');
    act(() => { star?.focus(); });
    expect(document.getElementById('gnosi-global-tooltip')?.textContent).toContain('11.500 crèdits');
    expect(document.getElementById('gnosi-global-tooltip')?.textContent).toContain('No hi ha prou dades verificades');
    expect(container.textContent).toContain('Model no confirmat');
});

it('marks unverified remote zero tariffs without labeling them free', async () => {
    await mount({ ...base, billing: { ...billingDefaults, kind: 'unknown', source_url: 'https://example.test/prices' } });
    expect(container.textContent).not.toContain('0.00 €');
    expect(container.querySelector('span')?.getAttribute('aria-label')).toContain('Tarifa pendent de verificar');
});
