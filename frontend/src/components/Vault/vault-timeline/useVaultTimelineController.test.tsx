import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VaultViewPage } from '../../../hooks/useVaultViewData';
import { logError } from '../../../lib/notifyError';
import { dispatchWindowEvent } from '../../../shared/platform/browser-events';
import type { VaultViewBodyProps } from '../VaultViewBody';
import { useVaultTimelineController } from './useVaultTimelineController';
import type { TimelineController, VaultTimelineProps } from './types';

const plugins = vi.hoisted(() => ({ enhancedPeriod: false }));

vi.mock('../../../hooks/useLocaleSettings', () => ({
    useLocaleSettings: () => ({ dateFormat: 'YYYY-MM-DD', dateLocale: 'en-US' }),
}));
vi.mock('../../../plugins/usePlugins', () => ({
    usePlugins: () => ({
        getPluginSettings: () => ({}),
        isEnabled: () => plugins.enhancedPeriod,
    }),
}));
vi.mock('../useTitlePreview', () => ({
    useTitlePreview: () => ({ getTitleProps: () => ({}), preview: null }),
}));
vi.mock('../../../lib/notifyError', () => ({ logError: vi.fn() }));

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
        const onUpdateNote = vi.fn<NonNullable<VaultViewBodyProps['onUpdateNote']>>(
            () => mode === 'async' ? Promise.resolve(opaque) : opaque,
        );
        render({ ...scheduleProps, notes, onUpdateNote });
        act(() => { controller().setSelectingPredecessorFor('dependent'); });
        await act(async () => { await controller().handleAddPredecessor('dependent', 'predecessor'); });
        expect(onUpdateNote.mock.calls.map(([id]) => id)).toEqual(['dependent', 'dependent', 'successor']);
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
        expect(onUpdateNote.mock.calls[1]).toEqual(['dependent', {
            metadata: { Start: '2024-01-05', End: '2024-01-06' },
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
        const pending = controller().handleAddPredecessor('dependent', 'predecessor');
        expect(onUpdateNote).toHaveBeenCalledTimes(1);
        expect(controller().selectingPredecessorFor).toBe('dependent');
        await act(async () => { finishSave(new Map()); await pending; });
        expect(onUpdateNote).toHaveBeenCalledTimes(3);
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

    it('logs date-update rejection, stops successors and closes the saved dependency picker', async () => {
        const failure = new Error('date rejected');
        const onUpdateNote = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>()
            .mockReturnValueOnce(Symbol('saved'))
            .mockImplementationOnce(() => Promise.reject(failure));
        render({ ...scheduleProps, onUpdateNote });
        act(() => { controller().setSelectingPredecessorFor('dependent'); });
        await act(async () => { await controller().handleAddPredecessor('dependent', 'predecessor'); });
        expect(onUpdateNote).toHaveBeenCalledTimes(2);
        expect(logError).toHaveBeenCalledWith('timeline-date-update', failure);
        expect(controller().selectingPredecessorFor).toBeNull();
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
});
