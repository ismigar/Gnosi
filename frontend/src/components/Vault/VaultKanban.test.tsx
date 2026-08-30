import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VaultKanban, type VaultKanbanProps } from './VaultKanban';
import type { VaultViewPage } from '../../hooks/useVaultViewData';
import type { VaultBulkActionsBarProps } from './VaultBulkActionsBar';


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string | { readonly defaultValue?: string }) => (
            typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key
        ),
    }),
}));


vi.mock('../../hooks/useLocaleSettings', () => ({
    useLocaleSettings: () => ({
        currencyCode: 'EUR',
        dateFormat: 'locale',
        dateLocale: 'en-US',
        decimalSymbol: '.',
        numberLocale: 'en-US',
    }),
}));


vi.mock('./useTitlePreview', () => ({
    useTitlePreview: () => ({
        getTitleProps: () => ({}),
        preview: null,
    }),
}));


const bulkProbe = vi.hoisted(() => vi.fn<(props: VaultBulkActionsBarProps) => void>());

vi.mock('./VaultBulkActionsBar', () => ({
    VaultBulkActionsBar: (props: VaultBulkActionsBarProps) => {
        bulkProbe(props);
        return <div>
            <button onClick={() => { props.onDeleteSelected?.(); }}>Delete selected</button>
            <button onClick={() => { props.onApplyTemplate?.('template'); }}>Apply template</button>
        </div>;
    },
}));


const schema = {
    Status: 'select',
    Status_config: {
        options: [
            { color: 'blue', name: 'Idea' },
            { color: 'green', name: 'Done' },
        ],
    },
};


function cardIn(container: HTMLElement, title: string): HTMLDivElement {
    const heading = Array.from(container.querySelectorAll('h4'))
        .find((element) => element.textContent === title);
    const card = heading?.closest<HTMLDivElement>('div[draggable]');
    if (!card) throw new Error(`Missing Kanban card: ${title}`);
    return card;
}

function columnIn(container: HTMLElement, label: string): HTMLElement {
    const heading = Array.from(container.querySelectorAll('h3'))
        .find((element) => element.textContent === label);
    const column = heading?.parentElement?.parentElement;
    if (!column) throw new Error(`Missing Kanban column: ${label}`);
    return column;
}

function dropCard(card: HTMLElement, destination: HTMLElement): void {
    let payload = '';
    const dataTransfer = {
        getData: () => payload,
        setData: (_format: string, value: string) => { payload = value; },
    };
    for (const [type, element] of [['dragstart', card], ['drop', destination]] as const) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
        element.dispatchEvent(event);
    }
}


