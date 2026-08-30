import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { vi } from 'vitest';
import { installFetch, jsonResponse, requestUrl } from './network';

// Resolve disk paths explicitly: Vite can rewrite new URL asset expressions.
// This helper lives one directory deeper than the suite; keep the real assets.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/word-addin');
const source = fs.readFileSync(path.join(root, 'taskpane.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
type Ready = (info: { host: string | null }) => void;
type SaveCallback = (result: { status: string }) => void;
interface Settings {
  get(key: string): unknown;
  set(key: string, value: boolean): void;
  saveAsync(callback: SaveCallback): void;
}

export function officeSettings(tagged?: boolean) {
  return {
    get: vi.fn<Settings['get']>(() => tagged),
    set: vi.fn<Settings['set']>(),
    saveAsync: vi.fn((callback: SaveCallback) => { callback({ status: 'succeeded' }); }),
  } satisfies Settings;
}

export function mountWord(): void {
  const body = html.replace(/[\s\S]*<body[^>]*>/i, '').replace(/<\/body>[\s\S]*/i, '');
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');
}

export function stubOffice({ host = 'Word', settings = officeSettings() }: { host?: string | null; settings?: Settings } = {}) {
  let ready: Ready | undefined;
  return {
    api: {
      onReady: vi.fn((callback: Ready) => { ready = callback; }),
      AsyncResultStatus: { Succeeded: 'succeeded' },
      context: { document: { settings } },
    },
    initialize: () => {
      if (!ready) throw new Error('The Word task pane did not register Office.onReady');
      ready({ host });
    },
  };
}

export async function boot(office: ReturnType<typeof stubOffice>): Promise<void> {
  const context: Record<string, unknown> = {
    window, document, console, Office: office.api,
    Word: { run: vi.fn(() => Promise.reject(new Error('Unexpected real Word operation'))) },
    localStorage: window.localStorage, fetch: globalThis.fetch,
    URL, setTimeout, clearTimeout,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: path.join(root, 'taskpane.js') });
  office.initialize();
  await new Promise<void>(resolve => { setTimeout(resolve, 0); });
}

interface Citation { citation_key: string; title: string; author: string; year: string }

export function stubFetch({ searchStatus = 200, items = [] }: { searchStatus?: number; items?: Citation[] } = {}) {
  return installFetch((input) => {
    const url = new URL(requestUrl(input));
    if (url.pathname === '/api/health') return Promise.resolve(jsonResponse());
    if (url.pathname === '/api/vault/search-citations') {
      return Promise.resolve(jsonResponse(items, searchStatus));
    }
    return Promise.reject(new Error(`Unexpected Word fixture request: ${url.href}`));
  });
}
