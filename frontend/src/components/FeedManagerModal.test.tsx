import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { logError } from '../lib/notifyError';
import { toast } from '../lib/toast';
import {
    createReaderSource,
    deleteReaderSource,
    fetchReaderSources,
    importReaderOpml,
} from '../shared/api/reader';
import type { ReaderSource } from '../shared/api/reader';
import {
    fetchScheduledTasks,
    runScheduledTask,
    updateScheduledTask,
} from '../shared/api/scheduler';
import type { ScheduledTask } from '../shared/api/scheduler';
import { FeedManagerModal } from './FeedManagerModal';


interface MockConfirmModalProps {
    readonly isOpen: boolean;
    readonly onConfirm: () => unknown;
}


interface TranslationOptions {
    readonly count?: number;
    readonly date?: string;
    readonly interval?: string;
}


vi.mock('../hooks/useModalKeyboard', () => ({
    useModalKeyboard: () => undefined,
}));


vi.mock('../lib/notifyError', () => ({ logError: vi.fn() }));


vi.mock('../lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));


vi.mock('../shared/api/reader', () => ({
    createReaderSource: vi.fn(),
    deleteReaderSource: vi.fn(),
    fetchReaderSources: vi.fn(),
    importReaderOpml: vi.fn(),
}));


vi.mock('../shared/api/scheduler', () => ({
    fetchScheduledTasks: vi.fn(),
    runScheduledTask: vi.fn(),
    updateScheduledTask: vi.fn(),
}));


vi.mock('./ConfirmModal', () => ({
    ConfirmModal: ({ isOpen, onConfirm }: MockConfirmModalProps) => isOpen ? (
        <button
            type="button"
            aria-label="Confirm deletion"
            onClick={() => {
                void onConfirm();
            }}
        >
            Confirm deletion
        </button>
    ) : null,
}));


const translate = (
    key: string,
    fallback?: string,
    options?: TranslationOptions,
): string => {
    let result = fallback ?? key;
    if (options?.count !== undefined) {
        result = result.replace('{{count}}', String(options.count));
    }
    if (options?.interval !== undefined) {
        result = result.replace('{{interval}}', options.interval);
    }
    if (options?.date !== undefined) {
        result = result.replace('{{date}}', options.date);
    }
    return result;
};


vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
const source: ReaderSource = {
    category: 'Research',
    created_at: '2026-08-30T08:00:00Z',
    id: 7,
    name: 'Research feed',
    type: 'rss',
    url: 'https://example.test/research.xml',
};
const newsletter: ReaderSource = {
    category: null,
    created_at: '2026-08-30T08:00:00Z',
    id: 8,
    name: 'Daily letter',
    type: 'newsletter',
    url: 'reader@example.test',
};
const readerTask: ScheduledTask = {
    description: 'Fetch feeds',
    enabled: true,
    interval_minutes: 90,
    last_run: '2026-08-30T08:00:00Z',
    name: 'fetch_feeds',
    status: 'success',
};
const unrelatedTask: ScheduledTask = {
    description: 'Unrelated cleanup',
    enabled: true,
    interval_minutes: 60,
    name: 'cleanup',
    status: 'idle',
};


let container: HTMLDivElement;
let root: Root;


beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});


beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(fetchReaderSources).mockResolvedValue([source, newsletter]);
    vi.mocked(fetchScheduledTasks).mockResolvedValue([readerTask, unrelatedTask]);
    vi.mocked(createReaderSource).mockResolvedValue(source);
    vi.mocked(deleteReaderSource).mockResolvedValue({ message: 'deleted' });
    vi.mocked(importReaderOpml).mockResolvedValue({ message: 'imported' });
    vi.mocked(runScheduledTask).mockResolvedValue({
        message: 'started',
        status: 'running',
        success: true,
    });
    vi.mocked(updateScheduledTask).mockResolvedValue({
        success: true,
        task: readerTask,
    });
});


afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
});


async function flushRequests(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}


async function renderModal(
    element: ReactElement = (
        <FeedManagerModal isOpen onClose={vi.fn()} />
    ),
): Promise<void> {
    act(() => {
        root.render(element);
    });
    await flushRequests();
}


function buttonWithText(label: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button'))
        .find((candidate) => candidate.textContent.includes(label));
    if (!button) throw new Error(`Missing button: ${label}`);
    return button;
}


