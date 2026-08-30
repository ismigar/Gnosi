import { StrictMode, act, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../tests/mount-react';
import { createTableVirtualizerStore } from './tableVirtualizerStore';
import { useTableVirtualizer } from './useTableVirtualizer';

const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(168);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(700);
});
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function mountStore(count = 80) {
  const viewport = document.createElement('div');
  document.body.appendChild(viewport);
  const options = { count, estimateSize: () => 56, getScrollElement: () => viewport };
  const store = createTableVirtualizerStore(options);
  const detach = store.mount();
  store.update(options);
  cleanups.push(() => { detach(); viewport.remove(); });
  return { store, viewport, options, detach };
}
function scroll(viewport: HTMLElement, top: number) {
  act(() => { viewport.scrollTop = top; viewport.dispatchEvent(new Event('scroll')); });
}

describe('table virtualizer snapshots with the real TanStack engine', () => {
  it('caches snapshot identity until geometry changes, keeping the original overscan', () => {
    const { store, options } = mountStore();
    const initial = store.getSnapshot();
    expect(initial.totalSize).toBe(80 * 56);
    expect(initial.virtualRows.map(row => row.index)).toEqual(Array.from({ length: 11 }, (_, index) => index));
    store.update({ ...options });
    expect(store.getSnapshot()).toBe(initial);
  });

  it('publishes scroll updates without mutating previous snapshots and cleans up subscriptions', () => {
    const { store, viewport, detach } = mountStore();
    const initial = store.getSnapshot();
    const notify = vi.fn();
    const unsubscribe = store.subscribe(notify);
    cleanups.push(unsubscribe);
    scroll(viewport, 30 * 56);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().virtualRows[0]?.index).toBe(22);
    expect(initial.virtualRows[0]?.index).toBe(0);
    detach();
    notify.mockClear();
    scroll(viewport, 40 * 56);
    expect(notify).not.toHaveBeenCalled();
  });

  it('resets empty input and restores rows without replacing commands', () => {
    const { store, options } = mountStore();
    const commands = store.commands;
    store.update({ ...options, count: 0 });
    expect(store.getSnapshot()).toEqual({ virtualRows: [], totalSize: 0 });
    store.update({ ...options, count: 4 });
    expect(store.getSnapshot().virtualRows).toHaveLength(4);
    expect(store.getSnapshot().totalSize).toBe(224);
    expect(store.commands).toBe(commands);
  });

  it('keeps dynamic row measurements and the 56px zero-height fallback', () => {
    const { store, viewport } = mountStore();
    const row = document.createElement('tr');
    row.dataset.index = '0';
    viewport.appendChild(row);
    const initial = store.getSnapshot();
    const rect = vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 700, 90));
    store.commands.measureElement(row);
    expect(store.getSnapshot().totalSize).toBe(initial.totalSize + 34);
    expect(initial.virtualRows[0]?.size).toBe(56);
    expect(store.getSnapshot().virtualRows[0]?.size).toBe(90);
    rect.mockReturnValue(new DOMRect());
    store.commands.measureElement(row);
    expect(store.getSnapshot().virtualRows[0]?.size).toBe(56);
  });

  it('preserves DOM input, focus, cursor and row selection across scroll/count resets in StrictMode', () => {
    function Probe({ count }: { count: number }) {
      const viewport = useRef<HTMLDivElement | null>(null);
      const [draft, setDraft] = useState('');
      const [selected, setSelected] = useState<Set<number>>(() => new Set());
      const { virtualRows, rowVirtualizer } = useTableVirtualizer({ count, estimateSize: () => 56, getScrollElement: () => viewport.current });
      return <div ref={viewport} data-viewport>
        <table><tbody>{virtualRows.map(row => <tr key={row.key} data-index={row.index} ref={rowVirtualizer.measureElement}>
          <td><input type="checkbox" data-row={row.index} checked={selected.has(row.index)} onChange={() => { setSelected(previous => new Set(previous).add(row.index)); }} /></td>
        </tr>)}</tbody></table>
        <input aria-label="Draft" value={draft} onChange={event => { setDraft(event.currentTarget.value); }} />
      </div>;
    }
    const mounted = mountTestComponent(<StrictMode><Probe count={80} /></StrictMode>);
    const viewport = mounted.container.querySelector<HTMLElement>('[data-viewport]');
    const input = mounted.container.querySelector<HTMLInputElement>('[aria-label="Draft"]');
    const checkbox = mounted.container.querySelector<HTMLInputElement>('[data-row="0"]');
    if (!viewport || !input || !checkbox) throw new Error('Virtualized fixture did not mount');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('Missing native input setter');
    act(() => { checkbox.click(); descriptor.set?.call(input, 'Unsent draft'); input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); input.setSelectionRange(2, 5); });
    scroll(viewport, 30 * 56);
    expect(mounted.container.querySelector('[data-row="0"]')).toBeNull();
    mounted.render(<StrictMode><Probe count={0} /></StrictMode>);
    expect(mounted.container.querySelectorAll('tr')).toHaveLength(0);
    mounted.render(<StrictMode><Probe count={80} /></StrictMode>);
    scroll(viewport, 0);
    expect(mounted.container.querySelector('[aria-label="Draft"]')).toBe(input);
    expect(input.value).toBe('Unsent draft');
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
    expect(mounted.container.querySelector<HTMLInputElement>('[data-row="0"]')?.checked).toBe(true);
  });
});
