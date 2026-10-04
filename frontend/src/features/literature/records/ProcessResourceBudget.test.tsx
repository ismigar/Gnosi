import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    estimateResourceProcessing,
    fetchResourceProcessingStatus,
    startResourceProcessing,
    type ResourceProcessingJob,
    type ResourceProcessingStart,
} from '../../../shared/api/resource-processing';
import { ProcessResourceModal } from './ProcessResourceModal';
import { resetResourceProcessingTasks } from './process-resource/resourceProcessingTasks';


vi.mock('../../../shared/i18n/useLocaleSettings', () => ({ useLocaleSettings: () => ({ numberLocale: 'en-US' }) }));

vi.mock('../../../shared/hooks/useModalKeyboard', () => ({
    useModalKeyboard: vi.fn(),
}));


vi.mock('../../../shared/notifications/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));


vi.mock('../../../shared/api/resource-processing', () => ({
    estimateResourceProcessing: vi.fn(),
    fetchResourceProcessingStatus: vi.fn(),
    startResourceProcessing: vi.fn(),
}));


vi.mock('react-i18next', () => {
    const t = (
        key: string,
        fallbackOrOptions?: string | Readonly<Record<string, unknown>>,
    ): string => {
        const fallback = typeof fallbackOrOptions === 'string'
            ? fallbackOrOptions
            : typeof fallbackOrOptions?.defaultValue === 'string'
                ? fallbackOrOptions.defaultValue
                : key;
        return Object.entries(typeof fallbackOrOptions === 'object' ? fallbackOrOptions : {})
            .reduce((text, [name, value]) => (
                typeof value === 'number' || typeof value === 'string'
                    ? text.replace(`{{${name}}}`, String(value)) : text
            ), fallback);
    };
    return { useTranslation: () => ({ t }) };
});


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


const runningJob: ResourceProcessingJob = {
    created: ['First note'],
    job_id: 'job-1',
    phase: 'planning',
    progress: 25,
    resource_id: 'note-1',
    running: true,
    source_table_id: 'resources',
    updated: [],
};
const started: ResourceProcessingStart = {
    item_id: 'note-1',
    job: runningJob,
    job_id: 'job-1',
    resource_id: 'note-1',
    source_table_id: 'resources',
    status: 'started',
};
let container: HTMLDivElement;
let root: Root;


beforeEach(() => {
    vi.useFakeTimers();
    resetResourceProcessingTasks();
    vi.resetAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(estimateResourceProcessing).mockResolvedValue({ estimate_id: 'estimate-1', provider: 'test', model: 'test-model', currency: 'USD', priced: true, chunks_total: 8, saved_chunks: 0, incompatible_saved_chunks: 0, remaining_chunks: 8, batch_size: 4, planned_calls: 3, memory_restore_calls: 0, source_token_bound: 1000, input_token_bound: 4000, output_tokens_assumed: 1000, output_token_bound: 49152, cost_usd: 0.02, cost_with_repairs_usd: 0.1, budget: null, warnings: [] });
    vi.mocked(startResourceProcessing).mockResolvedValue(started);
    vi.mocked(fetchResourceProcessingStatus).mockResolvedValue(runningJob);
});


afterEach(() => {
    act(() => {
        root.unmount();
        resetResourceProcessingTasks();
    });
    container.remove();
    vi.useRealTimers();
});


async function render(element: ReactElement): Promise<void> {
    await act(async () => {
        root.render(element);
        await Promise.resolve();
    });
}


function buttonWithText(label: string): HTMLButtonElement {
    const button = [...container.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.includes(label));
    if (!button) throw new Error(`Missing button: ${label}`);
    return button;
}


async function flushProcessing(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}


describe('Book budget currency', () => {
    it('separates the whole-book estimate from the authorized limit in the configured currency', async () => {
        const defaults = await vi.mocked(estimateResourceProcessing)({});
        vi.mocked(estimateResourceProcessing).mockResolvedValue({ ...defaults,
            provider: 'openrouter', model: 'moonshotai/kimi-k2.6',
            display_currency: { code: 'EUR', symbol: '€', usd_rate: .89087, source: 'test', fetched_at: '2026-10-04' },
            cost_in_per_million_usd: .95, cost_out_per_million_usd: 4,
            cost_usd: 5.764, cost_with_repairs_usd: 24.512 });
        await render(<ProcessResourceModal isOpen noteId="note-1" onClose={vi.fn()} />);
        const input = container.querySelector<HTMLInputElement>('input[type="number"]');
        expect(input?.getAttribute('aria-label')).toBe('Spending limit (EUR)');
        expect(input?.value).toBe('0.445435');
        expect(container.textContent).toContain('€5.135');
        expect(container.textContent).toContain('€21.837');
        expect(container.textContent).toContain('calculation exceeds your available budget');
        expect(container.textContent).toContain('Saved tariff for openrouter');
        expect(container.textContent).toContain('€0.8463 input and €3.5635 output');
        expect(startResourceProcessing).not.toHaveBeenCalled();
        act(() => { buttonWithText('Process').click(); });
        await flushProcessing();
        expect(startResourceProcessing).toHaveBeenCalledWith(expect.objectContaining({ max_cost_usd: .5 }));
    });

    it('converts an edited currency amount to USD without replacing the stored budget on a rerender', async () => {
        const defaults = await vi.mocked(estimateResourceProcessing)({});
        vi.mocked(estimateResourceProcessing).mockResolvedValue({ ...defaults,
            display_currency: { code: 'EUR', symbol: '€', usd_rate: .8, source: 'test', fetched_at: '2026-10-04' },
            budget: { id: 'book-budget', limit_usd: .75, spent_usd: .2, reserved_usd: .1, remaining_usd: .45 } });
        await render(<ProcessResourceModal isOpen noteId="note-1" onClose={vi.fn()} />);
        const input = container.querySelector<HTMLInputElement>('input[type="number"]');
        expect(input?.value).toBe('0.6');
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '0.4');
            input?.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(container.textContent).toContain('available: €0.16');
        act(() => { buttonWithText('Process').click(); });
        await flushProcessing();
        expect(startResourceProcessing).toHaveBeenCalledWith(expect.objectContaining({ max_cost_usd: .5 }));
    });

});
