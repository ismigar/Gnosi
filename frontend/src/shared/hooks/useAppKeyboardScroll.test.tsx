import { act, useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import { useAppKeyboardScroll } from './useAppKeyboardScroll';
import { pushModalLayer } from './useModalKeyboard';
import { useKeyboardScroll } from './useKeyboardScroll';
import { subscribeWindowEvent } from '../platform/browser-events';
import { getGraphKeyboardAction } from '../graph/model/graphKeyboardNavigation';

function Pane({ children, legacy }: { children: ReactNode; legacy: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useKeyboardScroll(ref, { enabled: legacy });
  return <section ref={ref} data-region="page" style={{ overflowY: 'auto' }}>{children}</section>;
}
function Screen({ route = 'one', legacy = false, children }: { route?: string; legacy?: boolean; children?: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useAppKeyboardScroll(ref, route);
  return <main ref={ref} tabIndex={-1}><Pane legacy={legacy}><h1>Page</h1><button>Action</button><input /><textarea /><div contentEditable tabIndex={0} /><div role="tablist"><button>Tab</button></div><div data-region="nested" style={{ overflowY: 'auto' }}><button>Nested action</button></div>{children}</Pane></main>;
}

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing test region');
  return value;
}
function region(container: HTMLElement, name = 'page') {
  const element = required(container.querySelector<HTMLElement>(`[data-region="${name}"]`));
  const scrollBy = vi.fn(), scrollTo = vi.fn();
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: 200 }, scrollHeight: { configurable: true, value: 1000 }, clientWidth: { configurable: true, value: name === 'page' ? 800 : 300 },
    scrollBy: { configurable: true, value: scrollBy }, scrollTo: { configurable: true, value: scrollTo },
    getBoundingClientRect: { configurable: true, value: () => ({ top: 0, left: 0, bottom: 200, right: 800 }) },
  });
  return { element, scrollBy, scrollTo };
}
function key(target: Element, name: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options });
  act(() => { target.dispatchEvent(event); });
  return event;
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test('outside fields, page keys scroll the nested app page after a click without moving focus', () => {
  const view = mountTestComponent(<Screen />);
  const page = region(view.container);
  const heading = required(view.container.querySelector('h1'));
  act(() => { heading.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
  const active = document.activeElement;
  for (const [name, top] of [['ArrowDown', 80], ['ArrowUp', -80], ['PageDown', 160], ['PageUp', -160], [' ', 160]] as const) {
    expect(key(document.body, name).defaultPrevented).toBe(true);
    expect(page.scrollBy).toHaveBeenLastCalledWith({ top, behavior: 'smooth' });
  }
  key(document.body, 'Home'); expect(page.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
  key(document.body, 'End'); expect(page.scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: 'smooth' });
  expect(document.activeElement).toBe(active);
  view.unmount();
});

test('keyboard-only page entry chooses the visible page and honors reduced motion', () => {
  const view = mountTestComponent(<Screen />);
  const page = region(view.container); region(view.container, 'nested');
  required(view.container.querySelector('main')).focus();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  key(document.activeElement ?? document.body, 'PageDown');
  expect(page.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 160, behavior: 'auto' });
  view.unmount();
});

test('a focused nested panel owns scrolling, and buttons retain activation', () => {
  const view = mountTestComponent(<Screen />);
  const page = region(view.container), nested = region(view.container, 'nested');
  const button = required(nested.element.querySelector('button')); button.focus();
  key(button, 'ArrowDown'); expect(nested.scrollBy).toHaveBeenCalledOnce(); expect(page.scrollBy).not.toHaveBeenCalled();
  expect(key(button, ' ').defaultPrevented).toBe(false);
  expect(key(button, 'Enter').defaultPrevented).toBe(false);
  view.unmount();
});

test('editing, composite navigation, modified keys and already handled events keep their owners', () => {
  const view = mountTestComponent(<Screen />); const page = region(view.container);
  for (const control of view.container.querySelectorAll<HTMLElement>('input,textarea,[contenteditable],[role="tablist"] button')) {
    control.focus(); expect(key(control, 'ArrowDown').defaultPrevented).toBe(false);
  }
  const button = required(page.element.querySelector('button')); button.focus();
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) expect(key(button, 'PageDown', options).defaultPrevented).toBe(false);
  const event = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }); event.preventDefault(); button.dispatchEvent(event);
  expect(page.scrollBy).not.toHaveBeenCalled(); view.unmount();
});

test('modal ownership blocks background scrolling and hidden regions are not candidates', () => {
  const view = mountTestComponent(<Screen />); const page = region(view.container);
  const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); document.body.append(modal);
  const layer = pushModalLayer({ current: modal });
  const button = required(page.element.querySelector('button')); button.focus();
  expect(key(button, 'PageDown').defaultPrevented).toBe(false); expect(page.scrollBy).not.toHaveBeenCalled();
  layer.release(); modal.remove(); page.element.hidden = true;
  required(view.container.querySelector('main')).focus();
  expect(key(document.activeElement ?? document.body, 'PageDown').defaultPrevented).toBe(false);
  view.unmount();
});

test('a dialog without a vertical scroller never scrolls its background ancestor', () => {
  const view = mountTestComponent(<Screen />); const page = region(view.container);
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
  const button = document.createElement('button'); dialog.append(button); page.element.append(dialog); button.focus();
  expect(key(button, 'PageDown').defaultPrevented).toBe(false);
  expect(page.scrollBy).not.toHaveBeenCalled(); view.unmount();
});

