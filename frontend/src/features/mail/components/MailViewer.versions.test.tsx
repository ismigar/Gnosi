import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MailMessage } from '../../../shared/api/mail';
import MailViewer from './MailViewer';
import type { MailViewerProps } from './mailViewerTypes';


const mocks = vi.hoisted(() => ({
  archive: vi.fn<typeof import('../../../shared/api/mail').archiveMailMessage>(),
  context: { userId: 'viewer', userEmail: 'viewer@example.test', vaultId: 'first', workspaceId: 'personal' },
  fetchMessage: vi.fn<typeof import('../../../shared/api/mail').fetchMailMessage>(),
  fetchThread: vi.fn<typeof import('../../../shared/api/mail').fetchMailThread>(),
  getTags: vi.fn<() => Promise<string[]>>(),
  logError: vi.fn(),
  markRead: vi.fn<typeof import('../../../shared/api/mail').markMailRead>(),
  t: (key: string, fallback?: unknown): string => typeof fallback === 'string' ? fallback : key,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('./MailPdfViewer', () => ({ MailPdfViewer: () => null }));
vi.mock('../../../shared/hooks/useRequestContext', () => ({ useRequestContext: () => mocks.context }));
vi.mock('../../../shared/notifications/notifyError', () => ({ logError: mocks.logError }));
vi.mock('../hooks/useMailTags', () => ({
  useMailTags: () => ({ getMessageTags: mocks.getTags, tags: [] }),
}));
vi.mock('../../../shared/api/mail', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../shared/api/mail')>(),
  archiveMailMessage: mocks.archive,
  fetchMailMessage: mocks.fetchMessage,
  fetchMailThread: mocks.fetchThread,
  markMailRead: mocks.markRead,
}));


let container: HTMLDivElement;
let root: Root;
const account = { email: 'reader@example.test' };

function message(id: string, extra: Partial<MailMessage> = {}): MailMessage {
  return {
    account: account.email, body_text: null, date: '2026-10-17', has_attachments: false,
    id, imap_folder: 'INBOX', imap_uid: id.replace('imap_', ''), is_read: true,
    is_starred: false, recipient: account.email, sender: 'Fixture <sender@example.test>',
    source: 'imap', subject: `Subject ${id}`, thread_id: id, timestamp: 0, ...extra,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function render(props: MailViewerProps): Promise<void> {
  await act(async () => {
    root.render(<MailViewer account={account} {...props} />);
    await Promise.resolve();
  });
}

async function settle(action: () => void): Promise<void> {
  await act(async () => { action(); await Promise.resolve(); });
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context = { userId: 'viewer', userEmail: 'viewer@example.test', vaultId: 'first', workspaceId: 'personal' };
  mocks.fetchThread.mockResolvedValue({ messages: [] });
  mocks.getTags.mockResolvedValue([]);
  mocks.markRead.mockResolvedValue({ status: 'success' });
  mocks.archive.mockResolvedValue({ status: 'success' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});


describe('MailViewer current bodies and changing conversation headers', () => {
  it.each(['complete', 'sparse'])('keeps authoritative detail with a stale %s summary', async (kind) => {
    const selected = message('imap_42', { internet_message_id: 'obsolete@example.test',
      imap_folder: kind === 'sparse' ? undefined : 'INBOX' });
    mocks.fetchMessage.mockResolvedValueOnce(message('imap_42', {
      internet_message_id: 'current@example.test', body_text: 'Authoritative current body',
    })).mockImplementation(() => new Promise(() => undefined));
    await render({ mail: selected });
    expect(container.textContent).toContain('Authoritative current body');
    expect(container.querySelector('[data-mail-body-loading]')).toBeNull();
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(1);
  });

  it('hides an obsolete expanded member and loads its replacement once', async () => {
    const selected = message('imap_42', { body_text: 'Selected body' });
    const member = message('imap_43', { internet_message_id: 'old@example.test', sender: 'Member' });
    const replacement = { ...member, internet_message_id: 'new@example.test' };
    const pending = deferred<MailMessage>();
    mocks.fetchMessage.mockResolvedValueOnce(selected)
      .mockResolvedValueOnce({ ...member, body_text: 'Obsolete member body' })
      .mockReturnValueOnce(pending.promise);
    await render({ mail: { ...selected, thread_messages: [member, selected] } });
    expect(container.textContent).toContain('Obsolete member body');
    await render({ mail: { ...selected, thread_messages: [replacement, selected] } });
    expect(container.textContent).not.toContain('Obsolete member body');
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(3);
    const toggle = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Member'));
    if (!toggle) throw new Error('Missing member header');
    await settle(() => { toggle.click(); });
    await settle(() => { toggle.click(); });
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(3);
    await settle(() => { pending.resolve({ ...replacement, body_text: 'Replacement member body' }); });
    expect(container.textContent).toContain('Replacement member body');
    expect(container.textContent).not.toContain('Obsolete member body');
  });

  it('aborts a superseded member request and ignores its late body', async () => {
    const selected = message('imap_42', { body_text: 'Selected body' });
    const member = message('imap_43', { internet_message_id: 'old@example.test' });
    const replacement = { ...member, internet_message_id: 'new@example.test' };
    const before = deferred<MailMessage>();
    const after = deferred<MailMessage>();
    mocks.fetchMessage.mockResolvedValueOnce(selected)
      .mockReturnValueOnce(before.promise).mockReturnValueOnce(after.promise);
    await render({ mail: { ...selected, thread_messages: [member, selected] } });
    const previousSignal = mocks.fetchMessage.mock.calls[1]?.[2];
    await render({ mail: { ...selected, thread_messages: [replacement, selected] } });
    expect(previousSignal?.aborted).toBe(true);
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(3);
    await settle(() => { after.resolve({ ...replacement, body_text: 'Current member body' }); });
    await settle(() => { before.resolve({ ...member, body_text: 'Late obsolete body' }); });
    expect(container.textContent).toContain('Current member body');
    expect(container.textContent).not.toContain('Late obsolete body');
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(3);
  });

  it('reconciles a body completing after sparse member headers gain a different known ID', async () => {
    const selected = message('imap_42', { body_text: 'Selected body' });
    const member = message('imap_43');
    const replacement = { ...member, internet_message_id: 'new@example.test' };
    const before = deferred<MailMessage>();
    const after = deferred<MailMessage>();
    mocks.fetchMessage.mockResolvedValueOnce(selected)
      .mockReturnValueOnce(before.promise).mockReturnValueOnce(after.promise);
    await render({ mail: { ...selected, thread_messages: [member, selected] } });
    await render({ mail: { ...selected, thread_messages: [replacement, selected] } });
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(2);
    await settle(() => { before.resolve({ ...member, internet_message_id: 'old@example.test', body_text: 'Outdated sparse body' }); });
    expect(container.textContent).not.toContain('Outdated sparse body');
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(3);
    await settle(() => { after.resolve({ ...replacement, body_text: 'Reconciled member body' }); });
    expect(container.textContent).toContain('Reconciled member body');
  });

  it('does not retain an older member error after its known ID changes', async () => {
    const selected = message('imap_42', { body_text: 'Selected body' });
    const member = message('imap_43', { internet_message_id: 'old@example.test' });
    const replacement = { ...member, internet_message_id: 'new@example.test' };
    mocks.fetchMessage.mockResolvedValueOnce(selected)
      .mockRejectedValueOnce(new Error('Synthetic old-member failure'))
      .mockResolvedValueOnce({ ...replacement, body_text: 'Recovered replacement body' });
    await render({ mail: { ...selected, thread_messages: [member, selected] } });
    expect(container.querySelector('[data-mail-reader-error="thread-message"]')).not.toBeNull();
    await render({ mail: { ...selected, thread_messages: [replacement, selected] } });
    expect(container.textContent).toContain('Recovered replacement body');
    expect(container.querySelector('[data-mail-reader-error]')).toBeNull();
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(3);
  });
});
