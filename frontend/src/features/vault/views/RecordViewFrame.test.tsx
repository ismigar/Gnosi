import { act, createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../tests/mount-react';
import { RecordViewFrame } from './RecordViewFrame';
import type { TableNavApi } from './vault-table/types';
const records = [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }];
const key = (element: Element, value: string) => { act(() => { element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); }); };
const element = (container: HTMLElement, selector: string): HTMLElement => { const found = container.querySelector<HTMLElement>(selector); if (!found) throw new Error(selector); return found; };
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
HTMLElement.prototype.scrollIntoView = vi.fn();
afterEach(() => { vi.restoreAllMocks(); });
it('enters records, moves, opens and exits without taking keys from text editors', () => {
  const open = vi.fn(); const exit = vi.fn();
  const view = mountTestComponent(<RecordViewFrame records={records} navigation={createRef<TableNavApi>()} onOpen={open} onExit={exit}>
    <div tabIndex={-1} data-record-id="a">Alpha<input /></div><div tabIndex={-1} data-record-id="b">Beta</div>
  </RecordViewFrame>);
  const shell = element(view.container, '[data-record-view-shell]');
  const a = element(view.container, '[data-record-id="a"]');
  const b = element(view.container, '[data-record-id="b"]');
  shell.focus(); key(shell, 'Enter'); expect(document.activeElement).toBe(a);
  key(a, 'ArrowDown'); expect(document.activeElement).toBe(b);
  key(b, 'Enter'); expect(open).toHaveBeenCalledExactlyOnceWith('b');
  key(b, 'Escape'); expect(document.activeElement).toBe(shell); expect(exit).toHaveBeenCalledOnce();
  const input = element(view.container, 'input'); input.focus(); key(input, 'Escape');
  expect(document.activeElement).toBe(input); expect(exit).toHaveBeenCalledOnce();
  view.unmount();
});
it('delegates entry to a virtualized table and leaves its Escape untouched', () => {
  const first = vi.fn(() => true);
  const navigation = { current: { focusFirstCell: first, focusLastCell: () => true } };
  const view = mountTestComponent(<RecordViewFrame records={records} navigation={navigation}><div data-vault-table-scroll tabIndex={-1} /></RecordViewFrame>);
  key(element(view.container, '[data-record-view-shell]'), 'Enter'); expect(first).toHaveBeenCalledOnce();
  const table = element(view.container, '[data-vault-table-scroll]'); table.focus(); key(table, 'Escape');
  expect(document.activeElement).toBe(table); view.unmount();
});
it('supports records in visualizations without mounted record elements', () => {
  const open = vi.fn(); const register = vi.fn();
  const view = mountTestComponent(<RecordViewFrame records={records} navigation={createRef<TableNavApi>()} registerNavApi={register} onOpen={open}><div /></RecordViewFrame>);
  const shell = element(view.container, '[data-record-view-shell]');
  key(shell, 'Enter'); expect(view.container.textContent).toContain('Alpha');
  key(shell, 'ArrowRight'); key(shell, 'Enter'); expect(open).toHaveBeenCalledWith('b');
  key(shell, 'Escape'); expect(view.container.querySelector('[role="status"]')).toBeNull();
  expect(register.mock.lastCall?.[0]).toHaveProperty('focusFirstCell');
  view.unmount(); expect(register).toHaveBeenLastCalledWith(null);
});
