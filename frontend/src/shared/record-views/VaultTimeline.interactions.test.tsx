import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchWindowEvent } from '../platform/browser-events';
import { VaultTimeline } from './VaultTimeline';
import type { TimelineNote, TimelinePatch, VaultTimelineProps } from './vault-timeline/types';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
    Trans: () => null,
}));
vi.mock('../i18n/useLocaleSettings', () => ({ useLocaleSettings: () => ({ dateFormat: 'YYYY-MM-DD', dateLocale: 'ca-ES' }) }));
vi.mock('../plugins/usePlugins', () => ({ usePlugins: () => ({ getPluginSettings: () => ({}), isEnabled: () => false }) }));
vi.mock('../editor/useTitlePreview', () => ({ useTitlePreview: () => ({ getTitleProps: () => ({}), preview: null }) }));
vi.mock('../notifications/notifyError', () => ({ notifyError: vi.fn() }));

const initial: readonly TimelineNote[] = [
    { id: 'a', title: 'Research', metadata: { Start: '2026-01-02', End: '2026-01-04', Status: 'Doing', body: 'preserve' } },
    { id: 'b', title: 'Draft', metadata: { Start: '2026-01-04', End: '2026-01-05', predecessor_ids: ['a'] } },
    { id: 'c', title: 'Review', metadata: { Start: '2026-01-05', End: '2026-01-06', predecessor_ids: ['b'] } },
];

