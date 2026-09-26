import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {ConfirmDialog} from './ConfirmDialog';
import {ViewNamePromptModal} from './ViewNamePromptModal';
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
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
function activate(button: HTMLButtonElement, key: string) {
 button.focus();
 // jsdom does not synthesize the native click from a keyboard event.
 if (!press(button, key).defaultPrevented) act(() => { button.click(); });
}
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error('Missing test control'); return value; }
test('Media Cancel never confirms; confirmation executes once and focus returns', () => {
 const cancel = vi.fn(), confirm = vi.fn();
 const opener = document.createElement('button'); document.body.append(opener); opener.focus();
 act(() => { root.render(<ConfirmDialog open danger title="Delete" onCancel={cancel} onConfirm={confirm}/>); });
 const [a,b] = host.querySelectorAll('button'); expect(document.activeElement).toBe(a);
 activate(required(a), 'Enter'); activate(required(a), ' '); expect(cancel).toHaveBeenCalledTimes(2); expect(confirm).not.toHaveBeenCalled();
 activate(required(b), 'Enter'); expect(confirm).toHaveBeenCalledOnce();
 expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBeTruthy();
 act(() => { root.render(null); }); expect(document.activeElement).toBe(opener); opener.remove();
});
test('View name respects Cancel, input Enter, composition and empty values', () => {
 const cancel = vi.fn(), confirm = vi.fn();
 act(() => { root.render(<ViewNamePromptModal open defaultValue="Synthetic" onCancel={cancel} onConfirm={confirm}/>); });
 activate(required(host.querySelector('button')), 'Enter'); expect(cancel).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
 const input = required(host.querySelector('input')); input.focus();
 press(input, 'Enter', {isComposing: true}); press(input, 'Enter', {ctrlKey: true}); expect(confirm).not.toHaveBeenCalled();
 press(input, 'Enter'); expect(confirm).toHaveBeenCalledExactlyOnceWith('Synthetic');
 act(() => { root.render(null); });
 act(() => { root.render(<ViewNamePromptModal open defaultValue=" " onCancel={cancel} onConfirm={confirm}/>); });
 press(required(host.querySelector('input')), 'Enter'); expect(confirm).toHaveBeenCalledOnce();
});
