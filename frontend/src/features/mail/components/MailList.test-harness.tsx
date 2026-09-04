import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';

import type { MailMessages, MailMessagesQuery } from '../../../shared/api/mail';
import MailList, { type MailListProps } from './MailList';
import type { MailListMessage } from './mail-list/mailListTypes';

const hoistedMocks = vi.hoisted(() => ({
  archive: vi.fn<(...args: readonly unknown[]) => Promise<void>>(),
  batch: vi.fn<(email: string, action: string, ids: string[]) => Promise<void>>(),
  deleteDraft: vi.fn<(id: string) => Promise<void>>(),
  emptyFolder: vi.fn<(email: string, folder: string) => Promise<void>>(),
  error: vi.fn<(...args: readonly unknown[]) => void>(),
  fetchFolders: vi.fn<
    (email: string) => Promise<{
      folders: { name: string; type: string }[];
    }>
  >(),
  fetchMessages: vi.fn<(query: MailMessagesQuery) => Promise<MailMessages>>(),
  getTags: vi.fn<
    (messages: readonly MailListMessage[]) => Promise<Record<string, string[]>>
  >(),
  move: vi.fn<(...args: readonly unknown[]) => Promise<void>>(),
  purgeCache: vi.fn<(messages: readonly MailListMessage[]) => void>(),
  readCache: vi.fn<(key: string) => MailListMessage[] | null>(),
  saveTags: vi.fn<(...args: readonly unknown[]) => Promise<void>>(),
  star: vi.fn<(...args: readonly unknown[]) => Promise<void>>(),
  streamClose: vi.fn<() => void>(),
  streamListen: vi.fn<(name: string, listener: () => void) => void>(),
  success: vi.fn<(...args: readonly unknown[]) => void>(),
  t: (key: string, fallback?: unknown): string =>
    typeof fallback === 'string' ? fallback : key,
  trash: vi.fn<(...args: readonly unknown[]) => Promise<void>>(),
  writeCache: vi.fn<(...args: readonly unknown[]) => boolean>(),
}));

export const mocks = hoistedMocks;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: hoistedMocks.t }),
}));

vi.mock('../../../shared/api/mail', () => ({
  archiveMailMessage: hoistedMocks.archive,
  batchMailMessages: hoistedMocks.batch,
  deleteMailDraft: hoistedMocks.deleteDraft,
  emptyMailFolder: hoistedMocks.emptyFolder,
  fetchMailFolders: hoistedMocks.fetchFolders,
  fetchMailMessages: hoistedMocks.fetchMessages,
  moveMailMessage: hoistedMocks.move,
  starMailMessage: hoistedMocks.star,
  trashMailMessage: hoistedMocks.trash,
}));

vi.mock('../../../shared/api/specialized-transports', () => ({
  openEventStream: () => ({
    addEventListener: hoistedMocks.streamListen,
    close: hoistedMocks.streamClose,
    onerror: null,
  }),
}));

vi.mock('../hooks/useMailTags', () => ({
  useMailTags: () => ({
    createTag: (): Promise<void> => Promise.resolve(),
    deleteTag: (): Promise<void> => Promise.resolve(),
    getBatchMessageTags: hoistedMocks.getTags,
    setMessageTags: hoistedMocks.saveTags,
    tags: [],
  }),
}));

vi.mock('../../../shared/notifications/toast', () => ({
  toast: { error: hoistedMocks.error, success: hoistedMocks.success },
}));

vi.mock('./mail-list/mailListCache', () => ({
  purgeMailListCacheMessages: hoistedMocks.purgeCache,
  readMailListCache: hoistedMocks.readCache,
  writeMailListCache: hoistedMocks.writeCache,
}));

const observers: TestIntersectionObserver[] = [];

