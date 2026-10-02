import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AIConsumptionDashboard } from './AIConsumptionDashboard';
import { consumptionInterval } from './aiConsumption';
import { dispatchWindowEvent } from '../../shared/platform/browser-events';
import type { ConsumptionQuery, UsageDashboard, UsageSummary } from '../../shared/api/ai-consumption';
import type { SettingsController } from './global-settings/useGlobalSettingsController';
const mocks = vi.hoisted(() => ({ dashboard: vi.fn(), requests: vi.fn(), export: vi.fn() }));
vi.mock('../../shared/api/ai-consumption', () => ({ fetchConsumption: mocks.dashboard, fetchConsumptionRequests: mocks.requests, exportConsumption: mocks.export }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en', exists: () => false } }) }));
vi.mock('./global-settings/ModelBudget', () => ({ ModelBudget: () => <section>Monthly budget</section> }));
const summary: UsageSummary = { calls: 2, input_tokens: 200, output_tokens: 20, cached_tokens: 40, reasoning_tokens: 8, cost_usd: 3, cost_ccy: 2.7, unknown_cost_calls: 0, unknown_usage_calls: 0, estimated_calls: 0, failed_calls: 0, legacy_records: 0 };
const currency = { code: 'EUR', symbol: '€', usd_rate: .9, source: 'test', fetched_at: '2026-10-02' };
const data: UsageDashboard = {
    budget_summary: summary, currency, start: '2026-09-26', end: '2026-10-02', timezone: 'Europe/Madrid', granularity: 'day', summary,
    groups: [{ ...summary, key: 'p1:same', label: 'same · p1', cost_ccy: .9, cost_usd: 1 }, { ...summary, key: 'p2:same', label: 'same · p2', cost_ccy: 1.8, cost_usd: 2 }],
    series: [{ ...summary, date: '2026-10-02', groups: [] }],
    options: { model: [{ value: 'p1:same', label: 'same · p1' }, { value: 'p2:same', label: 'same · p2' }], agent: [{ value: 'a', label: 'Agent A' }] }, legacy_excluded: false,
    budget: { currency, period: '2026-10', spent_usd: 3, spent_ccy: 2.7, cap_ccy: null, cap_usd: null, ratio: null, over_cap: false, budget: {}, per_model: [] },
};
let root: Root; let container: HTMLDivElement;
const context = { draft: { settings: { currency: 'EUR (€)' } } } as unknown as SettingsController;
async function render(): Promise<void> { await act(async () => { root.render(<AIConsumptionDashboard context={context} />); await Promise.resolve(); await Promise.resolve(); }); }
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
    vi.resetAllMocks(); mocks.dashboard.mockResolvedValue(data); mocks.requests.mockResolvedValue({ total: 0, page: 1, page_size: 25, currency, items: [] });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); });
describe('AI consumption dashboard', () => {
    it('shows all provider costs in Settings currency and keeps routes distinct', async () => {
        await render();
        expect(container.textContent).toContain('€2.70'); expect(container.textContent).toContain('same · p1'); expect(container.textContent).toContain('same · p2');
        const select = [...container.querySelectorAll('select')].find(element => [...element.options].some(option => option.value === 'p2:same'));
        expect(select).toBeDefined();
        await act(async () => { if (select) { select.value = 'p2:same'; select.dispatchEvent(new Event('change', { bubbles: true })); } await Promise.resolve(); });
        expect((mocks.dashboard.mock.calls.at(-1)?.[0] as ConsumptionQuery).model).toBe('p2:same');
        expect((mocks.requests.mock.calls.at(-1)?.[0] as ConsumptionQuery).model).toBe('p2:same');
    });
    it('retains last good amounts on a refresh error and exposes the error', async () => {
        await render(); mocks.dashboard.mockRejectedValue(new Error('offline'));
        const button=container.querySelector<HTMLButtonElement>('.gnosi-refresh-button');
        await act(async () => { button?.click(); await Promise.resolve(); });
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('load_error'); expect(container.textContent).toContain('€2.70');
    });
    it('does not render a failed initial load as zero consumption', async () => {
        mocks.dashboard.mockRejectedValue(new Error('offline')); await render();
        expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(container.querySelector('.consumption-value')).toBeNull();
    });
    it('distinguishes unknown costs and legacy monthly coverage', async () => {
        mocks.dashboard.mockResolvedValue({ ...data, legacy_excluded: true, summary: { ...summary, cost_ccy: null, unknown_cost_calls: 2 } }); await render();
        expect(container.textContent).toContain('incomplete'); expect(container.textContent).toContain('legacy_excluded'); expect(container.querySelector('.consumption-value')?.textContent).toContain('unknown');
    });
    it('does not present missing daily legacy detail as zero', async () => {
        mocks.dashboard.mockResolvedValue({ ...data, legacy_excluded: true, summary: { ...summary, calls: 0, cost_ccy: 0, cost_usd: 0 } }); await render();
        expect([...container.querySelectorAll('.consumption-value')].every(value => value.textContent.includes('unknown'))).toBe(true);
    });
    it('refreshes on visible focus and visibility changes, and unsubscribes on close', async () => {
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        try {
            await render();
            mocks.dashboard.mockClear();
            await act(async () => { dispatchWindowEvent(new Event('focus')); await Promise.resolve(); });
            expect(mocks.dashboard).toHaveBeenCalledTimes(1);
            visibility.mockReturnValue('hidden');
            await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); });
            expect(mocks.dashboard).toHaveBeenCalledTimes(1);
            visibility.mockReturnValue('visible');
            await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); });
            expect(mocks.dashboard).toHaveBeenCalledTimes(2);
            act(() => { root.unmount(); });
            mocks.dashboard.mockClear();
            await act(async () => {
                dispatchWindowEvent(new Event('focus'));
                document.dispatchEvent(new Event('visibilitychange'));
                await Promise.resolve();
            });
            expect(mocks.dashboard).not.toHaveBeenCalled();
        } finally { visibility.mockRestore(); }
    });
    it('uses calendar dates across a year boundary', () => {
        expect(consumptionInterval('week', new Date(2026,0,2))).toEqual({ start: '2025-12-27', end: '2026-01-02' });
        expect(consumptionInterval('previous', new Date(2026,0,2))).toEqual({ start: '2025-12-01', end: '2025-12-31' });
    });
});
