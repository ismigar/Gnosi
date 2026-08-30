import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { subscribeDocumentEvent } from '../../shared/platform/browser-events';
import { useFileLinkInterceptor } from './useFileLinkInterceptor';

interface ReactTestGlobal {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

interface OpenResourceOptions {
  readonly citation?: Readonly<Record<string, unknown>>;
  readonly navigate?: (destination: string | number) => void;
  readonly t?: unknown;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const mocks = vi.hoisted(() => ({
  navigate: vi.fn<(destination: string | number) => void>(),
  openCitation: vi.fn<(
    resourceId: unknown,
    page: unknown,
    options?: OpenResourceOptions,
  ) => Promise<unknown>>(),
  openFileResource: vi.fn<(target: unknown, options?: OpenResourceOptions) => void>(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string): string => key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('../../components/Vault/markdown-mapper', () => ({
  FILE_PROTOCOL_SENTINEL: 'https://gnosi-file-protocol.local',
  sentinelToFileUrl: (href: string): string => (
    `file://${href.slice('https://gnosi-file-protocol.local'.length)}`
  ),
}));

vi.mock('../../lib/fileResource', () => ({
  openCitation: mocks.openCitation,
  openFileResource: mocks.openFileResource,
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function HookHarness() {
  useFileLinkInterceptor();
  return null;
}

function mountHook(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<HookHarness />);
  });
}

function click(anchor: HTMLAnchorElement, options: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...options });
  anchor.dispatchEvent(event);
  return event;
}

beforeAll(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  const mountedRoot = root;
  if (mountedRoot) {
    act(() => {
      mountedRoot.unmount();
    });
  }
  container?.remove();
  document.body.replaceChildren();
  container = null;
  root = null;
  vi.clearAllMocks();
});

describe('useFileLinkInterceptor', () => {
  it('opens protected local links through the shared file resource router', () => {
    mountHook();
    const anchor = document.createElement('a');
    anchor.href = 'https://gnosi-file-protocol.local/Users/test/Library/Paper.pdf';
    document.body.appendChild(anchor);

    const event = click(anchor);

    expect(event.defaultPrevented).toBe(true);
    const fileCall = mocks.openFileResource.mock.calls[0];
    expect(fileCall?.[0]).toBe('file:///Users/test/Library/Paper.pdf');
    expect(fileCall?.[1]?.navigate).toBe(mocks.navigate);
  });

  it('opens citations with their page, metadata and visible quote', () => {
    mountHook();
    const quote = document.createElement('blockquote');
    quote.append('Evidence text — ');
    const anchor = document.createElement('a');
    anchor.href = 'https://gnosi-cite.local/?res=resource-1&page=7&snapshot=snap-1';
    anchor.textContent = '[1]';
    quote.appendChild(anchor);
    document.body.appendChild(quote);

    click(anchor);

    const citationCall = mocks.openCitation.mock.calls[0];
    expect(citationCall?.[0]).toBe('resource-1');
    expect(citationCall?.[1]).toBe('7');
    expect(citationCall?.[2]?.citation?.highlightText).toBe('Evidence text');
    expect(citationCall?.[2]?.citation?.snapshot).toBe('snap-1');
    expect(citationCall?.[2]?.navigate).toBe(mocks.navigate);
  });

  it('keeps modified local clicks native and removes listeners on cleanup', () => {
    mountHook();
    const anchor = document.createElement('a');
    anchor.href = 'file:///tmp/native.pdf';
    document.body.appendChild(anchor);
    let productionPreventedClick = true;
    const unsubscribeNavigationGuard = subscribeDocumentEvent('click', (event) => {
      productionPreventedClick = event.defaultPrevented;
      event.preventDefault();
    });

    click(anchor, { metaKey: true });
    expect(productionPreventedClick).toBe(false);
    expect(mocks.openFileResource).not.toHaveBeenCalled();

    const mountedRoot = root;
    if (!mountedRoot) throw new Error('Expected mounted hook root');
    act(() => {
      mountedRoot.unmount();
    });
    root = null;
    click(anchor);
    expect(mocks.openFileResource).not.toHaveBeenCalled();
    unsubscribeNavigationGuard();
  });
});
