import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { vi } from 'vitest';

// Resolve a filesystem path: Vite rewrites static new URL asset expressions.
const popupPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../extensions/web-clipper/popup.js');
const source = fs.readFileSync(popupPath, 'utf8');
type Tab = { id: number; url: string; title: string };

export function stubChrome(store: Record<string, string | undefined> = {}, { tab, selection = '' }: { tab?: Tab; selection?: string } = {}) {
  return {
    storage: { local: {
      get: vi.fn((keys: string[]) => Promise.resolve(Object.fromEntries(keys.map(key => [key, store[key]])))),
      set: vi.fn((patch: Record<string, string>) => Promise.resolve(Object.assign(store, patch))),
    } },
    tabs: { query: vi.fn(() => Promise.resolve([tab ?? { id: 7, url: 'https://example.org/a', title: 'A page' }])) },
    scripting: { executeScript: vi.fn(() => Promise.resolve([{ result: selection }])) },
  };
}

export function mountPopup(): void {
  document.body.innerHTML = `<input id="backend" /><input id="token" />
    <div id="target"></div><textarea id="note"></textarea><input id="tags" />
    <div id="fields"></div><div id="status"></div><button id="save"></button>
    <button id="clip"></button><button id="clipSelection"></button>`;
}

export function loadPopup(chrome: ReturnType<typeof stubChrome>) {
  const context: Record<string, unknown> = { window, document, chrome, fetch: globalThis.fetch, console };
  context.globalThis = context;
  const listeners: Parameters<Document['addEventListener']>[] = [];
  const dispose = (): void => {
    for (const args of listeners) document.removeEventListener(...args);
    listeners.length = 0;
  };
  const add = document.addEventListener.bind(document);
  const listenerSpy = vi.spyOn(document, 'addEventListener').mockImplementation((...args) => {
    if (args[0] === 'DOMContentLoaded') listeners.push(args);
    add(...args);
  });
  try {
    vm.createContext(context);
    vm.runInContext(source, context, { filename: popupPath });
  } catch (error) {
    dispose();
    throw error;
  } finally {
    listenerSpy.mockRestore();
  }
  const invoke = async (name: string, args: readonly unknown[] = []): Promise<void> => {
    const callback = context[name];
    if (typeof callback !== 'function') throw new Error(`Missing popup function: ${name}`);
    const result: unknown = Reflect.apply(callback, context, args);
    await result;
  };
  return {
    loadConfig: () => invoke('loadConfig'),
    saveConfig: () => invoke('saveConfig'),
    loadClipSchema: () => invoke('loadClipSchema'),
    clip: (onlySelection: boolean) => invoke('clip', [onlySelection]),
    dispose,
  };
}
