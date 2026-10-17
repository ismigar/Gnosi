import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { MailMessages } from '../../../shared/api/mail';
import type { MailListMessage } from './mail-list/mailListTypes';
import {
  account,
  message,
  mocks,
  response,
  setupMailListTestHarness,
} from './MailList.test-harness';

const harness = setupMailListTestHarness();

describe('MailList data loading', () => {
  it('observes the actual scroll root after the first response and continues through every page', async () => {
    let resolveFirst: ((value: MailMessages) => void) | undefined;
    mocks.fetchMessages.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    mocks.fetchMessages.mockImplementation(query => Promise.resolve({
      messages: [message(query.offset === 1 ? 'second' : 'last')],
      next_page_token: null,
      total: 3,
    }));
    await harness.render();
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFirst?.({ messages: [message('first')], next_page_token: null, total: 3 });
      await Promise.resolve();
    });
    const scrollRoot = harness.container.querySelector('[data-role="mail-list-scroll"]');
    expect(scrollRoot?.contains(harness.container.querySelector('[data-role="mail-list-sentinel"]'))).toBe(true);
    expect(harness.intersectionRoot()).toBe(scrollRoot);
    await act(async () => { harness.intersect(); await Promise.resolve(); });
    expect(harness.container.textContent).toContain('Subject second');
    await act(async () => { harness.intersect(); await Promise.resolve(); });
    expect(harness.container.textContent).toContain('Subject last');
    expect(mocks.fetchMessages.mock.calls.map(([query]) => query.offset ?? 0)).toEqual([0, 1, 2]);
    if (!(scrollRoot instanceof HTMLElement)) throw new Error('Missing mail scroll root');
    scrollRoot.scrollTop = 300;
    await harness.rerender({ folder: 'ARCHIVE' });
    expect(scrollRoot.scrollTop).toBe(0);
    expect(mocks.fetchMessages).toHaveBeenLastCalledWith({
      email: account.email, folder: 'ARCHIVE', limit: 50,
    }, expect.any(AbortSignal));
  });

  it('stops automatic pagination on a page that makes no progress and retains its retry cursor', async () => {
    mocks.fetchMessages
      .mockResolvedValueOnce({ messages: [message('first')], next_page_token: 'next', total: 2 })
      .mockResolvedValueOnce({ messages: [], next_page_token: 'next', total: 2 })
      .mockResolvedValueOnce({ messages: [message('last')], next_page_token: null, total: 2 });
    await harness.render();
    await act(async () => { harness.intersect(); await Promise.resolve(); });
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(2);
    const retry = harness.container.querySelector('[data-mail-partial-status] button');
    if (!(retry instanceof HTMLButtonElement)) throw new Error('Missing stalled-page retry');
    expect(harness.container.textContent).toContain('Subject first');
    await harness.click(retry);
    expect(mocks.fetchMessages).toHaveBeenLastCalledWith({
      email: account.email, folder: 'SENT', limit: 50, offset: 1, pageToken: 'next',
    }, expect.any(AbortSignal));
    expect(harness.container.textContent).toContain('Subject last');
  });

  it('debounces provider search, cancels stale queries and keeps body-only matches', async () => {
    vi.useFakeTimers();
    try {
      let resolveOld: ((value: MailMessages) => void) | undefined;
      let staleSignal: AbortSignal | undefined;
      mocks.fetchMessages.mockImplementation((query, signal) => {
        if (query.search === 'older evidence') {
          staleSignal = signal;
          return new Promise(resolve => { resolveOld = resolve; });
        }
        return Promise.resolve({
          messages: [message(query.search ? 'body-only-hit' : 'initial')],
          next_page_token: null, total: 1,
        });
      });
      await harness.render();
      await harness.rerender({ searchQuery: 'old' });
      await harness.rerender({ searchQuery: 'older evidence' });
      await act(async () => { await vi.advanceTimersByTimeAsync(249); });
      expect(mocks.fetchMessages).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(mocks.fetchMessages).toHaveBeenLastCalledWith({
        email: account.email, folder: 'SENT', limit: 50, search: 'older evidence',
      }, expect.any(AbortSignal));
      await harness.rerender({ searchQuery: 'newer evidence' });
      await act(async () => { await vi.advanceTimersByTimeAsync(250); });
      expect(staleSignal?.aborted).toBe(true);
      expect(harness.container.textContent).toContain('Subject body-only-hit');
      await act(async () => {
        resolveOld?.({ messages: [message('stale')], next_page_token: null, total: 1 });
        await Promise.resolve();
      });
      expect(harness.container.textContent).not.toContain('Subject stale');
      expect(mocks.writeCache).toHaveBeenLastCalledWith(
        'one@example.com|SENT||search="newer evidence"', [message('body-only-hit')],
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not prefetch remote folders while opening the inbox', async () => {
    await harness.render({ folder: 'INBOX' });
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(1);
    expect(mocks.fetchMessages).toHaveBeenCalledWith(
      {
        email: account.email,
        folder: 'INBOX',
        limit: 50,
      },
      expect.any(AbortSignal),
    );
  });

  it('waits for account discovery and loads every account without opening the selector', async () => {
    const secondAccount = { email: 'two@example.com' };
    mocks.fetchMessages.mockImplementation((query) =>
      Promise.resolve(
        response([
          {
            ...message('shared'),
            account: query.email,
            subject:
              query.email === account.email
                ? 'First account item'
                : 'Second account item',
          },
        ]),
      ),
    );

    await harness.render({
      account: null,
      accounts: [],
      accountsLoading: true,
    });
    expect(harness.container.textContent).toContain('mail.syncing');
    expect(harness.container.textContent).not.toContain('mail.no_messages');
    expect(mocks.fetchMessages).not.toHaveBeenCalled();

    await harness.rerender({
      account: null,
      accounts: [account, secondAccount],
      accountsLoading: false,
    });

    expect(mocks.fetchMessages).toHaveBeenCalledTimes(2);
    expect(harness.container.textContent).toContain('First account item');
    expect(harness.container.textContent).toContain('Second account item');
  });

  it('keeps successful aggregate rows when another synthetic account fails', async () => {
    mocks.fetchMessages.mockImplementation((query) =>
      query.email === account.email
        ? Promise.resolve(response([message('available')]))
        : Promise.reject(new Error('synthetic account unavailable')),
    );

    await harness.render({
      account: null,
      accounts: [account, { email: 'two@example.com' }],
    });

    expect(harness.container.textContent).toContain('Subject available');
    expect(harness.container.textContent).not.toContain('mail.no_messages');
  });

  it('publishes a ready account before a slow account settles and reports partial availability', async () => {
    let resolveSlowAccount: ((value: MailMessages) => void) | undefined;
    mocks.fetchMessages.mockImplementation((query) =>
      query.email === account.email
        ? Promise.resolve(response([message('available')]))
        : new Promise<MailMessages>((resolve) => {
            resolveSlowAccount = resolve;
          }),
    );

    await harness.render({
      account: null,
      accounts: [account, { email: 'two@example.com' }],
    });

    expect(harness.container.textContent).toContain('Subject available');
    expect(
      harness.button('common.refresh').querySelector('svg')?.getAttribute('class'),
    ).toContain('animate-spin');
    expect(
      harness.container.querySelector('[data-mail-partial-status]'),
    ).toBeNull();

    await act(async () => {
      resolveSlowAccount?.({
        error: 'synthetic provider timeout',
        messages: [],
        next_page_token: null,
        total: 0,
      });
      await Promise.resolve();
    });

    expect(
      harness.container.querySelector(
        '[data-mail-partial-status="unavailable"]',
      ),
    ).not.toBeNull();
    expect(harness.container.textContent).toContain(
      'mail.some_accounts_temporarily_unavailable',
    );
    expect(harness.container.textContent).toContain('Subject available');
    expect(harness.container.textContent).not.toContain(
      'synthetic provider timeout',
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(['provider', 'http'])('publishes each page and retries a %s failure without losing its cursor or selection', async (failure) => {
    const secondAccount = { email: 'two@example.com' };
    const onSelectMail = vi.fn<(mail: MailListMessage) => void>();
    let resolveSlow: ((value: MailMessages) => void) | undefined;
    let rejectSlow: ((error: Error) => void) | undefined;
    const slowPage = new Promise<MailMessages>((resolve, reject) => {
      resolveSlow = resolve;
      rejectSlow = reject;
    });
    let retrying = false;
    mocks.fetchMessages.mockImplementation(query => {
      if (!query.email) throw new Error('Expected an account-scoped mail request');
      if (!query.offset) {
        return Promise.resolve(response([
          { ...message(`${query.email}-first`), account: query.email },
        ], `${query.email}-next`));
      }
      if (query.email === account.email || retrying) {
        return Promise.resolve(response([
          { ...message(`${query.email}-second`), account: query.email },
        ]));
      }
      return slowPage;
    });
    await harness.render({ account: null, accounts: [account, secondAccount], onSelectMail });
    const selected = harness.checkbox();
    await harness.click(selected);
    expect(selected.checked).toBe(true);

    await act(async () => {
      harness.intersect();
      await Promise.resolve();
    });
    expect(harness.container.textContent).toContain(`Subject ${account.email}-second`);
    expect(harness.container.textContent).not.toContain(`Subject ${secondAccount.email}-second`);
    expect(selected.checked).toBe(true);
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(4);

    await act(async () => {
      if (failure === 'provider') {
        resolveSlow?.({ error: 'Synthetic timeout', messages: [], next_page_token: null, total: 0 });
      } else {
        rejectSlow?.(new Error('Synthetic unavailable server'));
      }
      await Promise.resolve();
    });
    const banner = harness.container.querySelector('[data-mail-partial-status="unavailable"]');
    expect(banner).not.toBeNull();
    expect(harness.container.textContent).toContain(`Subject ${secondAccount.email}-first`);
    expect(selected.checked).toBe(true);
    const retry = banner?.querySelector('button');
    if (!(retry instanceof HTMLButtonElement)) throw new Error('Missing page retry');
    retrying = true;
    await harness.click(retry);

    expect(mocks.fetchMessages).toHaveBeenCalledTimes(5);
    expect(mocks.fetchMessages).toHaveBeenLastCalledWith({
      email: secondAccount.email, folder: 'SENT', limit: 50, offset: 1,
      pageToken: `${secondAccount.email}-next`,
    }, expect.any(AbortSignal));
    expect(harness.container.textContent).toContain(`Subject ${account.email}-second`);
    expect(harness.container.textContent).toContain(`Subject ${secondAccount.email}-second`);
    expect(harness.container.querySelectorAll('[data-mail-index]')).toHaveLength(4);
    expect(harness.container.querySelector('[data-mail-partial-status]')).toBeNull();
    expect(selected.checked).toBe(true);
    expect(onSelectMail).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('refreshes with force on push and removes messages through the viewer seam', async () => {
    await harness.render();
    const refresh = mocks.streamListen.mock.calls.find(
      ([name]) => name === 'flags_changed',
    )?.[1];
    await act(async () => {
      refresh?.();
      await Promise.resolve();
    });
    expect(mocks.fetchMessages).toHaveBeenLastCalledWith(
      {
        email: account.email,
        folder: 'SENT',
        force: true,
        limit: 50,
      },
      expect.any(AbortSignal),
    );

    await harness.rerender({ removedMail: message('one') });
    expect(harness.container.textContent).not.toContain('Subject one');
    expect(mocks.purgeCache).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'one' }),
    ]);
  });

  it('shows the persistent cache while revalidating and then replaces it', async () => {
    const cached = message('cached');
    mocks.readCache.mockReturnValueOnce([cached]);
    let resolveFresh: (value: MailMessages) => void = () => undefined;
    mocks.fetchMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFresh = resolve;
        }),
    );
    const onMessagesLoaded = vi.fn<
      (messages: readonly MailListMessage[]) => void
    >();
    await harness.render({ onMessagesLoaded });
    expect(harness.container.textContent).toContain('Subject cached');
    expect(onMessagesLoaded).toHaveBeenCalledWith([cached]);

    await act(async () => {
      resolveFresh(response([message('fresh')]));
      await Promise.resolve();
    });

    expect(harness.container.textContent).not.toContain('Subject cached');
    expect(harness.container.textContent).toContain('Subject fresh');
    expect(mocks.writeCache).toHaveBeenCalledWith('one@example.com|SENT|', [
      message('fresh'),
    ]);
  });
});
