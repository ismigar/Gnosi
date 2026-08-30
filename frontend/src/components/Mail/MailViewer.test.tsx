import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MailMessage } from '../../shared/api/mail';
import MailViewer from './MailViewer';
import type { MailViewerProps } from './mailViewerTypes';


const mocks = vi.hoisted(() => ({
  archive: vi.fn<typeof import('../../shared/api/mail').archiveMailMessage>(),
  deleteDraft: vi.fn<typeof import('../../shared/api/mail').deleteMailDraft>(),
  extractEntities: vi.fn<typeof import('../../shared/api/mail').extractMailEntities>(),
  fetchMessage: vi.fn<typeof import('../../shared/api/mail').fetchMailMessage>(),
  getTags: vi.fn<() => Promise<string[]>>(),
  markRead: vi.fn<typeof import('../../shared/api/mail').markMailRead>(),
  trash: vi.fn<typeof import('../../shared/api/mail').trashMailMessage>(),
  t: (key: string, fallback?: unknown): string => typeof fallback === 'string' ? fallback : key,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('./MailPdfViewer', () => ({ MailPdfViewer: () => null }));
vi.mock('../../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../hooks/useMailTags', () => ({
  useMailTags: () => ({
    getMessageTags: mocks.getTags,
    tags: [],
  }),
}));
vi.mock('../../shared/api/mail', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../shared/api/mail')>(),
  archiveMailMessage: mocks.archive,
  deleteMailDraft: mocks.deleteDraft,
  extractMailEntities: mocks.extractEntities,
  fetchMailMessage: mocks.fetchMessage,
  markMailRead: mocks.markRead,
  trashMailMessage: mocks.trash,
}));


let container: HTMLDivElement;
let root: Root;
const account = { email: 'reader@example.test' };

function message(id: string, extra: Partial<MailMessage> = {}): MailMessage {
  return {
    account: account.email,
    body_text: 'Message body',
    date: '2026-08-30',
    has_attachments: false,
    id,
    imap_folder: 'INBOX',
    imap_uid: '42',
    is_read: true,
    is_starred: false,
    recipient: account.email,
    sender: 'Ada <ada@example.test>',
    subject: `Subject ${id}`,
    thread_id: id,
    timestamp: 0,
    ...extra,
  };
}

async function render(props: MailViewerProps): Promise<void> {
  await act(async () => {
    root.render(<MailViewer account={account} {...props} />);
    await Promise.resolve();
  });
}

function action(title: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((item) => item.title === title);
  if (!button) throw new Error(`Missing mail action: ${title}`);
  return button;
}

beforeAll(() => {
  const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.extractEntities.mockResolvedValue({ contacts: [], events: [] });
  mocks.getTags.mockResolvedValue([]);
  mocks.markRead.mockResolvedValue({ status: 'success' });
  mocks.archive.mockResolvedValue({ status: 'success' });
  mocks.trash.mockResolvedValue({ status: 'success' });
  mocks.deleteDraft.mockResolvedValue({ status: 'success' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});


describe('MailViewer', () => {
  it('marks the loaded folder read without reloading the same message', async () => {
    const selected = message('one', { imap_folder: undefined, is_read: false });
    mocks.fetchMessage.mockResolvedValue(message('one', { imap_folder: 'Inbox/Personal', is_read: false }));
    const onMailRead = vi.fn();
    await render({ mail: selected, onMailRead });
    expect(container.textContent).toContain('Subject one');
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(1);
    expect(mocks.markRead).toHaveBeenCalledWith('one', account.email, 'Inbox/Personal');
    expect(onMailRead).toHaveBeenCalledWith('one');
  });

  it('ignores a late message after selection has changed', async () => {
    let resolveFirst: ((value: MailMessage) => void) | undefined;
    mocks.fetchMessage.mockImplementation((id) => id === 'first'
      ? new Promise<MailMessage>((resolve) => { resolveFirst = resolve; })
      : Promise.resolve(message('second')));
    await render({ mail: message('first') });
    await render({ mail: message('second') });
    await act(async () => {
      resolveFirst?.(message('first', { is_read: false }));
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Subject second');
    expect(container.textContent).not.toContain('Subject first');
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('preserves reply-all fields and the exact archive undo payload', async () => {
    const selected = message('reply');
    mocks.fetchMessage.mockResolvedValue(selected);
    const onCompose = vi.fn();
    const onActionDone = vi.fn();
    await render({ mail: selected, onCompose, onActionDone });
    act(() => { action('mail.reply_all_title').click(); });
    expect(onCompose).toHaveBeenCalledWith(expect.objectContaining({
      initialCc: account.email,
      initialSubject: 'Re: Subject reply',
      initialTo: 'Ada <ada@example.test>',
      mode: 'reply_all',
      replyToMessageId: 'reply',
      sourceFolder: 'INBOX',
    }));
    await act(async () => {
      action('mail.archive_action').click();
      await Promise.resolve();
    });
    expect(onActionDone).toHaveBeenCalledWith('reply', 'archive', account.email, {
      imap_folder: 'INBOX', imap_uid: '42',
    });
  });

  it('deletes vault drafts through the draft endpoint without IMAP trash', async () => {
    const selected = message('draft', { source: 'vault' });
    mocks.fetchMessage.mockResolvedValue(selected);
    const onActionDone = vi.fn();
    await render({ mail: selected, onActionDone });
    await act(async () => {
      action('mail.delete_action').click();
      await Promise.resolve();
    });
    expect(mocks.deleteDraft).toHaveBeenCalledWith('draft');
    expect(mocks.trash).not.toHaveBeenCalled();
    expect(onActionDone).toHaveBeenCalledWith('draft', 'delete_draft', account.email);
  });
});
