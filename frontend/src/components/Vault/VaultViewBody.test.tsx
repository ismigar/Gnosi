import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VaultViewBody, type VaultViewBodyProps } from './VaultViewBody';

interface RendererProbeProps extends Record<string, unknown> {
    readonly children?: ReactNode;
}

function noteCount(props: RendererProbeProps): string {
    return String(Array.isArray(props.notes) ? props.notes.length : 0);
}

function scalarText(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function invoke(props: RendererProbeProps, key: string, ...args: unknown[]): void {
    const callback = props[key];
    if (typeof callback === 'function') Reflect.apply(callback, undefined, args);
}

vi.mock('./VaultTable', () => ({
    VaultTable: (props: RendererProbeProps) => <div
        data-testid="table-renderer"
        data-list-view={props.isListView === true ? 'true' : 'false'}
        data-note-count={noteCount(props)}
    />,
}));
vi.mock('./VaultKanban', () => ({
    VaultKanban: (props: RendererProbeProps) => <div data-testid="board-renderer" data-note-count={noteCount(props)} />,
}));
vi.mock('./VaultGallery', () => ({
    VaultGallery: (props: RendererProbeProps) => <div data-testid="gallery-renderer" data-note-count={noteCount(props)} />,
}));
vi.mock('./VaultTimeline', () => ({
    VaultTimeline: (props: RendererProbeProps) => <div data-testid="timeline-renderer" data-note-count={noteCount(props)} />,
}));
vi.mock('./VaultChart', () => ({
    VaultChart: (props: RendererProbeProps) => <div data-testid="chart-renderer" data-note-count={noteCount(props)} />,
}));
vi.mock('./VaultFeed', () => ({
    VaultFeed: (props: RendererProbeProps) => <div data-testid="feed-renderer">
        <button data-testid="open-feed-config" onClick={() => { invoke(props, 'onOpenConfig'); }}>config</button>
        <button data-testid="clear-feed-search" onClick={() => { invoke(props, 'onClearSearch'); }}>clear</button>
    </div>,
}));
vi.mock('./DigitalBrainCalendar', () => ({
    DigitalBrainCalendar: (props: RendererProbeProps) => <div
        data-testid="calendar-renderer"
        data-date-field={scalarText(props.dateField)}
        data-note-count={String(Array.isArray(props.allNotes) ? props.allNotes.length : 0)}
    />,
}));
vi.mock('./VaultViewErrorBoundary', () => ({
    VaultViewErrorBoundary: ({ children }: RendererProbeProps) => <>{children}</>,
}));
vi.mock('../../hooks/useVaultViewData', () => ({
    useVaultViewData: ({ pages }: { readonly pages?: readonly unknown[] }) => ({
        filteredPages: [...(pages ?? [])],
        sortedPages: [...(pages ?? [])].reverse(),
    }),
}));

const notes = [
    { id: 'page-1', title: 'First', metadata: {} },
    { id: 'page-2', title: 'Second', metadata: {} },
];

const baseProps: VaultViewBodyProps = {
    notes,
    onNoteSelect: vi.fn(),
};

describe('VaultViewBody', () => {
    let container: HTMLDivElement;
    let root: Root;
    const reactTestGlobal = globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
    };

    const renderBody = (props: VaultViewBodyProps): void => {
        act(() => { root.render(<VaultViewBody {...props} />); });
    };

    const byTestId = (testId: string): HTMLElement => {
        const element = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
        if (!element) throw new Error(`Element missing: ${testId}`);
        return element;
    };

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
        vi.clearAllMocks();
    });

    it('renders table and list modes through the shared table boundary', () => {
        renderBody(baseProps);
        expect(byTestId('table-renderer').dataset.listView).toBe('false');
        expect(byTestId('table-renderer').dataset.noteCount).toBe('2');

        renderBody({ ...baseProps, type: 'list' });
        expect(byTestId('table-renderer').dataset.listView).toBe('true');
    });

    it.each([
        ['board', 'board-renderer'],
        ['gallery', 'gallery-renderer'],
        ['timeline', 'timeline-renderer'],
        ['chart', 'chart-renderer'],
    ])('routes %s views to %s', (type, testId) => {
        renderBody({ ...baseProps, type });
        expect(byTestId(testId)).toBeInstanceOf(HTMLElement);
    });

    it('forwards feed configuration and search controls', () => {
        const onEditSchema = vi.fn();
        const onSearchChange = vi.fn();
        renderBody({
            ...baseProps,
            onEditSchema,
            onSearchChange,
            type: 'feed',
        });

        act(() => { byTestId('open-feed-config').click(); });
        act(() => { byTestId('clear-feed-search').click(); });

        expect(onEditSchema).toHaveBeenCalledWith('filters');
        expect(onSearchChange).toHaveBeenCalledWith('');
    });

    it('passes filtered notes and configured fields to the calendar renderer', () => {
        renderBody({
            ...baseProps,
            activeView: { calendarView: 'timeGridWeek', dateField: 'Start' },
            type: 'calendar',
        });

        expect(byTestId('calendar-renderer').dataset.noteCount).toBe('2');
        expect(byTestId('calendar-renderer').dataset.dateField).toBe('Start');
    });
});
