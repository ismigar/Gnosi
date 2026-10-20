import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MailMessage, MailThread } from '../../../shared/api/mail';
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

function retry(): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === 'Try again');
  if (!button) throw new Error('Missing reader retry');
  return button;
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


describe('MailViewer bounded reader loading', () => {
  it.each([
    { name: 'normalized account', aliasAccount: ' READER@example.test ', viewerAccount: account },
    { name: 'account-scoped aggregate conversation', aliasAccount: null, viewerAccount: null },
  ])('reuses the loaded Gmail body for $name and preserves action and image scope', async ({ aliasAccount, viewerAccount }) => {
    const selected = message('imap_42');
    const detail = message('imap_42', {
      body_html: '<p>Already loaded body</p><img alt="Inline" src="cid:logo">',
      internet_message_id: '<same@example.test>', thread_id: 'gmail-thread',
      attachments: [{ attachment_id: 'part', filename: 'example.txt', content_type: 'text/plain' }],
    });
    const alias = message('imap_901', {
      account: aliasAccount, imap_folder: '[Gmail]/All Mail', imap_uid: '901',
      internet_message_id: '<same@example.test>', thread_id: 'gmail-thread',
    });
    mocks.fetchMessage.mockImplementation((_id, query) => query?.folder === 'INBOX'
      ? Promise.resolve(detail) : new Promise(() => undefined));
    mocks.fetchThread.mockResolvedValue({ messages: [alias] });
    const onCompose = vi.fn();
    const onActionDone = vi.fn();
    await render({ account: viewerAccount, mail: selected, onCompose, onActionDone });

    expect(mocks.fetchMessage).toHaveBeenCalledTimes(1);
    const source = container.querySelector('iframe')?.srcdoc || '';
    expect(source).toContain('Already loaded body');
    expect(source).toContain('/api/mail/messages/imap_42/cid/logo');
    expect(source).toContain('folder=INBOX');
    expect(source).toContain('email=reader%40example.test');
    const attachment = container.querySelector<HTMLAnchorElement>('a[download="example.txt"]');
    expect(attachment?.href).toContain('/api/mail/messages/imap_42/attachments/part');
    expect(attachment?.href).toContain('folder=INBOX');
    expect(attachment?.href).toContain('email=reader%40example.test');
    const reply = [...container.querySelectorAll('button')].find(button => button.title === 'mail.reply_all_title');
    const archive = [...container.querySelectorAll('button')].find(button => button.title === 'mail.archive_action');
    await settle(() => { reply?.click(); archive?.click(); });
    expect(onCompose).toHaveBeenCalledWith(expect.objectContaining({ replyToMessageId: 'imap_42', sourceFolder: 'INBOX' }));
    expect(mocks.archive).toHaveBeenCalledWith('imap_42', account.email, 'INBOX');
    expect(onActionDone).toHaveBeenCalledWith('imap_42', 'archive', account.email,
      { imap_folder: 'INBOX', imap_uid: '42' }, expect.objectContaining({ id: 'imap_42' }));
  });

  it.each([
    { name: 'another account', account: 'other@example.test', internet_message_id: '<same@example.test>' },
    { name: 'another message', account: account.email, internet_message_id: '<other@example.test>' },
    { name: 'missing Internet Message-ID', account: account.email, internet_message_id: null },
    { name: 'another Gmail thread', account: account.email, internet_message_id: '<same@example.test>', gm_thrid: 'other-thread' },
  ])('fetches a distinct body for $name even when folder UIDs collide', async (scope) => {
    const selected = message('imap_42');
    const alias = message('imap_42', {
      ...scope, imap_folder: '[Gmail]/All Mail', thread_id: 'gmail-thread',
    });
    mocks.fetchMessage.mockImplementation((_id, query) => Promise.resolve(query?.folder === 'INBOX'
      ? { ...selected, internet_message_id: '<same@example.test>', gm_thrid: 'same-thread', thread_id: 'gmail-thread', body_text: 'Selected body' }
      : { ...alias, body_text: 'Distinct body' }));
    mocks.fetchThread.mockResolvedValue({ messages: [alias] });
    await render({ mail: selected });
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Distinct body');
    expect(mocks.fetchMessage).toHaveBeenLastCalledWith('imap_42', {
      email: scope.account, folder: '[Gmail]/All Mail',
    }, expect.any(AbortSignal));
  });

  it('keeps a pending selected detail when the summary and read callback are replaced', async () => {
    const pending = deferred<MailMessage>();
    const selected = message('imap_42', { is_read: false });
    mocks.fetchMessage.mockReturnValue(pending.promise);
    const firstRead = vi.fn();
    const latestRead = vi.fn();
    await render({ mail: selected, onMailRead: firstRead });
    const signal = mocks.fetchMessage.mock.calls[0]?.[2];
    await render({ mail: { ...selected, is_read: true }, onMailRead: latestRead });
    expect(signal?.aborted).toBe(false);
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(1);
    await settle(() => { pending.resolve({ ...selected, body_text: 'Finished body' }); });
    expect(container.textContent).toContain('Finished body');
    expect(firstRead).not.toHaveBeenCalled();
    expect(latestRead).toHaveBeenCalledTimes(1);
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps pending thread discovery and body reads through read flag updates', async () => {
    const selected = message('imap_42');
    const pendingThread = deferred<MailThread>();
    const pendingBody = deferred<MailMessage>();
    const other = message('imap_901', { imap_folder: '[Gmail]/All Mail', thread_id: 'gmail-thread' });
    mocks.fetchMessage.mockImplementation(id => id === selected.id
      ? Promise.resolve({ ...selected, thread_id: 'gmail-thread', body_text: 'Selected body' })
      : pendingBody.promise);
    mocks.fetchThread.mockReturnValue(pendingThread.promise);
    await render({ mail: selected, onMailRead: vi.fn() });
    const threadSignal = mocks.fetchThread.mock.calls[0]?.[2];
    await render({ mail: { ...selected, is_read: false }, onMailRead: vi.fn() });
    expect(threadSignal?.aborted).toBe(false);
    expect(mocks.fetchThread).toHaveBeenCalledTimes(1);
    await settle(() => { pendingThread.resolve({ messages: [other] }); });
    const bodySignal = mocks.fetchMessage.mock.calls[1]?.[2];
    await render({ mail: { ...selected, is_read: true }, onMailRead: vi.fn() });
    expect(bodySignal?.aborted).toBe(false);
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(2);
    await settle(() => { pendingBody.resolve({ ...other, body_text: 'Conversation body' }); });
    expect(container.textContent).toContain('Conversation body');
  });

  it('offers retry after a failed selected body and retains the summary', async () => {
    const selected = message('imap_42', { snippet: 'Available preview' });
    mocks.fetchMessage.mockRejectedValueOnce(new Error('synthetic detail failure'))
      .mockResolvedValueOnce({ ...selected, body_text: 'Retried detail' });
    await render({ mail: selected });
    expect(container.textContent).toContain('Available preview');
    expect(container.querySelector('[data-mail-reader-error="message"]')).not.toBeNull();
    expect(container.querySelector('[data-mail-body-loading]')).toBeNull();
    await settle(() => { retry().click(); });
    expect(container.textContent).toContain('Retried detail');
    expect(container.querySelector('[data-mail-reader-error]')).toBeNull();
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(2);
  });

  it('offers retry after a failed conversation body instead of an endless spinner', async () => {
    const selected = message('imap_42');
    const other = message('imap_901', { imap_folder: '[Gmail]/All Mail', thread_id: 'gmail-thread' });
    mocks.fetchMessage.mockResolvedValueOnce({ ...selected, thread_id: 'gmail-thread', body_text: 'Selected body' })
      .mockRejectedValueOnce(new Error('synthetic thread body failure'))
      .mockResolvedValueOnce({ ...other, body_text: 'Retried conversation body' });
    mocks.fetchThread.mockResolvedValue({ messages: [other] });
    await render({ mail: selected });
    expect(container.querySelector('[data-mail-reader-error="thread-message"]')).not.toBeNull();
    expect(container.querySelector('[data-mail-body-loading]')).toBeNull();
    await settle(() => { retry().click(); });
    expect(container.textContent).toContain('Retried conversation body');
    expect(container.querySelector('[data-mail-reader-error]')).toBeNull();
  });

  it('retries failed conversation discovery without reloading the selected body', async () => {
    const selected = message('imap_42', { body_text: 'Available message', thread_id: 'gmail-thread' });
    mocks.fetchMessage.mockResolvedValue(selected);
    mocks.fetchThread.mockRejectedValueOnce(new Error('synthetic conversation failure'))
      .mockResolvedValueOnce({ messages: [selected] });
    await render({ mail: selected });
    expect(container.textContent).toContain('Available message');
    expect(container.querySelector('[data-mail-reader-error="thread"]')).not.toBeNull();
    await settle(() => { retry().click(); });
    expect(container.querySelector('[data-mail-reader-error]')).toBeNull();
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(1);
    expect(mocks.fetchThread).toHaveBeenCalledTimes(2);
  });

  it('deduplicates a toggled body and aborts it on navigation, ignoring a late failure', async () => {
    const selected = message('imap_42', { body_text: 'Available message', thread_id: 'gmail-thread' });
    const other = message('imap_901', {
      sender: 'Other participant <other@example.test>', imap_folder: '[Gmail]/All Mail', thread_id: 'gmail-thread',
    });
    const pending = deferred<MailMessage>();
    mocks.fetchMessage.mockImplementation(id => id === other.id ? pending.promise
      : Promise.resolve(id === selected.id ? selected : message(id, { body_text: 'New selection' })));
    mocks.fetchThread.mockResolvedValue({ messages: [other, selected] });
    await render({ mail: selected });
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(1);
    const header = [...container.querySelectorAll('button')].find(button => button.textContent.includes('Other participant'));
    if (!header) throw new Error('Missing collapsed conversation message');
    await settle(() => { header.click(); });
    const signal = mocks.fetchMessage.mock.calls[1]?.[2];
    expect(signal).toBeInstanceOf(AbortSignal);
    await settle(() => { header.click(); });
    await settle(() => { header.click(); });
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(2);
    await render({ mail: message('imap_50') });
    expect(signal?.aborted).toBe(true);
    await settle(() => { pending.reject(new Error('synthetic late body failure')); });
    expect(container.textContent).toContain('New selection');
    expect(container.querySelector('[data-mail-reader-error]')).toBeNull();
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it('reuses a recently opened body only within its viewer, account, folder and vault', async () => {
    mocks.fetchMessage.mockImplementation((id, query) => Promise.resolve(message(id, {
      account: query?.email, imap_folder: query?.folder, body_text: `Body ${id} ${query?.folder || ''}`,
    })));
    await render({ mail: message('imap_42') });
    await render({ mail: message('imap_43') });
    await render({ mail: message('imap_42') });
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Body imap_42 INBOX');
    await render({ mail: message('imap_42', { imap_folder: 'Archive' }) });
    await render({ mail: message('imap_42', { account: 'other@example.test' }) });
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(4);
    mocks.context = { ...mocks.context, vaultId: 'second' };
    await render({ mail: message('imap_42') });
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(5);
    act(() => { root.unmount(); });
    root = createRoot(container);
    await render({ mail: message('imap_42') });
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(6);
  });

  it('replaces a loaded body when a refreshed UID refers to a different Internet Message-ID', async () => {
    const original = message('imap_42', { internet_message_id: 'before@example.test' });
    const replacement = { ...original, internet_message_id: 'replacement@example.test' };
    mocks.fetchMessage.mockResolvedValueOnce({ ...original, body_text: 'Previous body' })
      .mockResolvedValueOnce({ ...replacement, body_text: 'Replacement body' });
    await render({ mail: original });
    expect(container.textContent).toContain('Previous body');
    await render({ mail: replacement });
    expect(container.textContent).toContain('Replacement body');
    expect(container.textContent).not.toContain('Previous body');
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(2);
  });

  it('does not reuse an older cached body for a replacement message with the same UID', async () => {
    const original = message('imap_42', { internet_message_id: 'before@example.test' });
    const replacement = { ...original, internet_message_id: 'replacement@example.test' };
    mocks.fetchMessage.mockResolvedValueOnce({ ...original, body_text: 'Previous body' })
      .mockResolvedValueOnce(message('imap_43', { body_text: 'Other body' }))
      .mockResolvedValueOnce({ ...replacement, body_text: 'Replacement body' });
    await render({ mail: original });
    await render({ mail: message('imap_43') });
    await render({ mail: replacement });
    expect(container.textContent).toContain('Replacement body');
    expect(container.textContent).not.toContain('Previous body');
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(3);
  });

  it('retains a summary content ID when sparse detail omits it and still reuses the body', async () => {
    const selected = message('imap_42', { internet_message_id: 'known@example.test' });
    mocks.fetchMessage.mockImplementation(id => Promise.resolve(message(id, { body_text: `Body ${id}` })));
    await render({ mail: selected });
    await render({ mail: message('imap_43') });
    await render({ mail: { ...selected, is_read: false } });
    expect(container.textContent).toContain('Body imap_42');
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(2);
  });

  it('keeps equivalent bracketed and bare content IDs stable through header refreshes', async () => {
    const selected = message('imap_42', { internet_message_id: 'same@example.test' });
    mocks.fetchMessage.mockResolvedValue({ ...selected, internet_message_id: '<same@example.test>', body_text: 'Matching body' });
    await render({ mail: selected });
    expect(container.textContent).toContain('Matching body');
    await render({ mail: { ...selected, internet_message_id: ' <same@example.test> ', is_read: false } });
    expect(container.textContent).toContain('Matching body');
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps a loaded body when a refreshed summary omits the known content ID', async () => {
    const selected = message('imap_42', { internet_message_id: '<known@example.test>' });
    mocks.fetchMessage.mockResolvedValueOnce({ ...selected, body_text: 'Known body' })
      .mockImplementation(() => new Promise(() => undefined));
    await render({ mail: selected });
    await render({ mail: { ...selected, internet_message_id: null, is_read: false } });
    expect(container.textContent).toContain('Known body');
    expect(container.querySelector('[data-mail-body-loading]')).toBeNull();
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(1);
  });

  it('reuses sparse-summary detail after revisiting with the matching content ID', async () => {
    const selected = message('imap_42');
    const detail = { ...selected, internet_message_id: '<known@example.test>', body_text: 'Enriched body' };
    mocks.fetchMessage.mockResolvedValueOnce(detail)
      .mockResolvedValueOnce(message('imap_43', { body_text: 'Other body' }))
      .mockImplementation(() => new Promise(() => undefined));
    await render({ mail: selected });
    await render({ mail: message('imap_43') });
    await render({ mail: { ...selected, internet_message_id: 'known@example.test' } });
    expect(container.textContent).toContain('Enriched body');
    expect(container.querySelector('[data-mail-body-loading]')).toBeNull();
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(2);
  });

  it('replaces a sparse cache entry instead of resurrecting it after a known replacement', async () => {
    const selected = message('imap_42');
    const replacement = { ...selected, internet_message_id: 'replacement@example.test' };
    mocks.fetchMessage.mockResolvedValueOnce({ ...selected, internet_message_id: '<old@example.test>', body_text: 'Obsolete body' })
      .mockResolvedValueOnce(message('imap_43', { body_text: 'Other body' }))
      .mockResolvedValueOnce({ ...replacement, body_text: 'Current replacement body' });
    await render({ mail: selected });
    await render({ mail: message('imap_43') });
    await render({ mail: replacement });
    expect(container.textContent).toContain('Current replacement body');
    await render({ mail: message('imap_43') });
    await render({ mail: selected });
    expect(container.textContent).toContain('Current replacement body');
    expect(container.textContent).not.toContain('Obsolete body');
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(3);
  });

  it('keeps a pending body when the summary gains its matching content ID', async () => {
    const selected = message('imap_42');
    const pending = deferred<MailMessage>();
    mocks.fetchMessage.mockReturnValue(pending.promise);
    await render({ mail: selected });
    const signal = mocks.fetchMessage.mock.calls[0]?.[2];
    await render({ mail: { ...selected, internet_message_id: '<known@example.test>' } });
    expect(signal?.aborted).toBe(false);
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(1);
    await settle(() => { pending.resolve({ ...selected, internet_message_id: 'known@example.test', body_text: 'Pending body' }); });
    expect(container.textContent).toContain('Pending body');
    expect(mocks.fetchMessage).toHaveBeenCalledTimes(1);
  });

  it('aborts an expanded body on selection change and ignores its late result', async () => {
    const selected = message('imap_42');
    const other = message('imap_901', { imap_folder: '[Gmail]/All Mail', thread_id: 'gmail-thread' });
    const pending = deferred<MailMessage>();
    mocks.fetchMessage.mockImplementation(id => id === other.id ? pending.promise
      : Promise.resolve(message(id, { body_text: `Body ${id}`, thread_id: id === selected.id ? 'gmail-thread' : id })));
    mocks.fetchThread.mockResolvedValue({ messages: [other] });
    await render({ mail: selected });
    const signal = mocks.fetchMessage.mock.calls[1]?.[2];
    await render({ mail: message('imap_50') });
    expect(signal?.aborted).toBe(true);
    await settle(() => { pending.resolve({ ...other, body_text: 'Stale conversation body' }); });
    expect(container.textContent).toContain('Body imap_50');
    expect(container.textContent).not.toContain('Stale conversation body');
    expect(container.querySelector('[data-mail-reader-error]')).toBeNull();
  });
});
