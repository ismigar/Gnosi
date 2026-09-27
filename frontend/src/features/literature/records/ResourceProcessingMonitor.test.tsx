import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    fetchResourceProcessingStatus,
    startResourceProcessing,
    type ResourceProcessingJob,
    type ResourceProcessingStart,
} from '../../../shared/api/resource-processing';
import { ProcessResourceModal } from './ProcessResourceModal';
import { getResourceProcessingTasks, resetResourceProcessingTasks } from './process-resource/resourceProcessingTasks';


vi.mock('../../../shared/hooks/useModalKeyboard', () => ({
    useModalKeyboard: vi.fn(),
}));


vi.mock('../../../shared/notifications/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));


vi.mock('../../../shared/api/resource-processing', () => ({
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


function render(element: ReactElement): void {
    act(() => {
        root.render(element);
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
    it('minimizes, updates and reopens details without starting a second job', async () => {
        render(<ProcessingScreen />);
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
        render(<ProcessingScreen />);
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
        render(<ProcessingScreen />);
        act(() => { buttonWithText('Process').click(); });
        await flushProcessing();
        render(<ProcessingScreen visible={false} />);
        expect(container.querySelector('.resource-processing-monitor')?.textContent).toContain('A long book');
        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce({ ...runningJob, progress: 60 });
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
        expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('60');
    });

    it('keeps an interrupted result visible and resumes it from the details', async () => {
        render(<ProcessingScreen />);
        act(() => { buttonWithText('Process').click(); });
        await flushProcessing();
        closeDialog();
        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce({ ...runningJob, phase: 'partial', running: false, error: 'Provider unavailable' });
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
        expect(container.querySelector('.resource-processing-monitor')?.textContent).toContain('Processing needs attention');
        expect(vi.getTimerCount()).toBe(0);
        act(() => { container.querySelector<HTMLButtonElement>('.resource-processing-card-open')?.click(); });
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Provider unavailable');
        vi.mocked(fetchResourceProcessingStatus).mockResolvedValueOnce(doneJob);
        act(() => { buttonWithText('Retry').click(); });
        await flushProcessing();
        expect(startResourceProcessing).toHaveBeenLastCalledWith({ force: false, resource_id: 'note-1', source_table_id: 'resources' });
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Resource processed');
    });

    it('ignores a pending start from a previous Vault after the monitor resets', async () => {
        let resolveStart!: (response: ResourceProcessingStart) => void;
        vi.mocked(startResourceProcessing).mockReturnValueOnce(new Promise(resolve => { resolveStart = resolve; }));
        render(<ProcessingScreen />);
        act(() => { buttonWithText('Process').click(); });
        render(<div />);
        resolveStart(started);
        await flushProcessing();
        expect(getResourceProcessingTasks()).toEqual([]);
        expect(fetchResourceProcessingStatus).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});
