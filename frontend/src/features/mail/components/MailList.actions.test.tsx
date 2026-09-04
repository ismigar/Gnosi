import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { dispatchWindowEvent } from '../../../shared/platform/browser-events';
import { mailListMessageIdentity } from './mail-list/mailListModel';
import type { MailListMessage } from './mail-list/mailListTypes';
import {
  account,
  message,
  mocks,
  response,
  setupMailListTestHarness,
} from './MailList.test-harness';

const harness = setupMailListTestHarness();

describe('MailList message actions', () => {
  it('loads pages, preserves the cursor query and batches a selected message', async () => {
    const onBatchDone = vi.fn<() => void>();
    mocks.fetchMessages
      .mockResolvedValueOnce(response([message('one')], 'next'))
      .mockResolvedValueOnce(response([message('two')]));
    await harness.render({ onBatchDone });
    expect(harness.container.textContent).toContain('Subject one');

    await act(async () => {
      harness.intersect();
      await Promise.resolve();
    });
    expect(mocks.fetchMessages).toHaveBeenLastCalledWith(
      {
        email: account.email,
        folder: 'SENT',
        limit: 50,
        offset: 1,
        pageToken: 'next',
      },
      expect.any(AbortSignal),
    );
    expect(harness.container.textContent).toContain('Subject two');
    await harness.click(harness.checkbox());
    await harness.click(harness.button('Mark as read'));

    expect(mocks.batch).toHaveBeenCalledWith(account.email, 'read', ['one']);
    expect(onBatchDone).toHaveBeenCalledOnce();
  });

  it('selects colliding provider ids independently across accounts', async () => {
    const onSelectMail = vi.fn<(mail: MailListMessage) => void>();
    const firstMessage = { ...message('shared'), account: account.email };
    mocks.fetchMessages.mockImplementation((query) =>
      Promise.resolve(
        response([
          {
            ...message('shared'),
            account: query.email,
            subject:
              query.email === account.email
                ? 'First scoped item'
                : 'Second scoped item',
          },
        ]),
      ),
    );
    await harness.render({
      account: null,
      accounts: [account, { email: 'two@example.com' }],
      onSelectMail,
      selectedMailIdentity: mailListMessageIdentity(firstMessage),
    });
    const checkboxes = [
      ...harness.container.querySelectorAll<HTMLInputElement>(
        'input[aria-label]',
      ),
    ];
    expect(checkboxes).toHaveLength(2);
    const first = checkboxes[0];
    if (!(first instanceof HTMLInputElement)) {
      throw new Error('Missing first checkbox');
    }
    await harness.click(first);

    expect(harness.container.textContent).toContain('1 mail.selected');
    expect(checkboxes[0]?.checked).toBe(true);
    expect(checkboxes[1]?.checked).toBe(false);
    await harness.click(harness.button('Mark as read'));
    expect(mocks.batch).toHaveBeenCalledWith(account.email, 'read', ['shared']);
    expect(mocks.batch).not.toHaveBeenCalledWith(
      'two@example.com',
      'read',
      ['shared'],
    );
    const rows = [
      ...harness.container.querySelectorAll<HTMLElement>('[data-mail-index]'),
    ];
    expect(
      rows.filter((row) => row.className.includes('mail-row-selected')),
    ).toHaveLength(1);
    const secondRow = rows.at(1);
    if (!secondRow) throw new Error('Missing second scoped row');
    await harness.click(secondRow);
    expect(onSelectMail).toHaveBeenCalledWith(
      expect.objectContaining({ account: 'two@example.com', id: 'shared' }),
    );
    act(() => {
      secondRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    const contextArchive = [
      ...harness.container.querySelectorAll('button'),
    ].find((candidate) =>
      candidate.textContent.includes('mail.archive_action'),
    );
    if (!contextArchive) throw new Error('Missing scoped context action');
    await harness.click(contextArchive);
    expect(mocks.archive).toHaveBeenCalledWith('shared', 'two@example.com');
  });

  it('restores an optimistically archived message if its batch request fails', async () => {
    mocks.batch.mockRejectedValueOnce(new Error('offline'));
    await harness.render();
    await harness.click(harness.checkbox());
    await harness.click(harness.button('Archive selected'));

    expect(mocks.purgeCache).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'one' }),
    ]);
    expect(harness.container.textContent).toContain('Subject one');
    expect(mocks.error).toHaveBeenCalled();
  });

  it('keeps keyboard selection and open callbacks behind the shared event adapter', async () => {
    const onSelectMail = vi.fn<(mail: MailListMessage) => void>();
    await harness.render({ onSelectMail });
    await act(async () => {
      dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      await Promise.resolve();
    });
    await act(async () => {
      dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await Promise.resolve();
    });

    expect(onSelectMail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'one' }),
    );
  });

  it('preserves move payloads and restores the message on a move error', async () => {
    mocks.move.mockRejectedValueOnce(new Error('move failed'));
    await harness.render();
    await harness.click(harness.button('Move to folder'));
    const destination = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent.includes('Projects'),
    );
    if (!destination) throw new Error('Missing move destination');
    await harness.click(destination);

    expect(mocks.move).toHaveBeenCalledWith('one', account.email, {
      imap_folder: 'SENT',
      imap_uid: 'uid-one',
      target_folder: 'Projects',
    });
    expect(harness.container.textContent).toContain('Subject one');
    expect(mocks.error).toHaveBeenCalledWith('move failed');
  });

  it('confirms folder emptying and forces a fresh list only after success', async () => {
    await harness.render({ folder: 'TRASH' });
    await harness.click(harness.button('Empty trash'));
    const confirm = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent.trim() === 'Confirm',
    );
    if (!confirm) throw new Error('Missing empty-folder confirmation');
    await harness.click(confirm);

    expect(mocks.emptyFolder).toHaveBeenCalledWith(account.email, 'TRASH');
    expect(mocks.fetchMessages).toHaveBeenLastCalledWith(
      {
        email: account.email,
        folder: 'TRASH',
        force: true,
        limit: 50,
      },
      expect.any(AbortSignal),
    );
    expect(mocks.success).toHaveBeenCalledWith('Trash emptied');
  });
});
