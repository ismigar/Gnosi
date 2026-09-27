import {act, useRef} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {useModalKeyboard} from './useModalKeyboard';
import {useKeyboardScroll} from './useKeyboardScroll';
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
 (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
 host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => { root.unmount(); }); host.remove(); vi.unstubAllGlobals(); });
function press(element: Element, key: string, options: KeyboardEventInit = {}) {
 const event = new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true, ...options});
 act(() => { element.dispatchEvent(event); }); return event;
}
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error('Missing test control'); return value; }
function Layers({child = true}: {child?: boolean}) {
 const parentRef = useRef<HTMLDivElement>(null), childRef = useRef<HTMLDivElement>(null);
 useModalKeyboard({isOpen: true, onClose: () => {}, containerRef: parentRef, trapFocus: true});
 useModalKeyboard({isOpen: child, onClose: () => {}, containerRef: childRef, trapFocus: true});
 return <><div ref={parentRef}><button>P1</button><button>P2</button></div>{child && <div ref={childRef}><button tabIndex={-1}>Excluded</button><button>C1</button><button>C2</button><button>C3</button></div>}</>;
}
test('Top modal owns Tab, excludes tabindex=-1 and restores parent focus', () => {
 act(() => { root.render(<Layers child={false}/>); }); required(host.querySelectorAll('button')[1]).focus();
 act(() => { root.render(<Layers/>); }); const buttons = host.querySelectorAll('button');
 expect(document.activeElement).toBe(buttons[3]); expect(press(required(buttons[3]), 'Tab').defaultPrevented).toBe(false);
 required(buttons[5]).focus(); press(required(buttons[5]), 'Tab'); expect(document.activeElement).toBe(buttons[3]);
 press(required(buttons[3]), 'Tab', {shiftKey: true}); expect(document.activeElement).toBe(buttons[5]);
 act(() => { root.render(<Layers child={false}/>); }); expect(document.activeElement).toBe(buttons[1]);
});
test('Background modal cannot confirm Enter intended for its child', () => {
 const parent = vi.fn(), child = vi.fn();
 function Dialogs() {
  const p = useRef<HTMLDivElement>(null), c = useRef<HTMLDivElement>(null);
  useModalKeyboard({isOpen: true, onClose: () => {}, onConfirm: parent, containerRef: p, trapFocus: true});
  useModalKeyboard({isOpen: true, onClose: () => {}, onConfirm: child, containerRef: c, trapFocus: true});
  return <div ref={p}><input/><div ref={c}><input data-testid="child"/></div></div>;
 }
 act(() => { root.render(<Dialogs/>); });
 const input = host.querySelector('[data-testid="child"]') as HTMLInputElement; input.focus(); press(input, 'Enter');
 expect(child).toHaveBeenCalledOnce(); expect(parent).not.toHaveBeenCalled();
});
test('Scroll respects focus, activation, composites, modifiers and reduced motion', () => {
 function Panel() {const ref = useRef<HTMLDivElement>(null); useKeyboardScroll(ref); return <><div ref={ref} tabIndex={0}><button>Inside</button><div role="tablist"><button>Tab</button></div></div><button>Outside</button></>;}
 act(() => { root.render(<Panel/>); });
 const panel = host.firstElementChild as HTMLElement, scroll = vi.fn(); panel.scrollBy = scroll;
 const [inside,tab,outside] = host.querySelectorAll('button');
 required(outside).focus(); press(required(outside), 'ArrowDown'); expect(scroll).not.toHaveBeenCalled();
 required(inside).focus(); expect(press(required(inside), ' ').defaultPrevented).toBe(false); expect(scroll).not.toHaveBeenCalled();
 required(tab).focus(); press(required(tab), 'ArrowDown'); expect(scroll).not.toHaveBeenCalled();
 panel.focus(); press(panel, 'ArrowDown', {ctrlKey: true}); expect(scroll).not.toHaveBeenCalled();
 vi.stubGlobal('matchMedia', () => ({matches: true})); press(panel, 'ArrowDown'); expect(scroll).toHaveBeenCalledExactlyOnceWith({top: 80, behavior: 'auto'});
 const handled = new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true, cancelable: true}); handled.preventDefault(); panel.dispatchEvent(handled); expect(scroll).toHaveBeenCalledOnce();
});
