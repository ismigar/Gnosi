import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VaultViewPage } from '../../records/hooks/useVaultViewData';
import { logError } from '../../notifications/notifyError';
import { dispatchWindowEvent } from '../../platform/browser-events';
import { useVaultTimelineController } from './useVaultTimelineController';
import type { TimelineController, VaultTimelineProps } from './types';

const plugins = vi.hoisted(() => ({ enhancedPeriod: false }));

vi.mock('../../i18n/useLocaleSettings', () => ({
    useLocaleSettings: () => ({ dateFormat: 'YYYY-MM-DD', dateLocale: 'en-US' }),
}));
vi.mock('../../plugins/usePlugins', () => ({
    usePlugins: () => ({
        getPluginSettings: () => ({}),
        isEnabled: () => plugins.enhancedPeriod,
    }),
}));
vi.mock('../../editor/useTitlePreview', () => ({
    useTitlePreview: () => ({ getTitleProps: () => ({}), preview: null }),
}));
vi.mock('../../notifications/notifyError', () => ({ logError: vi.fn() }));

const schedulingNotes: readonly VaultViewPage[] = [
    { id: 'predecessor', metadata: { Start: '2024-01-04', End: '2024-01-05' } },
    { id: 'dependent', metadata: { Start: '2024-01-02', End: '2024-01-03' } },
    { id: 'successor', metadata: {
        Start: '2024-01-03', End: '2024-01-04', predecessor_ids: ['dependent'],
    } },
];
const scheduleProps: VaultTimelineProps = {
    activeView: { dateField: 'Start', endDateField: 'End' },
    notes: schedulingNotes,
    schema: { Start: 'date', End: 'date' },
};

