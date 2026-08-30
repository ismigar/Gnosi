import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MailMessages, MailMessagesQuery } from '../../shared/api/mail';
import { dispatchWindowEvent } from '../../shared/platform/browser-events';
import MailList, { type MailListProps } from './MailList';
import type { MailListMessage } from './mail-list/mailListTypes';


const mocks = vi.hoisted(() => ({
  archive: vi.fn<(...args: readonly unknown[]) => Promise<void>>(),
  batch: vi.fn<(email: string, action: string, ids: string[]) => Promise<void>>(),
  deleteDraft: vi.fn<(id: string) => Promise<void>>(),
  emptyFolder: vi.fn<(email: string, folder: string) => Promise<void>>(),
  error: vi.fn<(...args: readonly unknown[]) => void>(),
  fetchFolders: vi.fn<(email: string) => Promise<{
    folders: { name: string; type: string }[];
  }>>(),
  fetchMessages: vi.fn<(query: MailMessagesQuery) => Promise<MailMessages>>(),
  getTags: vi.fn<(ids: string[]) => Promise<Record<string, string[]>>>(),
  move: vi.fn<(...args: readonly unknown[]) => Promise<void>>(),
  purgeCache: vi.fn<(ids: readonly string[]) => void>(),
  readCache: vi.fn<(key: string) => MailListMessage[] | null>(),
  saveTags: vi.fn<(...args: readonly unknown[]) => Promise<void>>(),
  star: vi.fn<(...args: readonly unknown[]) => Promise<void>>(),
  streamClose: vi.fn<() => void>(),
  streamListen: vi.fn<(name: string, listener: () => void) => void>(),
  success: vi.fn<(...args: readonly unknown[]) => void>(),
  t: (key: string, fallback?: unknown): string => (
    typeof fallback === 'string' ? fallback : key
  ),
  trash: vi.fn<(...args: readonly unknown[]) => Promise<void>>(),
  writeCache: vi.fn<(...args: readonly unknown[]) => boolean>(),
}));


vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: mocks.t }),
}));


vi.mock('../../shared/api/mail', () => ({
  archiveMailMessage: mocks.archive,
  batchMailMessages: mocks.batch,
  deleteMailDraft: mocks.deleteDraft,
  emptyMailFolder: mocks.emptyFolder,
  fetchMailFolders: mocks.fetchFolders,
  fetchMailMessages: mocks.fetchMessages,
  moveMailMessage: mocks.move,
  starMailMessage: mocks.star,
  trashMailMessage: mocks.trash,
}));


vi.mock('../../shared/api/specialized-transports', () => ({
  openEventStream: () => ({
    addEventListener: mocks.streamListen,
    close: mocks.streamClose,
    onerror: null,
  }),
}));


vi.mock('../../hooks/useMailTags', () => ({
  useMailTags: () => ({
    createTag: (): Promise<void> => Promise.resolve(),
    deleteTag: (): Promise<void> => Promise.resolve(),
    getBatchMessageTags: mocks.getTags,
    setMessageTags: mocks.saveTags,
    tags: [],
  }),
}));


vi.mock('../../lib/toast', () => ({
  toast: { error: mocks.error, success: mocks.success },
}));


vi.mock('./mail-list/mailListCache', () => ({
  purgeMailListCacheIds: mocks.purgeCache,
  readMailListCache: mocks.readCache,
  writeMailListCache: mocks.writeCache,
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
    this.callback([{
      boundingClientRect: new DOMRect(),
      intersectionRatio: 1,
      intersectionRect: new DOMRect(),
      isIntersecting: true,
      rootBounds: null,
      target: this.#target,
      time: 0,
    }], this);
  }
}


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const account = { email: 'one@example.com' };
const accounts = [account];
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView',
);
let container: HTMLDivElement;
let root: Root;


function message(id: string): MailListMessage {
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


function response(messages: MailListMessage[], nextPageToken: string | null = null): MailMessages {
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
    readMailId: null,
    removedMailId: null,
    showMailboxSidebar: true,
    ...overrides,
  };
}


async function render(overrides: Partial<MailListProps> = {}): Promise<void> {
  await act(async () => {
    root.render(<MailList {...props(overrides)} />);
    await Promise.resolve();
    await Promise.resolve();
  });
}


function button(title: string): HTMLButtonElement {
  const result = container.querySelector(`button[title="${title}"]`);
  if (!(result instanceof HTMLButtonElement)) throw new Error(`Missing button: ${title}`);
  return result;
}


async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}


function checkbox(): HTMLInputElement {
  const result = container.querySelector('input[aria-label]');
  if (!(result instanceof HTMLInputElement)) throw new Error('Missing message checkbox');
  return result;
}