class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0.1];
  #target: Element | null = null;

  constructor(readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }

  disconnect(): void {
    this.#target = null;
  }

  observe(target: Element): void {
    this.#target = target;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(): void {
    this.#target = null;
  }

  intersect(): void {
    if (!this.#target) throw new Error('No sentinel is being observed');
    this.callback(
      [
        {
          boundingClientRect: new DOMRect(),
          intersectionRatio: 1,
          intersectionRect: new DOMRect(),
          isIntersecting: true,
          rootBounds: null,
          target: this.#target,
          time: 0,
        },
      ],
      this,
    );
  }
}

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
export const account = { email: 'one@example.com' };
export const accounts = [account];
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView',
);

export function message(id: string): MailListMessage {
  return {
    account: account.email,
    date: '2026-08-30T10:00:00Z',
    has_attachments: false,
    id,
    imap_folder: 'SENT',
    imap_uid: `uid-${id}`,
    is_read: false,
    is_starred: false,
    sender: 'Sender <sender@example.com>',
    snippet: `Preview ${id}`,
    subject: `Subject ${id}`,
    thread_id: id,
    timestamp: Date.parse('2026-08-30T10:00:00Z') / 1000,
  };
}

export function response(
  messages: MailListMessage[],
  nextPageToken: string | null = null,
): MailMessages {
  return { messages, next_page_token: nextPageToken, total: 2 };
}

function props(overrides: Partial<MailListProps> = {}): MailListProps {
  return {
    account,
    accounts,
    activeTagId: null,
    activeView: null,
    category: null,
    folder: 'SENT',
    listRefreshToken: 0,
    onSelectMail: () => undefined,
    onToggleMailboxSidebar: () => undefined,
    readMail: null,
    removedMail: null,
    showMailboxSidebar: true,
    ...overrides,
  };
}

export interface MailListTestHarness {
  readonly button: (title: string) => HTMLButtonElement;
  readonly checkbox: () => HTMLInputElement;
  readonly click: (element: HTMLElement) => Promise<void>;
  readonly container: HTMLDivElement;
  readonly intersect: () => void;
  readonly render: (overrides?: Partial<MailListProps>) => Promise<void>;
  readonly rerender: (overrides?: Partial<MailListProps>) => Promise<void>;
}

export function setupMailListTestHarness(): MailListTestHarness {
  let container: HTMLDivElement;
  let root: Root;

  async function render(overrides: Partial<MailListProps> = {}): Promise<void> {
    await act(async () => {
      root.render(<MailList {...props(overrides)} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn<() => void>(),
    });
    mocks.fetchMessages.mockResolvedValue(response([message('one')]));
    mocks.fetchFolders.mockResolvedValue({
      folders: [{ name: 'Projects', type: 'custom' }],
    });
    mocks.getTags.mockResolvedValue({});
    mocks.readCache.mockReturnValue(null);
    mocks.writeCache.mockReturnValue(true);
    mocks.batch.mockResolvedValue(undefined);
    mocks.move.mockResolvedValue(undefined);
    mocks.archive.mockResolvedValue(undefined);
    mocks.trash.mockResolvedValue(undefined);
    mocks.star.mockResolvedValue(undefined);
    mocks.deleteDraft.mockResolvedValue(undefined);
    mocks.emptyFolder.mockResolvedValue(undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    observers.length = 0;
    if (originalScrollIntoView) {
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollIntoView',
        originalScrollIntoView,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
    delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  return {
    button(title: string): HTMLButtonElement {
      const result = container.querySelector(`button[title="${title}"]`);
      if (!(result instanceof HTMLButtonElement)) {
        throw new Error(`Missing button: ${title}`);
      }
      return result;
    },
    checkbox(): HTMLInputElement {
      const result = container.querySelector('input[aria-label]');
      if (!(result instanceof HTMLInputElement)) {
        throw new Error('Missing message checkbox');
      }
      return result;
    },
    async click(element: HTMLElement): Promise<void> {
      await act(async () => {
        element.click();
        await Promise.resolve();
      });
    },
    get container(): HTMLDivElement {
      return container;
    },
    intersect(): void {
      observers[0]?.intersect();
    },
    render,
    rerender: render,
  };
}
