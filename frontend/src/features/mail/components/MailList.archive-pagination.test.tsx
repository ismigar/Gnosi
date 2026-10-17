import { act } from 'react';
import { describe, expect, it } from 'vitest';

import type { MailMessages } from '../../../shared/api/mail';
import { account, message, mocks, setupMailListTestHarness } from './MailList.test-harness';

const harness = setupMailListTestHarness();

function archivedPage(email: string, count: number, offset = 0): MailMessages {
  const messages = Array.from({ length: count }, (_, index) => ({
    ...message(`imap_${String(index + 1)}`), account: email, source: 'imap',
    imap_folder: 'Archive', imap_uid: String(index + 1), archived: true,
    subject: `${email} archived ${String(index + 1)}`, thread_id: `thread-${String(index + 1)}`,
    timestamp: 1_792_224_000 - index * 60,
  }));
  return {
    messages: messages.slice(offset, offset + 50), total: count,
    next_page_token: offset + 50 < count ? `${email}-page-${String(offset + 50)}` : null,
  };
}

describe('MailList archived multi-account pagination', () => {
  it('continues every healthy archived page while another account is initially unavailable', async () => {
    const unavailable = { email: 'unavailable@example.test' };
    let recovered = false;
    mocks.fetchMessages.mockImplementation(query => {
      if (query.email === unavailable.email && !recovered) {
        return Promise.reject(new Error('Synthetic initial HTTP 503'));
      }
      return Promise.resolve(archivedPage(query.email || '', query.email === account.email ? 121 : 1, query.offset));
    });
    await harness.render({ account: null, accounts: [account, unavailable], folder: 'ARCHIVE' });
    expect(harness.container.querySelector('[data-mail-partial-status="unavailable"]')).not.toBeNull();
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(50);
    await act(async () => { harness.intersect(); await Promise.resolve(); });
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(100);
    await act(async () => { harness.intersect(); await Promise.resolve(); });
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(121);
    expect(harness.container.textContent).toContain(`${account.email} archived 121`);
    expect(mocks.fetchMessages.mock.calls.filter(([query]) => query.email === account.email)
      .map(([query]) => query.offset ?? 0)).toEqual([0, 50, 100]);
    expect(mocks.fetchMessages.mock.calls.filter(([query]) => query.email === unavailable.email)).toHaveLength(1);

    const retry = harness.container.querySelector('[data-mail-partial-status] button');
    if (!(retry instanceof HTMLButtonElement)) throw new Error('Missing unavailable-account retry');
    recovered = true;
    await harness.click(retry);
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(122);
    expect(harness.container.textContent).toContain(`${account.email} archived 121`);
    expect(mocks.fetchMessages.mock.calls.filter(([query]) => query.email === account.email)).toHaveLength(3);
    expect(harness.container.querySelector('[data-mail-partial-status]')).toBeNull();
  });

  it('retries only an initially unavailable account without resetting healthy archive cursors or selection', async () => {
    const unavailable = { email: 'unavailable@example.test' };
    let recovered = false;
    mocks.fetchMessages.mockImplementation(query => {
      if (query.email === unavailable.email && !recovered) {
        return Promise.reject(new Error('Synthetic initial HTTP 503'));
      }
      return Promise.resolve(archivedPage(query.email || '', query.email === account.email ? 121 : 1, query.offset));
    });
    await harness.render({ account: null, accounts: [account, unavailable], folder: 'ARCHIVE' });
    const selected = harness.checkbox();
    await harness.click(selected);
    const retry = harness.container.querySelector('[data-mail-partial-status] button');
    if (!(retry instanceof HTMLButtonElement)) throw new Error('Missing unavailable-account retry');
    await harness.click(retry);
    expect(mocks.fetchMessages.mock.calls.filter(([query]) => query.email === account.email)).toHaveLength(1);
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(50);
    expect(harness.container.querySelector('[data-mail-partial-status]')).not.toBeNull();
    expect(selected.checked).toBe(true);
    recovered = true;
    await harness.click(retry);
    expect(mocks.fetchMessages.mock.calls.filter(([query]) => query.email === account.email)).toHaveLength(1);
    expect(mocks.fetchMessages).toHaveBeenLastCalledWith({
      email: unavailable.email, folder: 'ARCHIVE', force: true, limit: 50,
    }, expect.any(AbortSignal));
    expect(selected.checked).toBe(true);
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(51);
    await act(async () => { harness.intersect(); await Promise.resolve(); });
    expect(mocks.fetchMessages).toHaveBeenLastCalledWith({
      email: account.email, folder: 'ARCHIVE', limit: 50, offset: 50,
      pageToken: `${account.email}-page-50`,
    }, expect.any(AbortSignal));
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(101);
    expect(selected.checked).toBe(true);
  });

  it.each(['provider', 'http'])('isolates an archived %s page failure while healthy pages continue and retries the exact cursor explicitly', async (failure) => {
    const unavailable = { email: 'unavailable@example.test' };
    let recovered = false;
    mocks.fetchMessages.mockImplementation(query => {
      const email = query.email || '';
      if (email === unavailable.email && query.offset === 50 && !recovered) {
        return failure === 'http'
          ? Promise.reject(new Error('Synthetic page HTTP 503'))
          : Promise.resolve({ error: 'Synthetic provider unavailable', messages: [], next_page_token: null, total: 0 });
      }
      return Promise.resolve(archivedPage(email, 121, query.offset));
    });
    await harness.render({ account: null, accounts: [account, unavailable], folder: 'ARCHIVE' });
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(100);
    const selected = harness.checkbox();
    await harness.click(selected);
    await act(async () => { harness.intersect(); await Promise.resolve(); });
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(150);
    expect(harness.container.querySelector('[data-mail-partial-status="unavailable"]')).not.toBeNull();
    await act(async () => { harness.intersect(); await Promise.resolve(); });
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(171);
    expect(mocks.fetchMessages.mock.calls.filter(([query]) => query.email === unavailable.email)
      .map(([query]) => [query.offset ?? 0, query.pageToken ?? null])).toEqual([
      [0, null], [50, `${unavailable.email}-page-50`],
    ]);
    expect(selected.checked).toBe(true);
    const retry = harness.container.querySelector('[data-mail-partial-status] button');
    if (!(retry instanceof HTMLButtonElement)) throw new Error('Missing failed-page retry');
    recovered = true;
    await harness.click(retry);
    expect(mocks.fetchMessages).toHaveBeenLastCalledWith({
      email: unavailable.email, folder: 'ARCHIVE', limit: 50, offset: 50,
      pageToken: `${unavailable.email}-page-50`,
    }, expect.any(AbortSignal));
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(221);
    expect(harness.container.textContent).toContain(`${account.email} archived 121`);
    expect(mocks.fetchMessages.mock.calls.filter(([query]) => query.email === account.email)).toHaveLength(3);
    await act(async () => { harness.intersect(); await Promise.resolve(); });
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(242);
    expect(selected.checked).toBe(true);
    expect(harness.container.querySelector('[data-mail-partial-status]')).toBeNull();
  });

  it('retries mixed initial and page failures together without reloading healthy archived pages', async () => {
    const initialFailure = { email: 'initial@example.test' };
    const pageFailure = { email: 'page@example.test' };
    let recovered = false;
    mocks.fetchMessages.mockImplementation(query => {
      if (!recovered && (query.email === initialFailure.email
        || (query.email === pageFailure.email && query.offset === 50))) {
        return Promise.reject(new Error('Synthetic unavailable account'));
      }
      return Promise.resolve(archivedPage(query.email || '', query.email === initialFailure.email ? 1 : 121, query.offset));
    });
    await harness.render({ account: null, accounts: [account, initialFailure, pageFailure], folder: 'ARCHIVE' });
    await act(async () => { harness.intersect(); await Promise.resolve(); });
    await act(async () => { harness.intersect(); await Promise.resolve(); });
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(171);
    const retry = harness.container.querySelector('[data-mail-partial-status] button');
    if (!(retry instanceof HTMLButtonElement)) throw new Error('Missing mixed-failure retry');
    recovered = true;
    await harness.click(retry);
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(222);
    expect(mocks.fetchMessages.mock.calls.filter(([query]) => query.email === account.email)).toHaveLength(3);
    expect(mocks.fetchMessages.mock.calls.filter(([query]) => query.email === initialFailure.email)
      .map(([query]) => [query.offset ?? 0, Boolean(query.force)])).toEqual([[0, false], [0, true]]);
    expect(mocks.fetchMessages.mock.calls.filter(([query]) => query.email === pageFailure.email)
      .map(([query]) => [query.offset ?? 0, query.pageToken ?? null])).toEqual([
      [0, null], [50, `${pageFailure.email}-page-50`], [50, `${pageFailure.email}-page-50`],
    ]);
    await act(async () => { harness.intersect(); await Promise.resolve(); });
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(243);
    expect(harness.container.querySelector('[data-mail-partial-status]')).toBeNull();
  });

  it('cancels an explicit initial-account retry when the folder scope changes and ignores its late result', async () => {
    const unavailable = { email: 'unavailable@example.test' };
    const scopeAccounts = [account, unavailable];
    let retrying = false;
    let resolveRetry: ((value: MailMessages) => void) | undefined;
    mocks.fetchMessages.mockImplementation(query => {
      if (query.folder === 'SENT') return Promise.resolve({
        messages: query.email === account.email ? [message('new-scope')] : [], next_page_token: null, total: query.email === account.email ? 1 : 0,
      });
      if (query.email === unavailable.email) return retrying
        ? new Promise(resolve => { resolveRetry = resolve; })
        : Promise.reject(new Error('Synthetic unavailable account'));
      return Promise.resolve(archivedPage(account.email, 121, query.offset));
    });
    await harness.render({ account: null, accounts: scopeAccounts, folder: 'ARCHIVE' });
    const retry = harness.container.querySelector('[data-mail-partial-status] button');
    if (!(retry instanceof HTMLButtonElement)) throw new Error('Missing unavailable-account retry');
    retrying = true;
    await harness.click(retry);
    const signal = mocks.fetchMessages.mock.calls.at(-1)?.[1];
    expect(signal?.aborted).toBe(false);
    await harness.rerender({ account: null, accounts: scopeAccounts, folder: 'SENT' });
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolveRetry?.(archivedPage(unavailable.email, 1)); await Promise.resolve(); });
    expect(harness.container.textContent).toContain('Subject new-scope');
    expect(harness.container.textContent).not.toContain(`${unavailable.email} archived`);
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(1);
    expect(harness.container.querySelector('[data-mail-partial-status]')).toBeNull();
  });

});