describe('VaultKanban', () => {
    let container: HTMLDivElement;
    let root: Root;

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

    it('renders records and opens a card', () => {
        const onNoteSelect = vi.fn();
        act(() => {
            root.render(<VaultKanban
                activeView={{ groupBy: 'Status' }}
                notes={[{
                    id: 'page-1',
                    last_modified: '2026-08-29T10:00:00Z',
                    metadata: { Status: 'Idea' },
                    title: 'Research note',
                }]}
                onNoteSelect={onNoteSelect}
                schema={schema}
                searchTerm=""
            />);
        });

        const title = Array.from(container.querySelectorAll('span'))
            .find((element) => element.textContent === 'Research note');
        const card = title?.closest<HTMLDivElement>('div[draggable]');
        if (!card) throw new Error('Kanban card not rendered');
        act(() => { card.click(); });
        expect(onNoteSelect).toHaveBeenCalledWith('page-1');
    });

    it('keeps record creation separate from view configuration', () => {
        const onCreateRecord = vi.fn();
        act(() => {
            root.render(<VaultKanban
                notes={[]}
                onCreateRecord={onCreateRecord}
                onNoteSelect={vi.fn()}
            />);
        });

        const addButton = Array.from(container.querySelectorAll('button'))
            .find((button) => button.textContent.includes('Add record'));
        if (!addButton) throw new Error('Add record button not rendered');
        act(() => { addButton.click(); });
        expect(onCreateRecord).toHaveBeenCalledOnce();
    });

    it('optimistically moves a card and persists the real metadata key', async () => {
        const onUpdateNote = vi.fn<NonNullable<VaultKanbanProps['onUpdateNote']>>()
            .mockResolvedValue(undefined);
        act(() => {
            root.render(<VaultKanban
                activeView={{ groupBy: 'Status' }}
                notes={[{
                    id: 'page-1',
                    metadata: { '📌 Status': 'Idea' },
                    title: 'Movable note',
                }]}
                onNoteSelect={vi.fn()}
                onUpdateNote={onUpdateNote}
                schema={schema}
                searchTerm=""
            />);
        });

        const title = Array.from(container.querySelectorAll('span'))
            .find((element) => element.textContent === 'Movable note');
        const card = title?.closest<HTMLDivElement>('div[draggable="true"]');
        const doneHeader = Array.from(container.querySelectorAll('h3'))
            .find((element) => element.textContent.includes('Done'));
        const doneColumn = doneHeader?.parentElement?.parentElement;
        if (!card || !doneColumn) throw new Error('Drag source or destination missing');

        let payload = '';
        const dataTransfer = {
            dropEffect: 'none',
            effectAllowed: 'none',
            getData: () => payload,
            setData: (_format: string, value: string) => { payload = value; },
        };
        const start = new Event('dragstart', { bubbles: true });
        Object.defineProperty(start, 'dataTransfer', { value: dataTransfer });
        act(() => { card.dispatchEvent(start); });
        const drop = new Event('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
        await act(async () => {
            doneColumn.dispatchEvent(drop);
            await Promise.resolve();
        });

        expect(onUpdateNote).toHaveBeenCalledWith('page-1', {
            metadata: { '📌 Status': 'Done' },
        });
        expect(doneColumn.textContent).toContain('Movable note');
    });

    it('accepts open pages, scalar titles and absent navigation without projecting metadata', () => {
        const opaque = { [Symbol.toPrimitive]() { throw new Error('unread metadata'); } };
        const notes: readonly VaultViewPage[] = [
            { id: 'number', title: 42, metadata: { Status: 'Idea', opaque }, extension: new Map() },
            { id: 'zero', title: 0, metadata: null },
            { id: 'false', title: false },
            { id: 'bigint', title: 7n },
            { id: 'true', title: true },
            { id: 'absent' },
        ];
        act(() => {
            root.render(<VaultKanban notes={notes} schema={schema}
                activeView={{ groupBy: 'Status', sorts: [], extension: opaque }} searchTerm="" />);
        });
        expect(Array.from(container.querySelectorAll('h4'), (heading) => heading.textContent))
            .toEqual(['42', 'Untitled', 'Untitled', '7', '', 'Untitled']);
        act(() => { cardIn(container, '42').click(); });
        expect(notes[0]?.metadata?.opaque).toBe(opaque);
        expect(notes[1]?.metadata).toBeNull();
    });

    it('retains shared search, nested filtering and imported multi-sort on open metadata', () => {
        const priority = { [Symbol.toPrimitive]: () => '2' };
        const notes: readonly VaultViewPage[] = [
            { id: 'late', title: 'Research Z', metadata: { Status: 'Idea', Priority: priority } },
            { id: 'early', title: 'Research A', metadata: { Status: 'Idea', Priority: 1 } },
            { id: 'filtered', title: 'Research B', metadata: { Status: 'Done', Priority: 0 } },
            { id: 'search', title: 'Other', metadata: { Status: 'Idea', Priority: 0 } },
            { id: 'null', title: 'Research missing', metadata: null },
        ];
        act(() => {
            root.render(<VaultKanban notes={notes} schema={schema} searchTerm="research" activeView={{
                groupBy: 'Status',
                filters: { conditions: [{ conjunction: 'and', rules: [{ field: 'Status', operator: 'equals', value: 'Idea' }] }] },
                sorts: [{ field: 'Priority', direction: 'asc' }, { field: 'title', direction: 'asc' }],
                sort: { field: 'title', direction: 'desc' },
                visibleProperties: ['Status'],
            }} />);
        });
        expect(Array.from(container.querySelectorAll('h4'), (heading) => heading.textContent))
            .toEqual(['Research A', 'Research Z']);
        expect(notes[0]?.metadata?.Priority).toBe(priority);
    });

    it('keeps a move saved by a synchronous callback returning an opaque value', async () => {
        const result = new Map([['saved', true]]);
        const onUpdateNote = vi.fn<NonNullable<VaultKanbanProps['onUpdateNote']>>(() => result);
        const metadata = { Status: ['Idea', 'Review'], opaque: new Set([1]) };
        act(() => {
            root.render(<VaultKanban notes={[{ id: 'page', title: 'Sync', metadata }]}
                activeView={{ groupBy: 'Status' }} schema={schema} onUpdateNote={onUpdateNote} searchTerm="" />);
        });
        await act(async () => {
            dropCard(cardIn(columnIn(container, 'Idea'), 'Sync'), columnIn(container, 'Done'));
            await Promise.resolve();
        });
        expect(onUpdateNote).toHaveBeenCalledWith('page', { metadata: { Status: ['Review', 'Done'] } });
        expect(columnIn(container, 'Done').textContent).toContain('Sync');
        expect(columnIn(container, 'Review').textContent).toContain('Sync');
        expect(metadata.Status).toEqual(['Idea', 'Review']);
    });

    it('undoes an optimistic drop after async rejection without modifying the original metadata', async () => {
        let rejectSave: (reason: Error) => void = () => { throw new Error('Save did not start'); };
        const onUpdateNote = vi.fn<NonNullable<VaultKanbanProps['onUpdateNote']>>(() => new Promise((_resolve, reject) => {
            rejectSave = reject;
        }));
        const metadata = { '📌 Status': 'Idea', opaque: new Map() };
        act(() => {
            root.render(<VaultKanban notes={[{ id: 'page', title: 'Reject', metadata }]}
                activeView={{ groupBy: 'Status' }} schema={schema} onUpdateNote={onUpdateNote} searchTerm="" />);
        });
        act(() => { dropCard(cardIn(container, 'Reject'), columnIn(container, 'Done')); });
        expect(columnIn(container, 'Done').textContent).toContain('Reject');
        expect(columnIn(container, 'Idea').textContent).not.toContain('Reject');
        await act(async () => {
            rejectSave(new Error('Save rejected'));
            await Promise.resolve();
        });
        expect(columnIn(container, 'Idea').textContent).toContain('Reject');
        expect(columnIn(container, 'Done').textContent).not.toContain('Reject');
        expect(metadata['📌 Status']).toBe('Idea');
    });

    it('rolls back a synchronous save exception for a note with null metadata', async () => {
        const note: VaultViewPage = { id: 'page', title: 'Null metadata', metadata: null };
        const onUpdateNote = vi.fn<NonNullable<VaultKanbanProps['onUpdateNote']>>(() => { throw new Error('Sync failure'); });
        act(() => {
            root.render(<VaultKanban notes={[note]} activeView={{ groupBy: 'Status' }}
                schema={schema} onUpdateNote={onUpdateNote} searchTerm="" />);
        });
        await act(async () => {
            dropCard(cardIn(container, 'Null metadata'), columnIn(container, 'Done'));
            await Promise.resolve();
        });
        expect(columnIn(container, 'No status').textContent).toContain('Null metadata');
        expect(onUpdateNote).toHaveBeenCalledWith('page', { metadata: { Status: 'Done' } });
        expect(note.metadata).toBeNull();
    });

    it('forwards original scalar and absent titles when bulk deletion falls back to individual callbacks', () => {
        const titles: readonly VaultViewPage['title'][] = [42, 0, false, true, 7n, null, undefined];
        const notes = titles.map((title, index) => ({ id: String(index), title, metadata: null }));
        const onDeletePage = vi.fn<NonNullable<VaultKanbanProps['onDeletePage']>>();
        act(() => { root.render(<VaultKanban notes={notes} onDeletePage={onDeletePage} searchTerm="" />); });
        for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
            act(() => { checkbox.click(); });
        }
        const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Delete selected');
        if (!button) throw new Error('Delete selection missing');
        act(() => { button.click(); });
        expect(onDeletePage.mock.calls).toEqual(titles.map((title, index) => [String(index), title]));
        expect(container.querySelectorAll('input:checked')).toHaveLength(0);
    });

    it('passes valid templates by identity and clears selection after applying one', () => {
        const templates = [{ id: 'template', title: null, extension: new Map() }];
        const onApplyTemplate = vi.fn<NonNullable<VaultKanbanProps['onApplyTemplate']>>();
        act(() => { root.render(<VaultKanban notes={[{ id: 'page' }]} templates={templates}
            onApplyTemplate={onApplyTemplate} searchTerm="" />); });
        const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (!checkbox) throw new Error('Selection missing');
        act(() => { checkbox.click(); });
        expect(bulkProbe.mock.calls.at(-1)?.[0].templates).toBe(templates);
        const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Apply template');
        if (!button) throw new Error('Template selection missing');
        act(() => { button.click(); });
        expect(onApplyTemplate).toHaveBeenCalledWith(new Set(['page']), 'template');
        expect(checkbox.checked).toBe(false);
    });
});
