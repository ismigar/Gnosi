import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { toast } from '../../lib/toast';
import {
    fetchResourceProcessingStatus,
    startResourceProcessing,
    type ResourceProcessingJob,
    type ResourceProcessingStart,
} from '../../shared/api/resource-processing';
import { ProcessResourceModal } from './ProcessResourceModal';


vi.mock('../../hooks/useModalKeyboard', () => ({
    useModalKeyboard: vi.fn(),
}));


vi.mock('../../lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));


vi.mock('../../shared/api/resource-processing', () => ({
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
        const count = typeof fallbackOrOptions === 'object'
            ? fallbackOrOptions.count
            : undefined;
        return typeof count === 'number' || typeof count === 'string'
            ? fallback.replace('{{count}}', String(count))
            : fallback;
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


describe('ProcessResourceModal', () => {
    it('renders the accessible force-confirmation contract', () => {
        const onClose = vi.fn();
        render(
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
        render(
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

        expect(startResourceProcessing).toHaveBeenCalledWith({
            force: true,
            resource_id: 'note-1',
            source_table_id: 'resources',
        });
        expect(fetchResourceProcessingStatus).toHaveBeenCalledWith(
            'job-1',
            'resources',
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
        render(
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
        expect(container.textContent).toContain('continue in the background');
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
        render(
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
        expect(container.textContent).toContain('continue in the background');

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
        render(
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


    it('does not render content while closed', () => {
        render(
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
