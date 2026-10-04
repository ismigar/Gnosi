import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import { toast } from '../../../shared/notifications/toast';
import {
    estimateResourceProcessing,
    fetchResourceProcessingStatus,
    startResourceProcessing,
    type ResourceProcessingJob,
    type ResourceProcessingStart,
} from '../../../shared/api/resource-processing';
import { ProcessResourceModal } from './ProcessResourceModal';
import { resetResourceProcessingTasks } from './process-resource/resourceProcessingTasks';


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
const doneJob: ResourceProcessingJob = {
    created: ['First note'],
    job_id: 'job-1',
    phase: 'done',
    progress: 100,
    resource_id: 'note-1',
    running: false,
    source_table_id: 'resources',
    updated: ['Existing note'],
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


describe('ProcessResourceModal', () => {
    it('explains provider timeouts and retries without forcing a fresh run', async () => {
        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce({
            ...runningJob, running: false, phase: 'partial',
            error: 'The AI provider did not respond in time. Retry to resume saved progress.',
        });
        await render(<ProcessResourceModal isOpen force noteId="note-1" onClose={vi.fn()} />);
        act(() => { buttonWithText('Process').click(); });
        await flushProcessing();
        expect(container.textContent).toContain('The AI provider did not respond in time.');
        expect(vi.getTimerCount()).toBe(0);
        act(() => { buttonWithText('Retry').click(); });
        await flushProcessing();
        expect(startResourceProcessing).toHaveBeenLastCalledWith(expect.objectContaining({
            force: false, resource_id: 'note-1', source_table_id: undefined, max_cost_usd: 0.5, batch_size: 4, estimate_id: 'estimate-1',
        }));
    });

    it('stops with a recoverable error when a tracked job disappears', async () => {
        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce({
            resource_id: 'job-1', running: false, phase: 'idle', progress: 0,
        });
        await render(<ProcessResourceModal isOpen noteId="note-1" onClose={vi.fn()} />);
        act(() => { buttonWithText('Process').click(); });
        await flushProcessing();

        expect(container.textContent).toContain('processing status is unavailable');
        expect(container.textContent).not.toContain('Reading the source');
        expect(buttonWithText('Retry')).toBeDefined();
        expect(vi.getTimerCount()).toBe(0);
    });


    it('does not overlap slow polls and keeps monitoring after navigation', async () => {
        let resolvePoll: (job: ResourceProcessingJob) => void = () => {};
        vi.mocked(fetchResourceProcessingStatus).mockReturnValueOnce(new Promise((resolve) => {
            resolvePoll = resolve;
        }));
        const onJobUpdate = vi.fn();
        const onProcessed = vi.fn();
        await render(<ProcessResourceModal isOpen noteId="note-1" onClose={vi.fn()}
            onJobUpdate={onJobUpdate} onProcessed={onProcessed} />);
        act(() => { buttonWithText('Process').click(); });
        await flushProcessing();
        await act(async () => { await vi.advanceTimersByTimeAsync(6000); });

        expect(fetchResourceProcessingStatus).toHaveBeenCalledTimes(1);
        const signal = vi.mocked(fetchResourceProcessingStatus).mock.calls[0]?.[2];
        expect(signal?.aborted).toBe(false);
        await render(<div />);
        expect(signal?.aborted).toBe(false);
        resolvePoll(doneJob);
        await flushProcessing();
        expect(onJobUpdate).toHaveBeenCalledTimes(1);
        expect(onProcessed).not.toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });


    it('shows reading observations even when no existing notes were updated', async () => {
        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce({
            ...doneJob, updated: [], warnings: ['A distant definition remains uncertain.'],
        });
        await render(<ProcessResourceModal isOpen noteId="note-1" onClose={vi.fn()} />);
        act(() => { buttonWithText('Process').click(); });
        await flushProcessing();
        expect(container.textContent).toContain('Reading observations');
        expect(container.textContent).toContain('A distant definition remains uncertain.');
    });


    it('keeps polling while the provider cooldown is in progress', async () => {
        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce({
            ...runningJob, phase: 'retrying', chunks_done: 1, chunks_total: 85,
        });
        await render(<ProcessResourceModal isOpen noteId="note-1" onClose={vi.fn()} />);
        act(() => { buttonWithText('Process').click(); });
        await flushProcessing();

        expect(container.textContent).toContain('Waiting for the AI provider');
        expect(container.textContent).toContain('retrying automatically');
        expect(container.textContent).toContain('1 of 85 fragments completed');
        expect(vi.getTimerCount()).toBe(1);
        expect(toast.error).not.toHaveBeenCalled();

        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce(doneJob);
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
        expect(container.textContent).toContain('Resource processed');
        expect(vi.getTimerCount()).toBe(0);
    });


    it('explains rate limits and resumes a failed force-run without forcing again', async () => {
        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce({
            ...runningJob, running: false, phase: 'partial', chunks_done: 1,
            error: "Error code: 429 - {'message': 'Rate limit exceeded', 'code': '1300'}",
        });
        await render(<ProcessResourceModal force isOpen noteId="note-1" onClose={vi.fn()} />);
        act(() => { buttonWithText('Process').click(); });
        await flushProcessing();

        expect(container.textContent).toContain('The AI provider is limiting requests');
        expect(container.textContent).toContain('Completed fragments are saved');
        expect(container.textContent).not.toContain("'code': '1300'");
        expect(vi.getTimerCount()).toBe(0);

        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce(doneJob);
        act(() => { buttonWithText('Retry').click(); });
        await flushProcessing();

        expect(vi.mocked(startResourceProcessing).mock.calls.map(([request]) => request.force)).toEqual([
            true, false,
        ]);
        expect(container.textContent).toContain('Resource processed');
        expect(vi.getTimerCount()).toBe(0);
    });


    it('blocks paid starts while the read-only estimate is pending', async () => {
        vi.mocked(estimateResourceProcessing).mockReturnValueOnce(new Promise(() => {}));
        await render(<ProcessResourceModal isOpen noteId="note-1" onClose={vi.fn()} />);
        expect(buttonWithText('Process').disabled).toBe(true);
        expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('0.5');
        act(() => { buttonWithText('Process').click(); });
        expect(startResourceProcessing).not.toHaveBeenCalled();
        expect(vi.mocked(useModalKeyboard).mock.calls.at(-1)?.[0].confirmDisabled).toBe(true);
    });

    it('blocks an unpriced model after preflight without a paid start', async () => {
        const defaults = await vi.mocked(estimateResourceProcessing)({});
        vi.mocked(estimateResourceProcessing).mockResolvedValue({ ...defaults, priced: false, cost_usd: null, cost_with_repairs_usd: null });
        await render(<ProcessResourceModal isOpen noteId="note-1" onClose={vi.fn()} />);
        expect(buttonWithText('Process').disabled).toBe(true);
        expect(container.textContent).toContain('no verified tariff');
        expect(startResourceProcessing).not.toHaveBeenCalled();
    });

    it('retains the existing book limit and reported costs on resume', async () => {
        const defaults = await vi.mocked(estimateResourceProcessing)({});
        vi.mocked(estimateResourceProcessing).mockResolvedValue({ ...defaults, saved_chunks: 166, remaining_chunks: 25,
            budget: { id: 'book-budget', limit_usd: 0.75, spent_usd: 0.20, reserved_usd: 0.10, remaining_usd: 0.45 } });
        await render(<ProcessResourceModal isOpen noteId="note-1" onClose={vi.fn()} />);
        expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('0.75');
        expect(container.textContent).toContain('166 saved fragments');
        expect(container.textContent).toContain('0.200 USD');
        act(() => { buttonWithText('Process').click(); });
        await flushProcessing();
        expect(startResourceProcessing).toHaveBeenCalledWith(expect.objectContaining({ max_cost_usd: 0.75, batch_size: 4, estimate_id: 'estimate-1' }));
    });

    it('blocks accidental rereading when saved plans are incompatible', async () => {
        const defaults = await vi.mocked(estimateResourceProcessing)({});
        vi.mocked(estimateResourceProcessing).mockResolvedValue({ ...defaults, saved_chunks: 0, incompatible_saved_chunks: 166 });
        await render(<ProcessResourceModal isOpen noteId="note-1" onClose={vi.fn()} />);
        expect(buttonWithText('Process').disabled).toBe(true);
        expect(container.textContent).toContain('166 saved fragments cannot be reused');
        act(() => { buttonWithText('Process').click(); });
        expect(startResourceProcessing).not.toHaveBeenCalled();
    });

    it('renders the accessible force-confirmation contract', async () => {
        const onClose = vi.fn();
        await render(
            <ProcessResourceModal
                force
                isOpen
                noteId="note-1"
                onClose={onClose}
                sourceTableId="resources"
                title="Research source"
            />,
        );

        const dialog = container.querySelector('[role="dialog"]');
        const closeButton = container.querySelector('button[aria-label="Close"]');
        const processButton = buttonWithText('Process');
        expect(dialog?.getAttribute('aria-modal')).toBe('true');
        expect(closeButton).toBeInstanceOf(HTMLButtonElement);
        expect(processButton.dataset.autofocus).toBe('true');
        expect(container.textContent).toContain('Research source');
        expect(container.textContent).toContain(
            'All configured sources will be processed again',
        );

        const keyboardCall = vi.mocked(useModalKeyboard).mock.calls.at(-1);
        const keyboardOptions = keyboardCall?.[0];
        if (!keyboardOptions) throw new Error('Missing keyboard contract');
        expect(keyboardOptions.isOpen).toBe(true);
        expect(keyboardOptions.confirmDisabled).toBe(false);
        expect(keyboardOptions.trapFocus).toBe(true);
        expect(typeof keyboardOptions.onClose).toBe('function');
        expect(typeof keyboardOptions.onConfirm).toBe('function');
    });


    it('starts, reports and completes a durable processing job', async () => {
        const onClose = vi.fn();
        const onJobUpdate = vi.fn<(job: ResourceProcessingJob) => void>();
        const onProcessed = vi.fn();
        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce(doneJob);
        await render(
            <ProcessResourceModal
                force
                isOpen
                noteId="note-1"
                onClose={onClose}
                onJobUpdate={onJobUpdate}
                onProcessed={onProcessed}
                sourceTableId="resources"
            />,
        );

        act(() => {
            buttonWithText('Process').click();
        });
        await flushProcessing();

        expect(startResourceProcessing).toHaveBeenCalledWith(expect.objectContaining({
            force: true,
            resource_id: 'note-1',
            source_table_id: 'resources',
        }));
        expect(fetchResourceProcessingStatus).toHaveBeenCalledWith(
            'job-1',
            'resources',
            expect.any(AbortSignal),
        );
        expect(onJobUpdate.mock.calls).toEqual([[runningJob], [doneJob]]);
        expect(onProcessed).toHaveBeenCalledOnce();
        expect(toast.success).toHaveBeenCalledWith('2 Brain pages updated');
        expect(container.textContent).toContain('Resource processed');
        expect(container.textContent).toContain('First note');
        expect(container.textContent).toContain('Existing note');
        expect(vi.getTimerCount()).toBe(0);
    });


    it('continues a running job in the background when dismissed', async () => {
        const onClose = vi.fn();
        const onContinueInBackground = vi.fn<(
            job: ResourceProcessingJob,
        ) => void>();
        await render(
            <ProcessResourceModal
                isOpen
                noteId="note-1"
                onClose={onClose}
                onContinueInBackground={onContinueInBackground}
                sourceTableId="resources"
            />,
        );
        act(() => {
            buttonWithText('Process').click();
        });
        await flushProcessing();

        expect(container.textContent).toContain('Planning notes with AI');
        expect(container.textContent).toContain('1 pages');
        expect(container.textContent).toContain('follow progress in the corner');
        const progress = container.querySelector<HTMLElement>('[style]');
        expect(progress?.style.width).toBe('25%');
        act(() => {
            container.querySelector<HTMLButtonElement>(
                'button[aria-label="Close"]',
            )?.click();
        });

        expect(onContinueInBackground).toHaveBeenCalledWith(runningJob);
        expect(onClose).toHaveBeenCalledOnce();
    });


    it('ignores a transient poll failure and surfaces a terminal partial job', async () => {
        const partialJob: ResourceProcessingJob = {
            ...runningJob,
            error: 'Provider quota reached',
            phase: 'partial',
            running: false,
        };
        vi.mocked(fetchResourceProcessingStatus)
            .mockRejectedValueOnce(new Error('Temporary gateway failure'))
            .mockResolvedValueOnce(partialJob);
        await render(
            <ProcessResourceModal
                isOpen
                noteId="note-1"
                onClose={vi.fn()}
                sourceTableId="resources"
            />,
        );
        act(() => {
            buttonWithText('Process').click();
        });
        await flushProcessing();
        expect(container.textContent).toContain('follow progress in the corner');

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1500);
        });

        expect(fetchResourceProcessingStatus).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Provider quota reached');
        expect(vi.getTimerCount()).toBe(0);
    });


    it('localizes a missing Brain-table start error', async () => {
        vi.mocked(startResourceProcessing).mockRejectedValueOnce(
            new Error('No Brain table is configured'),
        );
        await render(
            <ProcessResourceModal
                isOpen
                noteId="note-1"
                onClose={vi.fn()}
                sourceTableId="resources"
            />,
        );
        act(() => {
            buttonWithText('Process').click();
        });
        await flushProcessing();

        const message = 'No Brain table is configured. Create one in Settings';
        expect(container.textContent).toContain(message);
        expect(toast.error).toHaveBeenCalledWith(
            'No Brain table is configured. Create one in Settings → Plugins → LLM Wiki.',
        );
    });


    it('does not render content while closed', async () => {
        await render(
            <ProcessResourceModal
                isOpen={false}
                noteId="note-1"
                onClose={vi.fn()}
                sourceTableId="resources"
            />,
        );
        expect(container.childElementCount).toBe(0);
    });
});
