import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MailMessage } from '../../../shared/api/mail';
import MailViewer from './MailViewer';
import type { MailViewerProps } from './mailViewerTypes';


const mocks = vi.hoisted(() => ({
  archive: vi.fn<typeof import('../../../shared/api/mail').archiveMailMessage>(),
  deleteDraft: vi.fn<typeof import('../../../shared/api/mail').deleteMailDraft>(),
  extractEntities: vi.fn<typeof import('../../../shared/api/mail').extractMailEntities>(),
  fetchMessage: vi.fn<typeof import('../../../shared/api/mail').fetchMailMessage>(),
  fetchThread: vi.fn<typeof import('../../../shared/api/mail').fetchMailThread>(),
  getTags: vi.fn<() => Promise<string[]>>(),
  markRead: vi.fn<typeof import('../../../shared/api/mail').markMailRead>(),
  trash: vi.fn<typeof import('../../../shared/api/mail').trashMailMessage>(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  t: (key: string, fallback?: unknown): string => typeof fallback === 'string' ? fallback : key,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('./MailPdfViewer', () => ({ MailPdfViewer: () => null }));
vi.mock('../../../shared/notifications/toast', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock('../hooks/useMailTags', () => ({
  useMailTags: () => ({
    getMessageTags: mocks.getTags,
    tags: [],
  }),
}));
vi.mock('../../../shared/api/mail', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../shared/api/mail')>(),
  archiveMailMessage: mocks.archive,
  deleteMailDraft: mocks.deleteDraft,
  extractMailEntities: mocks.extractEntities,
  fetchMailMessage: mocks.fetchMessage,
  fetchMailThread: mocks.fetchThread,
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
  mocks.fetchThread.mockResolvedValue({ messages: [] });
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
    expect(mocks.extractEntities).not.toHaveBeenCalled();
  });

  it('runs smart analysis only after the explicit toolbar action', async () => {
    mocks.fetchMessage.mockResolvedValue(message('analysis'));
    await render({ mail: message('analysis') });
    expect(mocks.extractEntities).not.toHaveBeenCalled();

    await act(async () => {
      action('Smart analysis').click();
      await Promise.resolve();
    });
    expect(mocks.extractEntities).toHaveBeenCalledWith('Message body', {
      attachments: [],
      recipients: [account.email],
      sender: 'Ada <ada@example.test>',
    });
    expect(container.querySelector('[data-mail-analysis-status="no_entities"]'))
      .not.toBeNull();
  });

  it('distinguishes missing configuration and temporary provider failure', async () => {
    mocks.fetchMessage.mockResolvedValue(message('analysis-status'));
    mocks.extractEntities.mockResolvedValueOnce({
      contacts: [],
      events: [],
      error: 'not_configured',
    });
    await render({ mail: message('analysis-status') });
    expect(mocks.extractEntities).not.toHaveBeenCalled();
    expect(container.querySelector('[data-mail-analysis-status]')).toBeNull();
    expect(mocks.toastError).not.toHaveBeenCalled();
    await act(async () => {
      action('Smart analysis').click();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-mail-analysis-status="not_configured"]'))
      .not.toBeNull();

    mocks.extractEntities.mockResolvedValueOnce({
      contacts: [],
      events: [],
      error: 'temporarily_unavailable',
    });
    await act(async () => {
      action('Smart analysis').click();
      await Promise.resolve();
    });
    expect(container.querySelector(
      '[data-mail-analysis-status="temporarily_unavailable"]',
    )).not.toBeNull();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('shows deterministic local results only after manual provider failure', async () => {
    mocks.fetchMessage.mockResolvedValue(message('local-analysis'));
    mocks.extractEntities.mockResolvedValue({
      contacts: [{
        company: '',
        email: 'ada@example.test',
        name: 'Ada Lovelace',
        notes: '',
        phone: '',
      }],
      events: [],
      degraded_reason: 'providers_failed',
      local_analysis: {
        attachments: [],
        dates: [],
        indicators: [],
        participants: [],
        summary: {
          confidence: 1,
          kind: 'summary',
          label: 'extractive_summary',
          origin: 'message_body',
          value: 'Message body',
        },
        tasks: [],
      },
      provider: 'local_deterministic',
      provider_attempts: [{ provider: 'fixture', status: 'timeout' }],
      status: 'degraded',
    });
    await render({ mail: message('local-analysis') });
    expect(mocks.extractEntities).not.toHaveBeenCalled();

    await act(async () => {
      action('Smart analysis').click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-mail-analysis-status="local_results"]'))
      .not.toBeNull();
    expect(container.textContent).toContain('Gnosi only shows explicit data detected locally');
    expect(container.textContent).toContain('Ada Lovelace');
    expect(container.textContent).toContain('Message body');
    expect(container.textContent).toContain('fixture: timeout');
    expect(container.textContent).toContain('Try again');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('shows literal local results when no AI provider is configured', async () => {
    mocks.fetchMessage.mockResolvedValue(message('local-without-provider'));
    mocks.extractEntities.mockResolvedValue({
      contacts: [{
        company: '',
        email: 'ada@example.test',
        name: 'Ada Lovelace',
        notes: '',
        phone: '',
      }],
      events: [],
      provider: 'local_deterministic',
    });
    await render({ mail: message('local-without-provider') });

    await act(async () => {
      action('Smart analysis').click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-mail-analysis-status="local_results"]'))
      .not.toBeNull();
    expect(container.textContent).toContain('Ada Lovelace');
    expect(container.querySelector('[data-mail-analysis-status="not_configured"]'))
      .toBeNull();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('keeps previous valid results when every provider fails on retry', async () => {
    mocks.fetchMessage.mockResolvedValue(message('preserve-analysis'));
    mocks.extractEntities
      .mockResolvedValueOnce({
        contacts: [{
          company: '',
          email: 'ada@example.test',
          name: 'Ada Lovelace',
          notes: '',
          phone: '',
        }],
        events: [],
        provider: 'fixture',
        status: 'complete',
      })
      .mockResolvedValueOnce({
        contacts: [],
        degraded_reason: 'providers_failed',
        events: [],
        local_analysis: {
          attachments: [],
          dates: [],
          indicators: [],
          participants: [],
          summary: {
            confidence: 1,
            kind: 'summary',
            label: 'extractive_summary',
            origin: 'message_body',
            value: 'Message body',
          },
          tasks: [],
        },
        provider: 'local_deterministic',
        provider_attempts: [{ provider: 'fixture', status: 'timeout' }],
        status: 'degraded',
      });
    await render({ mail: message('preserve-analysis') });

    await act(async () => {
      action('Smart analysis').click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Ada Lovelace');

    await act(async () => {
      action('Smart analysis').click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Ada Lovelace');
    expect(container.textContent).toContain('fixture: timeout');
    expect(container.querySelector('[data-mail-analysis-status="local_results"]'))
      .not.toBeNull();
  });

  it('recovers from a degraded timeout on a later manual retry', async () => {
    mocks.fetchMessage.mockResolvedValue(message('analysis-recovery'));
    mocks.extractEntities
      .mockResolvedValueOnce({
        contacts: [],
        degraded_reason: 'providers_failed',
        events: [],
        local_analysis: {
          attachments: [], dates: [], indicators: [], participants: [],
          summary: {
            confidence: 1, kind: 'summary', label: 'extractive_summary',
            origin: 'message_body', value: 'Message body',
          },
          tasks: [],
        },
        provider: 'local_deterministic',
        provider_attempts: [{ provider: 'fixture', status: 'timeout' }],
        status: 'degraded',
      })
      .mockResolvedValueOnce({
        contacts: [],
        events: [{
          description: '', end: '2026-09-03T11:00:00', location: '',
          start: '2026-09-03T10:00:00', title: 'Explicit review',
        }],
        provider: 'fixture',
        provider_attempts: [{ provider: 'fixture', status: 'success' }],
        status: 'complete',
      });
    await render({ mail: message('analysis-recovery') });

    await act(async () => {
      action('Smart analysis').click();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-mail-analysis-status="local_results"]'))
      .not.toBeNull();

    await act(async () => {
      action('Smart analysis').click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-mail-analysis-status="results"]'))
      .not.toBeNull();
    expect(container.textContent).toContain('Explicit review');
  });

  it('waits for the selected detail before fetching its complete thread', async () => {
    let resolveDetail: ((value: MailMessage) => void) | undefined;
    mocks.fetchMessage.mockImplementation(() => new Promise<MailMessage>((resolve) => {
      resolveDetail = resolve;
    }));
    const selected = message('thread-message', { thread_id: 'thread' });
    await render({ mail: selected });
    expect(mocks.fetchThread).not.toHaveBeenCalled();

    await act(async () => {
      resolveDetail?.(selected);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.fetchThread).toHaveBeenCalledWith(
      'thread',
      account.email,
      expect.any(AbortSignal),
    );
  });

  it('ignores a late message after selection has changed', async () => {
    let resolveFirst: ((value: MailMessage) => void) | undefined;
    mocks.fetchMessage.mockImplementation((id) => id === 'first'
      ? new Promise<MailMessage>((resolve) => { resolveFirst = resolve; })
      : Promise.resolve(message('second')));
    await render({ mail: message('first') });
    const firstSignal = mocks.fetchMessage.mock.calls[0]?.[2];
    await render({ mail: message('second') });
    expect(firstSignal?.aborted).toBe(true);
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