test('route changes discard stale pointer ownership and unmount removes global handlers', () => {
  const view = mountTestComponent(<Screen />); const page = region(view.container), nested = region(view.container, 'nested');
  act(() => { nested.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
  view.render(<Screen route="two" />); required(view.container.querySelector('main')).focus();
  key(document.activeElement ?? document.body, 'PageDown'); expect(page.scrollBy).toHaveBeenCalledOnce(); expect(nested.scrollBy).not.toHaveBeenCalled();
  view.unmount(); expect(key(document.body, 'PageDown').defaultPrevented).toBe(false);
});

test('explicit main focus takes precedence over an earlier click on the skip link', () => {
  const view = mountTestComponent(<Screen />); const page = region(view.container);
  const skip = document.createElement('a'); skip.href = '#content'; document.body.append(skip);
  act(() => { skip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
  required(view.container.querySelector('main')).focus();
  key(document.activeElement ?? document.body, 'PageDown');
  expect(page.scrollBy).toHaveBeenCalledOnce(); skip.remove(); view.unmount();
});

test.each(['inert', 'hidden', 'display', 'visibility'])('stale pointer inside a now %s pane cannot scroll its outer page', mode => {
  const view = mountTestComponent(<Screen />); const page = region(view.container), nested = region(view.container, 'nested');
  act(() => { nested.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
  if (mode === 'display') nested.element.style.display = 'none';
  else if (mode === 'visibility') nested.element.style.visibility = 'hidden';
  else nested.element.setAttribute(mode, '');
  expect(key(document.body, 'PageDown').defaultPrevented).toBe(false);
  expect(page.scrollBy).not.toHaveBeenCalled(); expect(nested.scrollBy).not.toHaveBeenCalled(); view.unmount();
});

test.each([true, false])('existing pane scroll handlers and the global handler agree on nested ownership (initial legacy=%s)', initial => {
  const view = mountTestComponent(<Screen legacy={initial} />); const page = region(view.container), nested = region(view.container, 'nested');
  const button = required(nested.element.querySelector('button')); button.focus();
  key(button, 'PageDown'); expect(nested.scrollBy).toHaveBeenCalledTimes(1); expect(page.scrollBy).not.toHaveBeenCalled();
  view.render(<Screen legacy route="two" />); button.focus();
  key(button, 'PageDown'); expect(nested.scrollBy).toHaveBeenCalledTimes(2); expect(page.scrollBy).not.toHaveBeenCalled();
  view.unmount();
});

test('late-mounted active table navigation keeps arrows and Space instead of scrolling', () => {
  const view = mountTestComponent(<Screen legacy />); const page = region(view.container);
  const table = document.createElement('section'); table.tabIndex = 0; table.dataset.region = 'custom'; table.style.overflowY = 'auto'; page.element.append(table);
  const custom = region(view.container, 'custom'); const navigate = vi.fn();
  let selected = true;
  const stop = subscribeWindowEvent('keydown', event => {
    if (!event.defaultPrevented && event.target === table && selected) { event.preventDefault(); navigate(event.key); }
  });
  table.focus(); key(table, 'ArrowDown'); key(table, ' ');
  expect(navigate.mock.calls).toEqual([['ArrowDown'], [' ']]);
  expect(custom.scrollBy).not.toHaveBeenCalled(); expect(page.scrollBy).not.toHaveBeenCalled();
  selected = false; key(table, 'ArrowDown');
  expect(custom.scrollBy).toHaveBeenCalledOnce(); expect(navigate).toHaveBeenCalledTimes(2);
  stop(); view.unmount();
});

test('deliberate main entry can scroll a table while its remembered cell selection remains intact', () => {
  const view = mountTestComponent(<Screen />); const page = region(view.container), nested = region(view.container, 'nested');
  Object.defineProperty(page.element, 'scrollHeight', { value: 200 }); Object.defineProperty(nested.element, 'scrollHeight', { value: 200 });
  Object.defineProperty(nested.element, 'scrollHeight', { value: 1000 });
  let selectedRow = 'one';
  const stop = subscribeWindowEvent('keydown', event => { if (event.target instanceof Node && nested.element.contains(event.target)) { event.preventDefault(); selectedRow = 'two'; } });
  required(view.container.querySelector('main')).focus(); key(document.activeElement ?? document.body, 'ArrowDown');
  expect(nested.scrollBy).toHaveBeenCalledOnce(); expect(selectedRow).toBe('one'); stop(); view.unmount();
});

test('main and body entry do not steal graph arrows by selecting its filter sidebar', () => {
  const view = mountTestComponent(<Screen />); const page = region(view.container), nested = region(view.container, 'nested');
  Object.defineProperty(page.element, 'scrollHeight', { value: 200 }); Object.defineProperty(nested.element, 'scrollHeight', { value: 200 });
  const aside = document.createElement('aside'); aside.dataset.region = 'filters'; aside.style.overflowY = 'auto'; page.element.append(aside);
  const connections = document.createElement('div'); connections.dataset.region = 'connections'; connections.style.overflowY = 'auto'; page.element.append(connections);
  const filters = region(view.container, 'filters'), bottom = region(view.container, 'connections'), pan = vi.fn();
  const stop = subscribeWindowEvent('keydown', event => { const action = getGraphKeyboardAction(event); if (action) { event.preventDefault(); pan(action); } });
  key(document.body, 'ArrowDown'); required(view.container.querySelector('main')).focus(); key(document.activeElement ?? document.body, 'ArrowDown');
  expect(pan.mock.calls).toEqual([['pan-down'], ['pan-down']]); expect(filters.scrollBy).not.toHaveBeenCalled(); expect(bottom.scrollBy).not.toHaveBeenCalled();
  stop(); view.unmount();
});