describe('useVaultTimelineController open contracts', () => {
    let container: HTMLDivElement;
    let root: Root;
    let current: TimelineController | null;

    function Probe(props: VaultTimelineProps) {
        current = useVaultTimelineController(props);
        return null;
    }

    function controller(): TimelineController {
        if (!current) throw new Error('Timeline controller not mounted');
        return current;
    }

    function render(props: VaultTimelineProps): void {
        act(() => { root.render(<Probe {...props} />); });
    }

    function key(key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
        const event = new KeyboardEvent('keydown', { key, cancelable: true, ...modifiers });
        act(() => { dispatchWindowEvent(event); });
        return event;
    }

    beforeEach(() => {
        Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
            configurable: true, value: true,
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        current = null;
        plugins.enhancedPeriod = false;
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
        vi.clearAllMocks();
    });

    it('retains input row identity through scalar search, filtering and sorting', () => {
        const extension = new Map([['opaque', 7n]]);
        const cyclic: Record<string, unknown> = { extension };
        cyclic.self = cyclic;
        const first: VaultViewPage = {
            id: 'first', title: 42, last_modified: '2024-01-01',
            metadata: { Status: ['keep'], Rank: 2, cyclic },
        };
        const second: VaultViewPage = {
            id: 'second', title: '42 later', last_modified: '2024-01-02',
            metadata: { Status: 'keep', Rank: 1, cyclic },
        };
        const props: VaultTimelineProps = {
            activeView: {
                extension, dateField: { opaque: true }, colorField: false,
                filters: [{ field: 'Status', operator: 'equals', value: 'keep' }],
                sorts: [{ field: 'Rank', direction: 'asc' }],
            },
            notes: [first, second, { id: 'null', metadata: null }],
            searchTerm: '42',
        };
        render(props);
        expect(controller().sortedNotes).toEqual([second, first]);
        expect(controller().sortedNotes[0]).toBe(second);
        expect(controller().sortedNotes[1]).toBe(first);
        expect(controller().chartData.map(({ id }) => id)).toEqual(['second', 'first']);
        expect(controller().chartData[0]?.metadata).toBe(second.metadata);
        expect(props.activeView?.extension).toBe(extension);
        expect(first.metadata?.cyclic).toBe(cyclic);
    });

    it('selects filtered rows with Ctrl/Cmd+A, clears with Escape and deletes a stable ID snapshot', () => {
        const onDeleteSelected = vi.fn<NonNullable<VaultTimelineProps['onDeleteSelected']>>();
        render({ ...scheduleProps, searchTerm: 'dependent', onDeleteSelected,
            notes: schedulingNotes.map(note => ({ ...note, title: note.id })),
        });
        key('a', { ctrlKey: true });
        // The successor also matches through its predecessor_ids metadata.
        expect(controller().selectedIds).toEqual(new Set(['dependent', 'successor']));
        key('Escape');
        render({ ...scheduleProps, onDeleteSelected });
        expect(key('a', { ctrlKey: true }).defaultPrevented).toBe(true);
        expect(controller().selectedIds).toEqual(new Set(['predecessor', 'dependent', 'successor']));
        key('Escape');
        expect(controller().selectedIds.size).toBe(0);
        key('a', { metaKey: true });
        const selectedBeforeDelete = controller().selectedIds;
        key('Delete');
        expect(onDeleteSelected).toHaveBeenCalledTimes(1);
        const snapshot = onDeleteSelected.mock.calls[0]?.[0];
        expect(snapshot).toEqual(selectedBeforeDelete);
        expect(snapshot).not.toBe(selectedBeforeDelete);
        expect(controller().selectedIds.size).toBe(0);
        act(() => { controller().selectAll(['dependent']); });
        expect(snapshot).toEqual(new Set(['predecessor', 'dependent', 'successor']));
        key('Backspace');
        expect(onDeleteSelected.mock.calls[1]?.[0]).toEqual(new Set(['dependent']));
    });

    it('leaves text-entry selection and deletion alone', () => {
        const onDeleteSelected = vi.fn<NonNullable<VaultTimelineProps['onDeleteSelected']>>();
        render({ ...scheduleProps, onDeleteSelected });
        act(() => { controller().selectAll(); });
        const input = document.createElement('input');
        container.append(input);
        input.focus();
        expect(key('a', { ctrlKey: true }).defaultPrevented).toBe(false);
        key('Delete');
        key('Backspace');
        expect(onDeleteSelected).not.toHaveBeenCalled();
        expect(controller().selectedIds.size).toBe(3);
        key('Escape');
        expect(controller().selectedIds.size).toBe(0);
    });

    it('passes original scalar/absent titles to individual deletion and preserves thrown errors', () => {
        const onDeletePage = vi.fn<NonNullable<VaultTimelineProps['onDeletePage']>>();
        render({ notes: [{ id: 'number', title: 3n }, { id: 'absent' },
            { id: 'null', title: null }, { id: 'bool', title: true }], onDeletePage });
        act(() => { controller().selectAll(); });
        act(() => { controller().handleBulkDelete(); });
        expect(onDeletePage.mock.calls).toEqual([
            ['number', 3n], ['absent', undefined], ['null', null], ['bool', true],
        ]);
        expect(controller().selectedIds.size).toBe(0);
        const failure = new Error('delete failed');
        onDeletePage.mockImplementation(() => { throw failure; });
        act(() => { controller().selectAll(['number']); });
        expect(() => { controller().handleBulkDelete(); }).toThrow(failure);
        expect(controller().selectedIds).toEqual(new Set(['number']));
    });

    it.each(['sync', 'async'])('awaits %s unknown save results and preserves opaque metadata', async (mode) => {
        const opaque = new Map([['value', 9n]]);
        const metadata: Record<string, unknown> = {
            Start: '2024-01-02', End: '2024-01-03', opaque,
        };
        metadata.self = metadata;
        const notes = schedulingNotes.map((note) => note.id === 'dependent'
            ? { ...note, metadata } : note);
        const onUpdateNote = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>(
            () => mode === 'async' ? Promise.resolve(opaque) : opaque,
        );
        render({ ...scheduleProps, notes, onUpdateNote });
        act(() => { controller().setSelectingPredecessorFor('dependent'); });
        await act(async () => { await controller().handleAddPredecessor('dependent', 'predecessor'); });
        expect(onUpdateNote.mock.calls.map(([id]) => id)).toEqual(['dependent', 'successor']);
        const patch: unknown = onUpdateNote.mock.calls[0]?.[1];
        if (!patch || typeof patch !== 'object' || !('metadata' in patch)
            || !patch.metadata || typeof patch.metadata !== 'object'
            || !('opaque' in patch.metadata) || !('self' in patch.metadata)) {
            throw new Error('Missing metadata patch');
        }
        expect(patch.metadata.opaque).toBe(opaque);
        expect(patch.metadata.self).toBe(metadata);
        expect(metadata.predecessor_ids).toBeUndefined();
        expect(controller().selectingPredecessorFor).toBeNull();
        expect(onUpdateNote.mock.calls[0]?.[1].metadata).toMatchObject({ Start: '2024-01-05', End: '2024-01-06' });
        expect(onUpdateNote.mock.calls[1]).toEqual(['successor', {
            metadata: { Start: '2024-01-06', End: '2024-01-07' },
        }]);
    });

    it('accepts a null-metadata dependency save and does not require a save callback', async () => {
        const onUpdateNote = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>(() => 17);
        render({ notes: [{ id: 'null', metadata: null }], onUpdateNote });
        await act(async () => { await controller().handleAddPredecessor('null', 'other'); });
        expect(onUpdateNote.mock.calls).toEqual([['null', { metadata: { predecessor_ids: ['other'] } }]]);
        render({ notes: [{ id: 'null', metadata: null }] });
        act(() => { controller().setSelectingPredecessorFor('null'); });
        await act(async () => { await controller().handleAddPredecessor('null', 'other'); });
        expect(controller().selectingPredecessorFor).toBeNull();
    });

    it('does not schedule dates or close the picker before an asynchronous save resolves', async () => {
        let finishSave: (value: unknown) => void = () => { throw new Error('Save not started'); };
        const saved = new Promise<unknown>((resolve) => { finishSave = resolve; });
        const onUpdateNote = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>()
            .mockReturnValueOnce(saved).mockReturnValue(undefined);
        render({ ...scheduleProps, onUpdateNote });
        act(() => { controller().setSelectingPredecessorFor('dependent'); });
        let pending: Promise<void> = Promise.resolve();
        act(() => { pending = controller().handleAddPredecessor('dependent', 'predecessor'); });
        expect(onUpdateNote).toHaveBeenCalledTimes(1);
        expect(controller().selectingPredecessorFor).toBe('dependent');
        await act(async () => { finishSave(new Map()); await pending; });
        expect(onUpdateNote).toHaveBeenCalledTimes(2);
        expect(controller().selectingPredecessorFor).toBeNull();
    });

    it('skips duplicate dependencies without mutating the existing predecessor list', async () => {
        const predecessorIds = ['predecessor'];
        const onUpdateNote = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>();
        render({ notes: [{ id: 'dependent', metadata: { predecessor_ids: predecessorIds } }], onUpdateNote });
        await act(async () => { await controller().handleAddPredecessor('dependent', 'predecessor'); });
        expect(onUpdateNote).not.toHaveBeenCalled();
        expect(predecessorIds).toEqual(['predecessor']);
    });

    it.each(['sync', 'async'])('preserves %s dependency failures and leaves the picker open', async (mode) => {
        const failure = new Error('dependency rejected');
        const onUpdateNote = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>(() => {
            if (mode === 'sync') throw failure;
            return Promise.reject(failure);
        });
        render({ ...scheduleProps, onUpdateNote });
        act(() => { controller().setSelectingPredecessorFor('dependent'); });
        await act(async () => {
            await expect(controller().handleAddPredecessor('dependent', 'predecessor')).rejects.toBe(failure);
        });
        expect(onUpdateNote).toHaveBeenCalledTimes(1);
        expect(controller().selectingPredecessorFor).toBe('dependent');
        expect(logError).not.toHaveBeenCalled();
    });

    it('rolls back an already saved dependency if a successor save fails and keeps the picker open', async () => {
        const failure = new Error('date rejected');
        const onUpdateNote = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>()
            .mockReturnValueOnce(Symbol('saved'))
            .mockRejectedValueOnce(failure).mockResolvedValue(undefined);
        render({ ...scheduleProps, onUpdateNote });
        act(() => { controller().setSelectingPredecessorFor('dependent'); });
        await act(async () => { await expect(controller().handleAddPredecessor('dependent', 'predecessor')).rejects.toBe(failure); });
        expect(onUpdateNote.mock.calls.map(([id]) => id)).toEqual(['dependent', 'successor', 'dependent']);
        expect(onUpdateNote.mock.calls[2]?.[1].metadata).toMatchObject({ Start: '2024-01-02', End: '2024-01-03', predecessor_ids: null });
        expect(controller().selectingPredecessorFor).toBe('dependent');
        expect(controller().saving).toBe(false);
        expect(controller().canUndo).toBe(false);
        expect(logError).not.toHaveBeenCalled();
    });

    it('reads an enhanced period with open fields without modifying the input object', async () => {
        plugins.enhancedPeriod = true;
        const period: Record<string, unknown> = {
            start: { toString: () => '2024-01-02' }, end: '2024-01-03',
            durationValue: 1, durationUnit: 'days', predecessorIds: [],
        };
        period.self = period;
        const onUpdateNote = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>(() => null);
        render({
            activeView: { dateField: 'Period' }, schema: { Period: 'period' },
            notes: [{ id: 'dependent', metadata: { Period: period } }], onUpdateNote,
        });
        await act(async () => { await controller().handleAddPredecessor('dependent', 'external'); });
        expect(onUpdateNote).toHaveBeenCalledTimes(1);
        expect(onUpdateNote.mock.calls[0]?.[1].metadata.Period).toMatchObject({ predecessorIds: ['external'] });
        expect(period.predecessorIds).toEqual([]);
        expect(period.self).toBe(period);
    });
    it('honors the latest of multiple predecessors when adding another connection', async () => {
        const onUpdateNote = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>();
        render({ ...scheduleProps, onUpdateNote, notes: [
            ...schedulingNotes,
            { id: 'later', metadata: { Start: '2024-01-09', End: '2024-01-10' } },
            { id: 'dependent', metadata: { Start: '2024-01-10', End: '2024-01-12', predecessor_ids: ['later'] } },
        ].filter((note, index, all) => all.map(candidate => candidate.id).lastIndexOf(note.id) === index) });
        await act(async () => { await controller().handleAddPredecessor('dependent', 'predecessor'); });
        expect(onUpdateNote.mock.calls[0]?.[1].metadata).toMatchObject({ Start: '2024-01-10', End: '2024-01-12', predecessor_ids: ['later', 'predecessor'] });
    });

    it('rejects self and transitive cycles at the scheduling boundary', async () => {
        const onUpdateNote = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>();
        render({ ...scheduleProps, onUpdateNote });
        await act(async () => {
            await expect(controller().handleAddPredecessor('dependent', 'dependent')).rejects.toThrow('timeline.dependency_cycle');
            await expect(controller().handleAddPredecessor('dependent', 'successor')).rejects.toThrow('timeline.dependency_cycle');
        });
        expect(onUpdateNote).not.toHaveBeenCalled();
    });

    it('serializes a new period dependency without losing dates, existing connections or progress', async () => {
        plugins.enhancedPeriod = true;
        const onUpdateNote = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>();
        render({ activeView: { dateField: 'Period' }, schema: { Period: 'period', Period_config: { skip_non_working_days: false } }, onUpdateNote,
            notes: [
                { id: 'first', metadata: { Period: { start: '2024-01-01', end: '2024-01-02' } } },
                { id: 'next', metadata: { Period: { start: '2024-01-03', end: '2024-01-04' } } },
                { id: 'task', metadata: { Period: { start: '2024-01-02', end: '2024-01-03', durationValue: 1, durationUnit: 'days', percentComplete: 35, predecessorIds: ['first'] } } },
            ],
        });
        await act(async () => { await controller().handleAddPredecessor('task', 'next'); });
        expect(onUpdateNote.mock.calls[0]?.[1].metadata.Period).toMatchObject({ start: '2024-01-04T09:00', end: '2024-01-04T17:00', percentComplete: 35,
            predecessorIds: ['first', 'next'], dependencies: [{ predecessorId: 'first', type: 'FS', lagMinutes: 0 }, { predecessorId: 'next', type: 'FS', lagMinutes: 0 }] });
    });

    it('propagates converging dependency branches until every successor respects the latest finish', async () => {
        const onUpdateNote = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>();
        render({ ...scheduleProps, onUpdateNote, notes: [
            { id: 'root', metadata: { Start: '2024-01-01', End: '2024-01-02' } },
            { id: 'short', metadata: { Start: '2024-01-02', End: '2024-01-03', predecessor_ids: ['root'] } },
            { id: 'join', metadata: { Start: '2024-01-05', End: '2024-01-06', predecessor_ids: ['short', 'long'] } },
            { id: 'tail', metadata: { Start: '2024-01-06', End: '2024-01-07', predecessor_ids: ['join'] } },
            { id: 'long', metadata: { Start: '2024-01-02', End: '2024-01-05', predecessor_ids: ['root'] } },
        ] });
        await act(async () => { await controller().updateDates('root', new Date('2024-01-06T00:00'), new Date('2024-01-07T00:00')); });
        expect(onUpdateNote.mock.calls.find(([id]) => id === 'join')?.[1].metadata).toMatchObject({ Start: '2024-01-10', End: '2024-01-11' });
        expect(onUpdateNote.mock.calls.find(([id]) => id === 'tail')?.[1].metadata).toMatchObject({ Start: '2024-01-11', End: '2024-01-12' });
        expect(new Set(onUpdateNote.mock.calls.map(([id]) => id)).size).toBe(onUpdateNote.mock.calls.length);
    });

    it('updates an existing predecessor relation column so it is visible in the table', async () => {
        const onUpdateNote = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>();
        render({ ...scheduleProps, schema: { Start: 'date', End: 'date', Predecessores: 'relation' }, onUpdateNote });
        await act(async () => { await controller().handleAddPredecessor('dependent', 'predecessor'); });
        expect(onUpdateNote.mock.calls[0]?.[1].metadata).toMatchObject({ Predecessores: ['predecessor'], Start: '2024-01-05', End: '2024-01-06' });
    });

    it('removes a rich period dependency without changing boundaries, progress or other connection types', async () => {
        plugins.enhancedPeriod = true;
        const onUpdateNote = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>();
        render({ activeView: { dateField: 'Period' }, schema: { Period: 'period' }, onUpdateNote,
            notes: [{ id: 'task', metadata: { Period: { start: '2024-01-02', end: '2024-01-03', percentComplete: 35,
                dependencies: [{ predecessorId: 'first', type: 'FS', lagMinutes: 0 }, { predecessorId: 'other', type: 'SS', lagMinutes: 60 }] } } }],
        });
        await act(async () => { await controller().removePredecessor('task', 'first'); });
        expect(onUpdateNote.mock.calls[0]?.[1].metadata.Period).toMatchObject({ start: '2024-01-02', end: '2024-01-03', percentComplete: 35,
            predecessorIds: ['other'], dependencies: [{ predecessorId: 'other', type: 'SS', lagMinutes: 60 }] });
    });

    it('removes a connection from both its relation column and legacy IDs without losing other predecessors', async () => {
        const onUpdateNote = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>();
        render({ ...scheduleProps, schema: { Start: 'date', End: 'date', Predecessores: 'relation' }, onUpdateNote,
            notes: [{ id: 'task', metadata: { Start: '2024-01-02', End: '2024-01-03', Predecessores: ['first', 'other'], predecessor_ids: ['first'] } }],
        });
        await act(async () => { await controller().removePredecessor('task', 'first'); });
        expect(onUpdateNote.mock.calls).toEqual([['task', { metadata: { Predecessores: ['other'], predecessor_ids: [] } }]]);
    });

    it('keeps failed dependency removal undoable state empty and propagates the save error', async () => {
        const failure = new Error('save failed');
        const onUpdateNote = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>().mockRejectedValue(failure);
        render({ ...scheduleProps, onUpdateNote });
        await act(async () => { await expect(controller().removePredecessor('successor', 'dependent')).rejects.toBe(failure); });
        expect(controller().canUndo).toBe(false);
        expect(controller().saving).toBe(false);
    });

});