describe('interactive timeline and its shared table records', () => {
    let container: HTMLDivElement;
    let root: Root;
    let writes: { readonly id: string; readonly patch: TimelinePatch }[];
    function Harness({ notes = initial, visibleIds }: { readonly notes?: readonly TimelineNote[]; readonly visibleIds?: readonly string[] }) {
        const [records, setRecords] = useState(notes);
        const save: NonNullable<VaultTimelineProps['onUpdateNote']> = (id, patch) => {
            writes.push({ id, patch });
            setRecords(current => current.map(note => note.id === id ? { ...note, metadata: { ...note.metadata, ...patch.metadata } } : note));
            return Promise.resolve();
        };
        return <><VaultTimeline activeView={{ dateField: 'Start', endDateField: 'End' }}
            notes={visibleIds ? records.filter(note => visibleIds.includes(note.id)) : records} allNotes={records}
            onUpdateNote={save} schema={{ Start: 'date', End: 'date' }} searchTerm="" />
            <table><tbody>{records.map(note => <tr key={note.id} data-table-record={note.id}><td>{typeof note.metadata?.Start === 'string' ? note.metadata.Start : ''}</td><td>{typeof note.metadata?.End === 'string' ? note.metadata.End : ''}</td><td>{JSON.stringify(note.metadata?.predecessor_ids ?? [])}</td></tr>)}</tbody></table></>;
    }
    function pointer(target: EventTarget, type: string, x: number, y = 150) {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        target.dispatchEvent(event);
    }
    function find(selector: string): HTMLElement {
        const element = container.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        return element;
    }
    async function drag(selector: string, days: number, target?: HTMLElement) {
        const element = find(selector);
        const track = element.closest<HTMLElement>('[data-timeline-track]');
        if (!track) throw new Error('Missing track');
        Object.defineProperty(track, 'getBoundingClientRect', { value: () => ({ width: 680 }) });
        const scroller = find('.custom-scrollbar');
        Object.defineProperty(scroller, 'getBoundingClientRect', { value: () => ({ left: 0, right: 1000, top: 0, bottom: 600 }) });
        const dx = days * 680 / 31;
        if (target) Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
        act(() => { pointer(element, 'pointerdown', 400); });
        act(() => { pointer(window, 'pointermove', 400 + dx); });
        await act(async () => { pointer(window, 'pointerup', 400 + dx); await Promise.resolve(); });
    }
    beforeEach(() => {
        Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
        Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => undefined });
        Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
        container = document.createElement('div'); document.body.append(container); root = createRoot(container); writes = [];
    });
    afterEach(() => {
        act(() => { root.unmount(); }); container.remove();
        Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); vi.restoreAllMocks();
    });
    it('moves a task, preserves its duration and propagates dates into the table, including hidden successors', async () => {
        act(() => { root.render(<Harness visibleIds={['a']} />); });
        await drag('[data-timeline-task="a"] [role="button"]', 2);
        expect(writes.map(write => write.id)).toEqual(['a', 'b', 'c']);
        expect(find('[data-table-record="a"]').textContent).toContain('2026-01-042026-01-06');
        expect(find('[data-table-record="b"]').textContent).toContain('2026-01-062026-01-07');
        expect(find('[data-table-record="c"]').textContent).toContain('2026-01-072026-01-08');
        expect(find('[data-timeline-row="a"] button[title^="2026-01-04"]').getAttribute('title')).toContain('2026-01-04');
        expect(writes[0]?.patch.metadata).not.toHaveProperty('body');
    });
    it.each(['end', 'start'] as const)('resizes the %s boundary and updates the shared table', async edge => {
        act(() => { root.render(<Harness />); });
        await drag(`[data-timeline-task="a"] button[aria-label="Adjust ${edge}"]`, 1);
        expect(find('[data-table-record="a"]').textContent).toContain(edge === 'end' ? '2026-01-022026-01-05' : '2026-01-032026-01-04');
    });
    it('creates a predecessor by dragging the connection point to another task, saves it with dates, and supports undo', async () => {
        act(() => { root.render(<Harness notes={initial.map(note => ({ ...note, metadata: { ...note.metadata, predecessor_ids: [] } }))} />); });
        await drag('[data-timeline-task="c"] button[aria-label="Drag to connect a successor"]', 2, find('[data-timeline-task="a"]'));
        expect(writes[0]?.patch.metadata).toMatchObject({ predecessor_ids: ['c'], Start: '2026-01-06', End: '2026-01-08', body: 'preserve' });
        expect(find('[data-table-record="a"]').textContent).toContain('["c"]');
        await act(async () => { find('button[aria-label="Undo timeline change"]').click(); await Promise.resolve(); });
        expect(find('[data-table-record="a"]').textContent).toBe('2026-01-022026-01-04[]');
    });
    it('rejects a cyclic drag connection without writing records', async () => {
        act(() => { root.render(<Harness />); });
        await drag('[data-timeline-task="c"] button[aria-label="Drag to connect a successor"]', 2, find('[data-timeline-task="a"]'));
        expect(writes).toHaveLength(0);
    });
    it('cancels a drag with Escape without saving a preview', () => {
        act(() => { root.render(<Harness />); });
        const bar = find('[data-timeline-task="a"] [role="button"]');
        act(() => { pointer(bar, 'pointerdown', 400); });
        act(() => { pointer(window, 'pointermove', 450); });
        act(() => { dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'Escape' })); pointer(window, 'pointerup', 450); });
        expect(writes).toHaveLength(0);
    });
    it('keeps undated records visible and renders equal boundaries as milestones', () => {
        act(() => { root.render(<Harness notes={[...initial,
            { id: 'undated', title: 'Plan', last_modified: '2040-01-01', metadata: {} },
            { id: 'milestone', title: 'Delivery', metadata: { Start: '2026-01-10', End: '2026-01-10' } },
        ]} />); });
        expect(find('[data-timeline-row="undated"]').textContent).toContain('No dates');
        expect(container.querySelector('[data-timeline-task="undated"]')).toBeNull();
        expect(find('[data-timeline-task="milestone"]').style.width).toBe('0px');
        expect(container.textContent).not.toContain('2040');
    });
    it('keeps the footer outside vertical rows and synchronizes the persistent horizontal scrollbar', () => {
        act(() => { root.render(<Harness />); });
        const body = find('.custom-scrollbar');
        const footer = find('[data-timeline-footer]');
        const horizontal = find('[data-timeline-horizontal-scroll]');
        expect(body.contains(footer)).toBe(false);
        expect(body.style.overflowX).toBe('hidden');
        act(() => { body.scrollTop = 500; body.scrollLeft = 200; body.dispatchEvent(new Event('scroll', { bubbles: true })); });
        expect(horizontal.scrollLeft).toBe(200);
        act(() => { horizontal.scrollLeft = 80; horizontal.dispatchEvent(new Event('scroll', { bubbles: true })); });
        expect(body.scrollLeft).toBe(80);
        expect(footer.isConnected).toBe(true);
    });

});