function buttonWithTitle(title: string): HTMLButtonElement {
    const button = container.querySelector(`button[title="${title}"]`);
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing button title: ${title}`);
    }
    return button;
}


function inputWithPlaceholder(placeholder: string): HTMLInputElement {
    const input = container.querySelector(`input[placeholder="${placeholder}"]`);
    if (!(input instanceof HTMLInputElement)) {
        throw new Error(`Missing input: ${placeholder}`);
    }
    return input;
}


function setInputValue(input: HTMLInputElement, value: string): void {
    const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
    )?.set?.bind(input);
    if (!setValue) throw new Error('Missing native input value setter');
    act(() => {
        setValue(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}


async function clickAsync(button: HTMLButtonElement): Promise<void> {
    await act(async () => {
        button.click();
        await Promise.resolve();
        await Promise.resolve();
    });
}


describe('FeedManagerModal', () => {
    it('stays unmounted and does not load data while closed', async () => {
        await renderModal(
            <FeedManagerModal isOpen={false} onClose={vi.fn()} />,
        );

        expect(container.textContent).toBe('');
        expect(fetchReaderSources).not.toHaveBeenCalled();
        expect(fetchScheduledTasks).not.toHaveBeenCalled();
    });

    it('loads sources and shows only reader scheduler tasks', async () => {
        await renderModal();

        expect(container.textContent).toContain('Research feed');
        expect(container.textContent).toContain('Daily letter');
        act(() => {
            buttonWithText('Automatic').click();
        });

        expect(container.textContent).toContain('Fetch feeds');
        expect(container.textContent).toContain('Every 2h');
        expect(container.textContent).not.toContain('Unrelated cleanup');
    });

    it('creates an RSS source with normalized form values and reloads', async () => {
        await renderModal();
        act(() => {
            buttonWithText('Add').click();
        });
        setInputValue(
            inputWithPlaceholder('RSS feed URL *'),
            '  https://example.test/new.xml  ',
        );
        setInputValue(inputWithPlaceholder('Name (optional)'), '  New feed  ');
        setInputValue(inputWithPlaceholder('Category (optional)'), '  News  ');

        await clickAsync(buttonWithText('Add Feed'));

        expect(createReaderSource).toHaveBeenCalledWith({
            category: 'News',
            name: 'New feed',
            type: 'rss',
            url: 'https://example.test/new.xml',
        });
        expect(fetchReaderSources).toHaveBeenCalledTimes(2);
        expect(inputWithPlaceholder('RSS feed URL *').value).toBe('');
    });

    it('imports OPML and deletes a source through confirmation', async () => {
        await renderModal();
        act(() => {
            buttonWithText('Add').click();
        });
        const fileInput = container.querySelector('input[type="file"]');
        if (!(fileInput instanceof HTMLInputElement)) {
            throw new Error('Missing OPML file input');
        }
        const opml = new File(['<opml />'], 'feeds.opml', {
            type: 'text/xml',
        });
        const files = {
            0: opml,
            item: (index: number): File | null => index === 0 ? opml : null,
            length: 1,
        };
        Object.defineProperty(fileInput, 'files', {
            configurable: true,
            value: files,
        });
        await act(async () => {
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(importReaderOpml).toHaveBeenCalledWith(opml);

        act(() => {
            buttonWithText('Sources').click();
        });
        act(() => {
            buttonWithTitle('common.delete').click();
        });
        await clickAsync(buttonWithText('Confirm deletion'));

        expect(deleteReaderSource).toHaveBeenCalledWith(source.id);
        expect(fetchReaderSources).toHaveBeenCalledTimes(3);
    });

    it('toggles and runs reader tasks while notifying the parent', async () => {
        const onRefresh = vi.fn();
        await renderModal(
            <FeedManagerModal
                isOpen
                onClose={vi.fn()}
                onRefresh={onRefresh}
            />,
        );
        act(() => {
            buttonWithText('Automatic').click();
        });

        await clickAsync(buttonWithTitle('Deactivate'));
        expect(updateScheduledTask).toHaveBeenCalledWith({
            name: readerTask.name,
            update: { enabled: false, interval_minutes: 90 },
        });

        await clickAsync(buttonWithTitle('Run now'));
        expect(runScheduledTask).toHaveBeenCalledWith(readerTask.name);
        expect(onRefresh).toHaveBeenCalledOnce();
        expect(fetchReaderSources).toHaveBeenCalledTimes(2);
    });

    it('reports feed and task failures without closing the manager', async () => {
        vi.mocked(createReaderSource).mockRejectedValueOnce(new Error('offline'));
        vi.mocked(runScheduledTask).mockRejectedValueOnce(new Error('task failed'));
        await renderModal();
        act(() => {
            buttonWithText('Add').click();
        });
        setInputValue(
            inputWithPlaceholder('RSS feed URL *'),
            'https://example.test/failing.xml',
        );
        await clickAsync(buttonWithText('Add Feed'));
        expect(toast.error).toHaveBeenCalledWith('offline');

        act(() => {
            buttonWithText('Automatic').click();
        });
        await clickAsync(buttonWithTitle('Run now'));
        expect(toast.error).toHaveBeenCalledWith('Could not run');
        expect(logError).toHaveBeenCalledWith(
            'feed-manager.task-run',
            expect.objectContaining({ message: 'task failed' }),
        );
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    });
});
