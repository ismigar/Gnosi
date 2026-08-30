import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VaultViewBody, type VaultViewBodyProps } from './VaultViewBody';
import type { DigitalBrainCalendarProps } from '../../calendar/components/DigitalBrainCalendar';
import type { VaultTableProps } from './VaultTable';

const calendarProbe = vi.hoisted(() => vi.fn<(props: DigitalBrainCalendarProps) => void>());
const tableProbe = vi.hoisted(() => vi.fn<(props: VaultTableProps) => void>());
const rendererProbe = vi.hoisted(() => vi.fn<(props: RendererProbeProps) => void>());

interface RendererProbeProps extends Record<string, unknown> {
    readonly children?: ReactNode;
}

function noteCount(props: RendererProbeProps): string {
    rendererProbe(props);
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
    VaultTable: (props: VaultTableProps) => { tableProbe(props); return <div
        data-testid="table-renderer"
        data-list-view={props.isListView === true ? 'true' : 'false'}
        data-note-count={String(props.notes?.length ?? 0)}
    />; },
}));
vi.mock('./VaultKanban', () => ({
    VaultKanban: (props: RendererProbeProps) => <div data-testid="board-renderer" data-note-count={noteCount(props)} />,
}));
vi.mock('./VaultGallery', () => ({
    VaultGallery: (props: RendererProbeProps) => <div data-testid="gallery-renderer" data-note-count={noteCount(props)} />,
}));
vi.mock('../../../shared/record-views/VaultTimeline', () => ({
    VaultTimeline: (props: RendererProbeProps) => <div data-testid="timeline-renderer" data-note-count={noteCount(props)} />,
}));
vi.mock('./VaultChart', () => ({
    VaultChart: (props: RendererProbeProps) => <div data-testid="chart-renderer" data-note-count={noteCount(props)} />,
}));
vi.mock('./VaultFeed', () => ({
    VaultFeed: (props: RendererProbeProps) => { rendererProbe(props); return <div data-testid="feed-renderer">
        <button data-testid="open-feed-config" onClick={() => { invoke(props, 'onOpenConfig'); }}>config</button>
        <button data-testid="clear-feed-search" onClick={() => { invoke(props, 'onClearSearch'); }}>clear</button>
    </div>; },
}));
vi.mock('../../calendar/components/DigitalBrainCalendar', () => ({
    DigitalBrainCalendar: (props: DigitalBrainCalendarProps) => { calendarProbe(props); return <div
        data-testid="calendar-renderer"
        data-date-field={scalarText(props.dateField)}
        data-note-count={String(Array.isArray(props.allNotes) ? props.allNotes.length : 0)}
    />; },
}));
vi.mock('./VaultViewErrorBoundary', () => ({
    VaultViewErrorBoundary: ({ children }: RendererProbeProps) => <>{children}</>,
}));
vi.mock('../../../shared/records/hooks/useVaultViewData', () => ({
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

    const tableProps = (): VaultTableProps => {
        const props = tableProbe.mock.lastCall?.[0];
        if (!props) throw new Error('Table did not render');
        return props;
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

    it('retains valid schema, pages, view and extension identities at the typed table boundary', () => {
        const schema = { tables: [{ id: 'resources', fields: [{ id: 'files', config: { custom: [null, 7] } }] }],
            plugin: { revision: 3, settings: ['custom'] } };
        const tableNotes = [{ id: 'child', title: 'Child', parent_id: 'parent', resolved_table_id: 'resources',
            last_modified: '2026-08-30', extension: { custom: [null, false, 8] },
            metadata: { parent_id: 'parent', table_id: 'resources', database_id: 'db', database_table_id: 'table',
                icon: '📚', translation_lang: 'ca', translation_stale: false,
                relation: ['page-2'], attachment: { path: 'file.pdf', size: 10 } } }];
        const activeView = { id: 'view', table_id: 'resources', rowHeight: 'compact', groupBy: 'Status',
            groupSort: 'count', group_sort: 'alpha', groupSortDir: 'desc', group_sort_dir: 'asc',
            enableSubitems: false, columnWidths: { title: 0, Status: 240 }, visibleProperties: ['title', 'Status'],
            sort: { field: 'title', direction: 'asc' }, sorts: [{ field: 'Status', direction: 'desc' }],
            filters: [{ field: 'Status', value: ['Open'], operator: 'in' }],
            filterTree: { conjunction: 'and', rules: [{ field: 'Status', value: null }] },
            pluginConfig: { enabled: true, nested: [null, { version: 1 }] } };
        const templates = [{ id: 'template', title: null, extension: { fields: ['Status'] } }];
        const actionRules = { rules: [{ custom: true }] };
        const functionalities = [{ id: 'plugin', action: 'custom', config: { nested: ['data'] } }];
        const restoreRecordFocus = { recordId: 'child', requestId: 0, extension: 'keep' };
        renderBody({ ...baseProps, notes: tableNotes, allNotes: tableNotes, schema, activeView, templates,
            actionRules, functionalities, restoreRecordFocus });

        const props = tableProps();
        expect(props.notes).toBe(tableNotes);
        expect(props.allNotes).toBe(tableNotes);
        expect(props.schema).toBe(schema);
        expect(props.activeView).toBe(activeView);
        expect(props.templates).toBe(templates);
        expect(props.actionRules).toBe(actionRules);
        expect(props.functionalities).toBe(functionalities);
        expect(props.restoreRecordFocus).toBe(restoreRecordFocus);
        renderBody({ ...baseProps, type: 'list', notes: tableNotes, allNotes: tableNotes, schema, activeView, templates });
        expect(tableProps().notes).toBe(tableNotes);
        expect(tableProps().activeView).toBe(activeView);
    });

    it('normalizes scalar titles without dropping rows, metadata, extensions or valid siblings', () => {
        const validSibling = notes[0];
        if (!validSibling) throw new Error('Missing valid sibling fixture');
        const metadata = { table_id: 'resources', attachment: { path: 'file.pdf' }, custom: [null, false] };
        const custom = { enabled: true };
        const sourceNotes = [validSibling, { id: 'numeric', title: 42, metadata, custom },
            { id: 'boolean', title: false }, { id: 'bigint', title: 12n }, { id: 'null', title: null }];
        renderBody({ ...baseProps, notes: sourceNotes, allNotes: sourceNotes });
        expect(tableProps().notes?.map(note => [note.id, note.title])).toEqual([
            ['page-1', 'First'], ['numeric', '42'], ['boolean', 'false'], ['bigint', '12'], ['null', undefined],
        ]);
        expect(tableProps().allNotes).toEqual(tableProps().notes);
        expect(tableProps().notes?.[0]).toBe(validSibling);
        expect(tableProps().notes?.[1]?.metadata).toBe(metadata);
        expect(tableProps().notes?.[1]?.custom).toBe(custom);
        expect(sourceNotes[1]?.title).toBe(42);
        expect(sourceNotes[4]?.title).toBeNull();
    });

    it('refines malformed reserved fields individually and keeps remaining view and page data', () => {
        const viewExtension = { aliases: ['Status'], settings: { keep: true } };
        const activeView = { id: 'view', table_id: null, rowHeight: 12, groupBy: 'Status', groupSort: false,
            group_sort: 'alpha', groupSortDir: [], group_sort_dir: 'desc', enableSubitems: 'false',
            columnWidths: { title: 240, invalid: 'wide', Status: 180 },
            visibleProperties: ['title', null, 12, 'Status'], extension: viewExtension };
        const metadata = { parent_id: ['bad'], table_id: 'resources', database_id: null, database_table_id: 9,
            icon: {}, translation_lang: false, translation_stale: 'false', extension: { values: [0, null] } };
        const sourceNotes = [{ id: 'row', title: 'Row', parent_id: 7, resolved_table_id: null,
            last_modified: false, metadata, extension: ['keep'] }];
        renderBody({ ...baseProps, notes: sourceNotes, activeView });
        const props = tableProps();
        expect(props.activeView).toMatchObject({ id: 'view', groupBy: 'Status', group_sort: 'alpha',
            group_sort_dir: 'desc', columnWidths: { title: 240, Status: 180 }, visibleProperties: ['title', 'Status'] });
        expect(props.activeView?.columnWidths).not.toHaveProperty('invalid');
        expect(props.activeView?.extension).toBe(viewExtension);
        expect(props.activeView?.rowHeight).toBeUndefined();
        expect(props.activeView?.enableSubitems).toBeUndefined();
        expect(props.notes?.[0]).toMatchObject({ id: 'row', title: 'Row', extension: ['keep'],
            parent_id: undefined, resolved_table_id: undefined, last_modified: undefined,
            metadata: { table_id: 'resources', parent_id: undefined, translation_stale: undefined } });
        expect(props.notes?.[0]?.metadata?.extension).toBe(metadata.extension);
        expect(activeView.columnWidths.invalid).toBe('wide');
        expect(metadata.parent_id).toEqual(['bad']);
    });

    it.each([null, undefined, { recordId: 'row', requestId: 'request' }, { recordId: 'row', requestId: 0 }])(
        'preserves a valid or absent focus request (%j)', restoreRecordFocus => {
            renderBody({ ...baseProps, restoreRecordFocus });
            expect(tableProps().restoreRecordFocus).toBe(restoreRecordFocus);
        },
    );

    it('retains all valid template shapes and their extensions when mixed with invalid entries', () => {
        const validTemplates = [{ id: 'titled', title: 'Template', extension: { custom: [null, 1] } },
            { id: 'untitled' }, { id: 'null-title', title: null }, { id: 'empty-title', title: '' }];
        const templates = [...validTemplates, { id: 1 }, { title: 'Missing ID' }, { id: 'bad-title', title: {} }];
        renderBody({ ...baseProps, templates });
        expect(tableProps().templates).toEqual(validTemplates);
        validTemplates.forEach((template, index) => { expect(tableProps().templates?.[index]).toBe(template); });
        expect(templates).toHaveLength(7);
    });

    it('keeps normalized data stable across focus changes and refreshes each changed input', () => {
        const sourceNotes = [{ id: 'row', title: 1 }];
        const activeView = { id: 'view', columnWidths: { title: 100, malformed: 'wide' } };
        const templates = [{ id: 'valid' }, { id: 1 }];
        const props = { ...baseProps, notes: sourceNotes, allNotes: sourceNotes, activeView, templates };
        renderBody(props);
        const initial = tableProps();
        renderBody({ ...props, restoreRecordFocus: { recordId: 'row', requestId: 'focus' }, searchTerm: '1' });
        expect(tableProps().notes).toBe(initial.notes);
        expect(tableProps().allNotes).toBe(initial.allNotes);
        expect(tableProps().activeView).toBe(initial.activeView);
        expect(tableProps().templates).toBe(initial.templates);
        renderBody({ ...props, notes: [{ id: 'next', title: 2 }], allNotes: [], activeView: {}, templates: [] });
        expect(tableProps().notes?.map(note => [note.id, note.title])).toEqual([['next', '2']]);
        expect(tableProps().allNotes).toEqual([]);
        expect(tableProps().activeView).toEqual({});
        expect(tableProps().templates).toEqual([]);
        expect(tableProps().restoreRecordFocus).toBeUndefined();
    });

    it.each([null, false, [], 'invalid'])('ignores malformed width/property containers (%j)', value => {
        renderBody({ ...baseProps, activeView: { columnWidths: value, visibleProperties: value, extension: 'keep' } });
        expect(tableProps().activeView).toMatchObject({ columnWidths: undefined, extension: 'keep' });
        expect(tableProps().activeView?.visibleProperties).toEqual(Array.isArray(value) ? value : undefined);
    });

    it.each([false, [], 'row', { recordId: 1, requestId: 'request' }, { recordId: 'row' },
        { recordId: 'row', requestId: {} }])('ignores an invalid focus request (%j)', restoreRecordFocus => {
        renderBody({ ...baseProps, restoreRecordFocus });
        expect(tableProps().restoreRecordFocus).toBeUndefined();
    });

    it.each(['table', 'list'])('adapts notebook selections to independent arrays in %s mode', type => {
        const onCreateNotebook = vi.fn<(ids: readonly string[]) => void>();
        const selectedIds = new Set(['second', 'first']);
        renderBody({ ...baseProps, type, onCreateNotebook });
        tableProps().onCreateNotebook?.(selectedIds);
        expect(onCreateNotebook).toHaveBeenCalledWith(['second', 'first']);
        const receivedIds = onCreateNotebook.mock.lastCall?.[0];
        selectedIds.add('later');
        expect(receivedIds).toEqual(['second', 'first']);
        tableProps().onCreateNotebook?.(new Set());
        expect(onCreateNotebook).toHaveBeenLastCalledWith([]);
        renderBody({ ...baseProps, type });
        expect(tableProps().onCreateNotebook).toBeUndefined();
    });

    it('leaves optional actions absent and permits missing onNoteSelect', () => {
        renderBody({ notes });
        expect(tableProps().onCreateNotebook).toBeUndefined();
        expect(tableProps().onDeleteSelected).toBeUndefined();
        expect(() => { tableProps().onNoteSelect('page-1'); }).not.toThrow();
    });

    it('preserves all other table callbacks, payloads, return values and focus options', () => {
        const callbacks = { onNoteSelect: vi.fn(), onCreateRecord: vi.fn(), onDeletePage: vi.fn(),
            onDeleteSelected: vi.fn(), onApplyTemplate: vi.fn(), onUpdateView: vi.fn(() => 'saved'),
            onOpenParallel: vi.fn(), onCellSaved: vi.fn(), onTranslated: vi.fn(),
            onUpdateFieldOptions: vi.fn(), onRecordFocusRestored: vi.fn(), registerNavApi: vi.fn(),
            onExitTop: vi.fn(), onExitBottom: vi.fn(), onEscape: vi.fn() };
        renderBody({ ...baseProps, ...callbacks, searchTerm: 'needle', isEmbedded: true, maxHeight: '50vh' });
        const props = tableProps();
        for (const [key, callback] of Object.entries(callbacks)) expect(props).toHaveProperty(key, callback);
        expect(props).toMatchObject({ searchTerm: 'needle', isEmbedded: true, maxHeight: '50vh' });
        const selection = new Set(['page-1']);
        const focusOptions = { returnFocusId: 'focus' };
        const view = { id: 'view', extension: { keep: [1] } };
        const options = [{ label: 'Open', value: 'open', extension: true }];
        const translation = { id: 'page-1', status: 'translated' };
        const navApi = { focusFirstCell: () => true, focusLastCell: () => false };
        props.onNoteSelect('page-1', focusOptions);
        props.onDeletePage?.('page-1', 'First');
        props.onDeleteSelected?.(selection);
        props.onApplyTemplate?.(selection, 'template');
        expect(props.onUpdateView?.(view)).toBe('saved');
        props.onUpdateFieldOptions?.('table', 'field', options);
        props.onTranslated?.(translation);
        props.onRecordFocusRestored?.(0);
        props.registerNavApi?.(navApi);
        props.registerNavApi?.(null);
        expect(callbacks.onNoteSelect).toHaveBeenCalledWith('page-1', focusOptions);
        expect(callbacks.onDeletePage).toHaveBeenCalledWith('page-1', 'First');
        expect(callbacks.onDeleteSelected).toHaveBeenCalledWith(selection);
        expect(callbacks.onApplyTemplate).toHaveBeenCalledWith(selection, 'template');
        expect(callbacks.onUpdateView).toHaveBeenCalledWith(view);
        expect(callbacks.onUpdateFieldOptions).toHaveBeenCalledWith('table', 'field', options);
        expect(callbacks.onTranslated).toHaveBeenCalledWith(translation);
        expect(callbacks.onRecordFocusRestored).toHaveBeenCalledWith(0);
        expect(callbacks.registerNavApi).toHaveBeenNthCalledWith(1, navApi);
        expect(callbacks.registerNavApi).toHaveBeenLastCalledWith(null);
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

    it.each(['board', 'gallery', 'timeline', 'feed'])('preserves open data, templates and callback identity for %s', type => {
        const extension = { file: new Blob(['fixture']), handler: () => 'custom' };
        const sourceNotes = [{ id: 'opaque', title: 42, metadata: { extension } }, { id: 'empty', metadata: null }];
        const view = { id: 'open', extension };
        const templates = [{ id: 'template', title: null, extension }];
        const onUpdateNote = vi.fn(() => extension);
        const onDeletePage = vi.fn();
        renderBody({ type, notes: sourceNotes, allNotes: sourceNotes, activeView: view,
            templates, onUpdateNote, onDeletePage, feedDensity: 'custom-density', feedGroupMode: 'custom-group' });
        const props = rendererProbe.mock.lastCall?.[0];
        expect(props?.notes).toBe(sourceNotes);
        expect(props?.allNotes).toBe(sourceNotes);
        expect(props?.activeView).toBe(view);
        expect(props?.templates).toBe(templates);
        expect(props?.onNoteSelect).toBeUndefined();
        expect(props?.onUpdateNote).toBe(onUpdateNote);
        expect(props?.onDeletePage).toBe(onDeletePage);
        if (type === 'feed') {
            expect(props?.density).toBe('custom-density');
            expect(props?.groupMode).toBe('custom-group');
            expect(props).not.toHaveProperty('onCreateNotebook');
        }
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

    it('normalizes primitive calendar titles and validates template contracts at the boundary', () => {
        renderBody({ type: 'calendar', notes: [{ id: 'number', title: 42 }, { id: 'empty', title: null }],
            templates: [{ id: 'valid', title: 'Template' }, { id: 5 }, { id: 'bad-title', title: {} }] });
        const props = calendarProbe.mock.lastCall?.[0];
        expect(props?.allNotes).toEqual([{ id: 'empty', title: null }, { id: 'number', title: '42' }]);
        expect(props?.templates).toEqual([{ id: 'valid', title: 'Template' }]);
    });
});
