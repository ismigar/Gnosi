import { act, useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { dispatchWindowEvent } from '../shared/platform/browser-events';
import { mountTestComponent } from '../test/mount-react';
import { useKeyboardScroll } from './useKeyboardScroll';
import { useVaultSelectionShortcuts, type VaultSelectionShortcutsOptions } from './useVaultSelectionShortcuts';

interface HarnessProps extends VaultSelectionShortcutsOptions {
  scrollEnabled?: boolean;
  modalOpen?: boolean;
  step?: number;
}

function Harness({ scrollEnabled = false, modalOpen = false, step = 30, ...selection }: HarnessProps) {
  const ref = useRef<HTMLDivElement>(null);
  useKeyboardScroll(ref, { enabled: scrollEnabled, modalOpen, step });
  useVaultSelectionShortcuts({ ...selection, enabled: selection.enabled ?? false });
  return <div ref={ref} tabIndex={0}><input /><textarea /><select><option>One</option></select><div contentEditable suppressContentEditableWarning tabIndex={0}>Editable</div></div>;
}

function key(name: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options });
  act(() => { dispatchWindowEvent(event); });
  return event;
}

function scrollTarget(container: HTMLElement) {
  const target = container.querySelector('div');
  if (!target) throw new Error('Expected scroll container');
  const scrollBy = vi.fn(); const scrollTo = vi.fn();
  Object.defineProperties(target, {
    clientHeight: { value: 100 }, scrollHeight: { value: 500 },
    scrollBy: { value: scrollBy }, scrollTo: { value: scrollTo },
  });
  return { target, scrollBy, scrollTo };
}

describe('native keyboard hook ownership', () => {
  it('preserves all scroll shortcuts, cancellation and configured distances', () => {
    const mounted = mountTestComponent(<Harness scrollEnabled />);
    const { scrollBy, scrollTo } = scrollTarget(mounted.container);
    for (const [name, top, shiftKey] of [
      ['ArrowDown', 30, false], ['ArrowUp', -30, false], ['PageDown', 80, false],
      ['PageUp', -80, false], [' ', 80, false], [' ', -80, true],
    ] as const) {
      expect(key(name, { shiftKey }).defaultPrevented).toBe(true);
      expect(scrollBy).toHaveBeenLastCalledWith({ top, behavior: 'smooth' });
    }
    key('Home'); expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
    key('End'); expect(scrollTo).toHaveBeenLastCalledWith({ top: 500, behavior: 'smooth' });
    expect(key('x').defaultPrevented).toBe(false);
  });

  it('removes scrolling when disabled, while a modal is open and after unmount', () => {
    const mounted = mountTestComponent(<Harness scrollEnabled />);
    const { scrollBy } = scrollTarget(mounted.container);
    key('ArrowDown'); expect(scrollBy).toHaveBeenCalledOnce();
    mounted.render(<Harness scrollEnabled modalOpen />);
    expect(key('ArrowDown').defaultPrevented).toBe(false);
    mounted.render(<Harness scrollEnabled={false} />); key('ArrowDown');
    expect(scrollBy).toHaveBeenCalledOnce();
    mounted.render(<Harness scrollEnabled step={50} />); key('ArrowDown');
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 50, behavior: 'smooth' });
    mounted.unmount(); key('ArrowDown'); expect(scrollBy).toHaveBeenCalledTimes(2);
  });

  it('does not scroll focused text controls, selects or editable content', () => {
    const mounted = mountTestComponent(<Harness scrollEnabled />);
    const { scrollBy } = scrollTarget(mounted.container);
    for (const element of mounted.container.querySelectorAll<HTMLElement>('input, textarea, select, [contenteditable]')) {
      if (element.hasAttribute('contenteditable')) Object.defineProperty(element, 'isContentEditable', { value: true });
      element.focus(); expect(key('ArrowDown').defaultPrevented).toBe(false);
    }
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('preserves selection shortcuts, editable exceptions and fresh callback ownership', () => {
    const selectAll = vi.fn(); const clearSelection = vi.fn(); const onDeleteSelected = vi.fn();
    const mounted = mountTestComponent(<Harness enabled {...{ selectAll, clearSelection, onDeleteSelected }} />);
    expect(key('a', { ctrlKey: true }).defaultPrevented).toBe(true);
    key('a', { metaKey: true }); expect(selectAll).toHaveBeenCalledTimes(2);
    key('Delete'); key('Backspace'); expect(onDeleteSelected).toHaveBeenCalledTimes(2);
    const input = mounted.container.querySelector('input'); input?.focus();
    expect(key('a', { ctrlKey: true }).defaultPrevented).toBe(false);
    key('Delete'); key('Escape');
    expect(onDeleteSelected).toHaveBeenCalledTimes(2); expect(clearSelection).toHaveBeenCalledOnce();
    input?.blur(); const nextSelectAll = vi.fn();
    mounted.render(<Harness enabled selectAll={nextSelectAll} />);
    key('a', { ctrlKey: true }); expect(nextSelectAll).toHaveBeenCalledOnce(); expect(selectAll).toHaveBeenCalledTimes(2);
    mounted.render(<Harness enabled={false} selectAll={nextSelectAll} />);
    key('a', { ctrlKey: true }); expect(nextSelectAll).toHaveBeenCalledOnce();
    mounted.unmount(); key('a', { ctrlKey: true }); expect(nextSelectAll).toHaveBeenCalledOnce();
  });
});