beforeEach(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn<() => void>(),
  });
  mocks.fetchMessages.mockResolvedValue(response([message('one')]));
  mocks.fetchFolders.mockResolvedValue({ folders: [{ name: 'Projects', type: 'custom' }] });
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
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
  delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});


describe('MailList', () => {
  it('loads pages, preserves the cursor query and batches a selected message', async () => {
    const onBatchDone = vi.fn<() => void>();
    mocks.fetchMessages
      .mockResolvedValueOnce(response([message('one')], 'next'))
      .mockResolvedValueOnce(response([message('two')]));
    await render({ onBatchDone });
    expect(container.textContent).toContain('Subject one');

    await act(async () => {
      observers[0]?.intersect();
      await Promise.resolve();
    });
    expect(mocks.fetchMessages).toHaveBeenLastCalledWith({
      email: account.email,
      folder: 'SENT',
      limit: 50,
      offset: 1,
      pageToken: 'next',
    });
    expect(container.textContent).toContain('Subject two');
    await click(checkbox());
    await click(button('Mark as read'));

    expect(mocks.batch).toHaveBeenCalledWith(account.email, 'read', ['one']);
    expect(onBatchDone).toHaveBeenCalledOnce();
  });

  it('restores an optimistically archived message if its batch request fails', async () => {
    mocks.batch.mockRejectedValueOnce(new Error('offline'));
    await render();
    await click(checkbox());
    await click(button('Archive selected'));

    expect(mocks.purgeCache).toHaveBeenCalledWith(['one']);
    expect(container.textContent).toContain('Subject one');
    expect(mocks.error).toHaveBeenCalled();
  });

  it('refreshes with force on push and removes messages through the viewer seam', async () => {
    await render();
    const refresh = mocks.streamListen.mock.calls.find(
      ([name]) => name === 'flags_changed',
    )?.[1];
    await act(async () => {
      refresh?.();
      await Promise.resolve();
    });
    expect(mocks.fetchMessages).toHaveBeenLastCalledWith({
      email: account.email,
      folder: 'SENT',
      force: true,
      limit: 50,
    });

    await render({ removedMailId: 'one' });
    expect(container.textContent).not.toContain('Subject one');
    expect(mocks.purgeCache).toHaveBeenCalledWith(['one']);
  });

  it('keeps keyboard selection and open callbacks behind the shared event adapter', async () => {
    const onSelectMail = vi.fn<(mail: MailListMessage) => void>();
    await render({ onSelectMail });
    await act(async () => {
      dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      await Promise.resolve();
    });
    await act(async () => {
      dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await Promise.resolve();
    });

    expect(onSelectMail).toHaveBeenCalledWith(expect.objectContaining({ id: 'one' }));
  });

  it('preserves move payloads and restores the message on a move error', async () => {
    mocks.move.mockRejectedValueOnce(new Error('move failed'));
    await render();
    await click(button('Move to folder'));
    const destination = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent.includes('Projects'),
    );
    if (!destination) throw new Error('Missing move destination');
    await click(destination);

    expect(mocks.move).toHaveBeenCalledWith('one', account.email, {
      imap_folder: 'SENT',
      imap_uid: 'uid-one',
      target_folder: 'Projects',
    });
    expect(container.textContent).toContain('Subject one');
    expect(mocks.error).toHaveBeenCalledWith('move failed');
  });

  it('shows the persistent cache while revalidating and then replaces it', async () => {
    const cached = message('cached');
    mocks.readCache.mockReturnValueOnce([cached]);
    let resolveFresh: (value: MailMessages) => void = () => undefined;
    mocks.fetchMessages.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFresh = resolve;
    }));
    const onMessagesLoaded = vi.fn<(messages: readonly MailListMessage[]) => void>();
    await render({ onMessagesLoaded });
    expect(container.textContent).toContain('Subject cached');
    expect(onMessagesLoaded).toHaveBeenCalledWith([cached]);

    await act(async () => {
      resolveFresh(response([message('fresh')]));
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('Subject cached');
    expect(container.textContent).toContain('Subject fresh');
    expect(mocks.writeCache).toHaveBeenCalledWith('one@example.com|SENT|', [message('fresh')]);
  });

  it('confirms folder emptying and forces a fresh list only after success', async () => {
    await render({ folder: 'TRASH' });
    await click(button('Empty trash'));
    const confirm = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent.trim() === 'Confirm',
    );
    if (!confirm) throw new Error('Missing empty-folder confirmation');
    await click(confirm);

    expect(mocks.emptyFolder).toHaveBeenCalledWith(account.email, 'TRASH');
    expect(mocks.fetchMessages).toHaveBeenLastCalledWith({
      email: account.email,
      folder: 'TRASH',
      force: true,
      limit: 50,
    });
    expect(mocks.success).toHaveBeenCalledWith('Trash emptied');
  });
});
