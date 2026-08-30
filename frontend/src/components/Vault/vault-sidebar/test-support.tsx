import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import { VaultSidebar } from '../VaultSidebar';
import { defineStorageKey, removeStorage, stringStorageCodec } from '../../../shared/platform/browser-storage';
import type { VaultSidebarProps } from './types';

let root: Root | undefined;
export const fixtureRole = { value: 'admin' };
export function resetPreferences() {
    for (const name of ['gnosi.sidebar.sections.desktop', 'gnosi.sidebar.sections.mobile', 'gnosi.sidebar.wikiDragLocked', 'gnosi.sidebar.favoritesSort']) {
        removeStorage(defineStorageKey(name, stringStorageCodec));
    }
}
export const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); }); };
export async function cleanup() {
    await act(async () => { root?.unmount(); await Promise.resolve(); });
    root = undefined;
    document.body.replaceChildren();
    resetPreferences();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
}
export async function renderSidebar(overrides: Partial<VaultSidebarProps> = {}) {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const props = {
        onPageSelect: vi.fn<(id: string) => void>(),
        onCreatePage: vi.fn<(id: string | null) => void>(),
        onNavigate: vi.fn<(view: string) => void>(),
        onDeleteTable: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
        onRenameTable: vi.fn<(id: string, name: string) => Promise<void>>().mockResolvedValue(undefined),
        onDeleteDatabase: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
        onRenameDatabase: vi.fn<(id: string, name: string) => Promise<void>>().mockResolvedValue(undefined),
        onRenamePage: vi.fn<(id: string, name: string) => void>(),
        onToggleFavorite: vi.fn<(id: string) => void>(),
        onOpenParallel: vi.fn<(id: string) => void>(),
        onMovePage: vi.fn<(id: string, target: string) => void>(),
        ...overrides,
    } satisfies VaultSidebarProps;
    await act(async () => { root?.render(<VaultSidebar {...props} />); await Promise.resolve(); });
    await settle();
    return { props, container };
}
export function button(text: string, scope: ParentNode = document): HTMLButtonElement {
    const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent.trim() === text || element.getAttribute('aria-label') === text || element.title === text);
    if (!found) throw new Error(`Missing button: ${text}`);
    return found;
}
export const click = async (element: HTMLElement) => { await act(async () => { element.click(); await Promise.resolve(); }); await settle(); };
export async function inputValue(input: HTMLInputElement, value: string) {
    await act(async () => { await Promise.resolve();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
export function pageRow(id: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(`[data-vault-page-id="${id}"]`);
    if (!element) throw new Error(`Missing row: ${id}`);
    return element;
}
