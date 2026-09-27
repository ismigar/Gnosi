import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {AddMemberDialog} from './AddMemberDialog';
import {useDashboardKeyboard} from './useDashboardKeyboard';
import type {DashboardState} from './useDashboard';
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
test('Dashboard Cancel and role select never add a member; email Enter adds once', () => {
 const add = vi.fn(), close = vi.fn();
 const state = {isAddMemberModalOpen: true, newMemberEmail: 'test@example.invalid', newMemberRole: 'viewer', handleAddMember: add, setIsAddMemberModalOpen: close, setNewMemberEmail: vi.fn(), setNewMemberRole: vi.fn(), scrollContainerRef: {current: null}, t: (key: string) => key} as unknown as DashboardState;
 function Dashboard() { useDashboardKeyboard(state); return <AddMemberDialog state={state}/>; }
 act(() => { root.render(<Dashboard/>); });
 activate(required(host.querySelector('button')), 'Enter'); expect(close).toHaveBeenCalledWith(false); expect(add).not.toHaveBeenCalled();
 const select = required(host.querySelector('select')); select.focus(); press(select, 'Enter'); expect(add).not.toHaveBeenCalled(); expect(select.labels).toHaveLength(1);
 const input = required(host.querySelector('input')); input.focus(); press(input, 'Enter'); expect(add).toHaveBeenCalledOnce();
});
