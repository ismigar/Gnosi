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
