import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as browserEvents from '../../shared/platform/browser-events';
import { ZoteroReaderTab } from './ZoteroReaderTab';

interface ReactTestGlobal {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const mocks = vi.hoisted(() => ({
  transportFetch: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}));

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'ca' },
    t: (key: string, fallback?: unknown): string => {
      if (typeof fallback === 'string') return fallback;
      if (!isUnknownRecord(fallback)) return key;
      const defaultValue = fallback.defaultValue;
      return typeof defaultValue === 'string' ? defaultValue : key;
    },
  }),
}));

vi.mock('../../locales/registry', () => ({
  getLocaleMeta: () => ({ direction: 'ltr' }),
}));

vi.mock('./zoteroLocale', () => ({
  uiLangToZoteroLocale: () => 'ca-AD',
}));

vi.mock('../../shared/api/transports', () => ({
  transportFetch: mocks.transportFetch,
}));

vi.mock('../../lib/notifyError', () => ({ logError: vi.fn() }));
vi.mock('../../lib/toast', () => ({ toast: { error: vi.fn() } }));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeAll(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mocks.transportFetch.mockReset();
  mocks.transportFetch.mockImplementation((input) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL ? input.toString() : input.url;
    if (url === '/api/vault/local-file/register') {
      return Promise.resolve(Response.json({ url: '/api/vault/local-file/token-1' }));
    }
    if (url.startsWith('/api/vault/pdf-annotations?')) {
      return Promise.resolve(Response.json([]));
    }
    if (url === '/api/vault/open-local-path') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
});

async function renderReader(
  props: React.ComponentProps<typeof ZoteroReaderTab>,
): Promise<HTMLDivElement> {
  const nextContainer = document.createElement('div');
  document.body.appendChild(nextContainer);
  container = nextContainer;
  root = createRoot(nextContainer);
  await act(async () => {
    root?.render(<ZoteroReaderTab {...props} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return nextContainer;
}

function readerFrame(rendered: HTMLElement): HTMLIFrameElement {
  const frame = rendered.querySelector('iframe');
  if (!(frame instanceof HTMLIFrameElement)) throw new Error('Expected reader iframe');
  if (!frame.contentWindow) throw new Error('Expected iframe window');
  return frame;
}

async function sendReaderMessage(
  frame: HTMLIFrameElement,
  data: Readonly<Record<string, unknown>>,
): Promise<void> {
  await act(async () => {
    browserEvents.dispatchWindowEvent(new MessageEvent('message', {
      data: { source: 'zotero-reader', ...data },
      origin: browserEvents.currentBrowserOrigin(),
      source: frame.contentWindow,
    }));
    await Promise.resolve();
  });
}

afterEach(() => {
  const mountedRoot = root;
  if (mountedRoot) {
    act(() => {
      mountedRoot.unmount();
    });
  }
  container?.remove();
  container = null;
  root = null;
});

describe('ZoteroReaderTab', () => {
  it('shows the preserved fallback when no document source exists', async () => {
    const rendered = await renderReader({ src: '' });

    expect(rendered.textContent).toContain('There is no PDF to display');
    expect(rendered.querySelector('iframe')).toBeNull();
  });

  it('registers a local EPUB and initializes once after host readiness', async () => {
    const rendered = await renderReader({
      location: { pageNumber: '5' },
      src: 'file:///Users/test/Library/Book.epub',
    });
    const frame = readerFrame(rendered);
    const frameWindow = frame.contentWindow;
    if (!frameWindow) throw new Error('Expected iframe window');
    const postMessage = vi.spyOn(browserEvents, 'postWindowMessage')
      .mockImplementation(() => undefined);

    await sendReaderMessage(frame, { type: 'host-ready' });
    await sendReaderMessage(frame, { type: 'host-ready' });

    const registrationCall = mocks.transportFetch.mock.calls.find(
      ([input]) => input === '/api/vault/local-file/register',
    );
    expect(registrationCall?.[1]?.method).toBe('POST');
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0]?.[0]).toBe(frameWindow);
    expect(postMessage.mock.calls[0]?.[1]).toEqual({
      payload: {
        annotations: [],
        direction: 'ltr',
        kind: 'epub',
        language: 'ca-AD',
        location: { pageNumber: '5' },
        options: { authorName: 'User', readOnly: false },
        pdfUrl: '/api/vault/local-file/token-1',
      },
      target: 'zotero-reader',
      type: 'init',
    });
    expect(postMessage.mock.calls[0]?.[2]).toBe(browserEvents.currentBrowserOrigin());
  });

  it('navigates an already ready reader and refreshes its annotations', async () => {
    const rendered = await renderReader({ src: '/api/vault/library/paper.pdf' });
    const frame = readerFrame(rendered);
    const frameWindow = frame.contentWindow;
    if (!frameWindow) throw new Error('Expected iframe window');
    const postMessage = vi.spyOn(browserEvents, 'postWindowMessage')
      .mockImplementation(() => undefined);
    await sendReaderMessage(frame, { type: 'host-ready' });
    await sendReaderMessage(frame, { type: 'ready' });
    postMessage.mockClear();

    await act(async () => {
      root?.render(
        <ZoteroReaderTab
          location={{ highlightText: 'Evidence', pageNumber: '8' }}
          src="/api/vault/library/paper.pdf"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const messages = postMessage.mock.calls.map(([, message]) => message);
    expect(messages).toContainEqual({
      location: { highlightText: 'Evidence', pageNumber: '8' },
      target: 'zotero-reader',
      type: 'navigate',
    });
    expect(messages).toContainEqual({
      annotations: [],
      target: 'zotero-reader',
      type: 'set-annotations',
    });
  });
});
