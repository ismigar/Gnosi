import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    estimateResourceProcessing,
    findResumableResourceProcessing,
    fetchResourceProcessingStatus,
    startResourceProcessing,
    type ResourceProcessingJob,
    type ResourceProcessingStart,
} from '../../../shared/api/resource-processing';
import { ProcessResourceModal } from './ProcessResourceModal';
import { toast } from '../../../shared/notifications/toast';
import { getResourceProcessingTasks, resetResourceProcessingTasks } from './process-resource/resourceProcessingTasks';


vi.mock('../../../shared/i18n/useLocaleSettings', () => ({ useLocaleSettings: () => ({ numberLocale: 'en-US' }) }));

vi.mock('../../../shared/hooks/useModalKeyboard', () => ({
    useModalKeyboard: vi.fn(),
}));


vi.mock('../../../shared/notifications/toast', () => ({
    toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));


vi.mock('../../../shared/api/resource-processing', () => ({
    estimateResourceProcessing: vi.fn(),
    findResumableResourceProcessing: vi.fn(),
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
    vi.mocked(findResumableResourceProcessing).mockResolvedValue(null);
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


import { ResourceProcessingMonitor } from './process-resource/ResourceProcessingMonitor';

function ProcessingScreen({ visible = true }: { readonly visible?: boolean }) {
    const [open, setOpen] = React.useState(true);
    return <>
        <button type="button">Keep working</button>
        {visible && open && <ProcessResourceModal isOpen noteId="note-1" sourceTableId="resources"
            title="A long book" onClose={() => { setOpen(false); }} />}
        <ResourceProcessingMonitor />
    </>;
}

function closeDialog(): void {
    act(() => { container.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')?.click(); });
}

describe('resource processing corner monitor', () => {
    it('does not announce unqualified success when a finished job retains observations', async () => {
        await render(<ProcessingScreen />);
        act(() => { buttonWithText('Process').click(); });
        await flushProcessing();
        closeDialog();
        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce({ ...doneJob, warnings: ['Missing PDF highlight', 'Missing PDF highlight'] });
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
        expect(container.querySelector('.resource-processing-monitor')?.textContent).toContain('Saved with observations to review');
        expect(toast.success).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalled();
        act(() => { container.querySelector<HTMLButtonElement>('.resource-processing-card-open')?.click(); });
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Saved with observations to review');
        expect(container.querySelectorAll('[role="dialog"] li')).toHaveLength(1);
    });
    it('minimizes, updates and reopens details without starting a second job', async () => {
        await render(<ProcessingScreen />);
        act(() => { buttonWithText('Process').click(); });
        await flushProcessing();
        closeDialog();
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('25');
        act(() => { buttonWithText('Keep working').focus(); });
        expect(document.activeElement?.textContent).toBe('Keep working');

        act(() => { container.querySelector<HTMLButtonElement>('.resource-processing-card-open')?.click(); });
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Planning notes');
        expect(startResourceProcessing).toHaveBeenCalledOnce();
        closeDialog();
        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce(doneJob);
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
        expect(container.querySelector('.resource-processing-monitor')?.textContent).toContain('Resource processed');
        expect(vi.getTimerCount()).toBe(0);
        act(() => { container.querySelector<HTMLButtonElement>('[aria-label="Dismiss processing result: A long book"]')?.click(); });
        expect(container.querySelector('.resource-processing-monitor')).toBeNull();
    });

    it('keeps a pending start visible when the dialog closes before the server responds', async () => {
        let resolveStart!: (response: ResourceProcessingStart) => void;
        vi.mocked(startResourceProcessing).mockReturnValueOnce(new Promise(resolve => { resolveStart = resolve; }));
        await render(<ProcessingScreen />);
        act(() => { buttonWithText('Process').click(); });
        closeDialog();
        expect(container.querySelector('.resource-processing-monitor')?.textContent).toContain('A long book');
        expect(container.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false);
        resolveStart(started);
        await flushProcessing();
        expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('25');
        expect(fetchResourceProcessingStatus).toHaveBeenCalledOnce();
    });

    it('keeps monitoring when navigation unmounts the originating page', async () => {
        await render(<ProcessingScreen />);
        act(() => { buttonWithText('Process').click(); });
        await flushProcessing();
        await render(<ProcessingScreen visible={false} />);
        expect(container.querySelector('.resource-processing-monitor')?.textContent).toContain('A long book');
        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce({ ...runningJob, progress: 60 });
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
        expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('60');
    });

    it('keeps an interrupted result visible and resumes it from the details', async () => {
        await render(<ProcessingScreen />);
        act(() => { buttonWithText('Process').click(); });
        await flushProcessing();
        closeDialog();
        const interrupted = { ...runningJob, phase: 'partial', running: false, error: 'Provider unavailable' };
        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce(interrupted);
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
        expect(container.querySelector('.resource-processing-monitor')?.textContent).toContain('Processing needs attention');
        expect(vi.getTimerCount()).toBe(0);
        vi.mocked(findResumableResourceProcessing).mockResolvedValue(interrupted);
        act(() => { container.querySelector<HTMLButtonElement>('.resource-processing-card-open')?.click(); });
        await flushProcessing();
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Provider unavailable');
        expect(getResourceProcessingTasks()[0]?.background).toBe(true);
        vi.mocked(findResumableResourceProcessing).mockResolvedValue(null);
        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce(doneJob);
        await flushProcessing();
        act(() => { buttonWithText('Retry').click(); });
        await flushProcessing();
        expect(startResourceProcessing).toHaveBeenLastCalledWith({ force: false, resource_id: 'note-1', source_table_id: 'resources', max_cost_usd: 0.5, batch_size: 4, estimate_id: 'estimate-1' });
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Resource processed');
    });

    it('ignores a pending start from a previous Vault after the monitor resets', async () => {
        let resolveStart!: (response: ResourceProcessingStart) => void;
        vi.mocked(startResourceProcessing).mockReturnValueOnce(new Promise(resolve => { resolveStart = resolve; }));
        await render(<ProcessingScreen />);
        act(() => { buttonWithText('Process').click(); });
        await render(<div />);
        resolveStart(started);
        await flushProcessing();
        expect(getResourceProcessingTasks()).toEqual([]);
        expect(fetchResourceProcessingStatus).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});


describe('existing backend resource jobs', () => {
    it('shows an already running job on opening without starting or estimating another', async () => {
        vi.mocked(findResumableResourceProcessing).mockResolvedValue(runningJob);
        await render(<ProcessingScreen />);
        await flushProcessing();
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Planning notes');
        expect(getResourceProcessingTasks()[0]?.job?.progress).toBe(25);
        expect(startResourceProcessing).not.toHaveBeenCalled();
        expect(estimateResourceProcessing).not.toHaveBeenCalled();
        closeDialog();
        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce({ ...runningJob, progress: 60 });
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
        expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('60');
    });

    it('restores a failed durable job after reopening instead of suggesting completion or a new start', async () => {
        vi.mocked(findResumableResourceProcessing).mockResolvedValue({
            ...runningJob, running: false, phase: 'error', error: 'Connection error.', created: [], updated: [],
        });
        const processed = vi.fn();
        await render(<ProcessResourceModal isOpen noteId="note-1" title="Book" sourceTableId="resources"
            onClose={vi.fn()} onProcessed={processed} />);
        await flushProcessing();
        expect(container.textContent).toContain('llm_wiki.error_provider_connection');
        expect(container.textContent).toContain('Connection error.');
        expect(startResourceProcessing).not.toHaveBeenCalled();
        expect(processed).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('attaches a job that starts externally while the confirmation stays open', async () => {
        await render(<ProcessingScreen />);
        expect(buttonWithText('Process')).toBeDefined();
        vi.mocked(findResumableResourceProcessing).mockResolvedValue(runningJob);
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Planning notes');
        expect(startResourceProcessing).not.toHaveBeenCalled();
        expect(getResourceProcessingTasks()[0]?.job?.job_id).toBe('job-1');
    });

    it('does not register a late discovery after the dialog closes', async () => {
        let complete!: (job: ResourceProcessingJob | null) => void;
        vi.mocked(findResumableResourceProcessing).mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
        await render(<ProcessingScreen />);
        expect(buttonWithText('Process').disabled).toBe(true);
        closeDialog();
        complete(runningJob);
        await flushProcessing();
        expect(getResourceProcessingTasks()).toEqual([]);
        expect(startResourceProcessing).not.toHaveBeenCalled();
    });
});
