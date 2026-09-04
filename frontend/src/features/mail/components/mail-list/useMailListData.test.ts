import { describe, expect, it } from 'vitest';

import { filterOutMailThread } from './mailListModel';
import type { MailListMessage } from './mailListTypes';
import { markMailReadInList } from './useMailListData';


function message(
  account: string,
  folder: string,
  read = false,
): MailListMessage {
  return {
    account,
    date: '2026-09-03T10:00:00Z',
    has_attachments: false,
    id: 'shared-id',
    imap_folder: folder,
    imap_uid: '42',
    is_read: read,
    is_starred: false,
    sender: 'Synthetic sender',
    snippet: 'Synthetic preview',
    source: 'imap',
    subject: 'Synthetic subject',
    thread_id: 'shared-thread',
    timestamp: 1_788_429_600,
  };
}


describe('mail list structural events', () => {
  it('marks read only the exact account and folder scope', () => {
    const target = message('first@example.test', 'INBOX');
    const otherAccount = message('second@example.test', 'INBOX');
    const otherFolder = message('first@example.test', 'Archive');
    const updated = markMailReadInList([target, otherAccount, otherFolder], target);

    expect(updated.map((item) => item.is_read)).toEqual([true, false, false]);
  });

  it('removes only the exact scoped thread', () => {
    const target = message('first@example.test', 'INBOX');
    const otherAccount = message('second@example.test', 'INBOX');
    const otherFolder = message('first@example.test', 'Archive');

    expect(filterOutMailThread([target, otherAccount, otherFolder], target))
      .toEqual([otherAccount, otherFolder]);
  });
});
