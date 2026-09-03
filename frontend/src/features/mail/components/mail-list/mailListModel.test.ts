import { describe, expect, it } from 'vitest';

import type { MailView } from '../../../../shared/api/mail';
import {
  accountEmails,
  buildMailListQuery,
  deduplicateMailListMessages,
  filterOutMailThread,
  groupMailListMessages,
  processMailListMessages,
  threadMailListMessages,
} from './mailListModel';
import type { MailListMessage } from './mailListTypes';


function message(
  id: string,
  overrides: Partial<MailListMessage> = {},
): MailListMessage {
  return {
    date: '2026-08-30T10:00:00Z',
    has_attachments: false,
    id,
    is_read: false,
    is_starred: false,
    sender: 'sender@example.com',
    snippet: '',
    subject: id,
    thread_id: id,
    timestamp: 1_777_546_800,
    ...overrides,
  };
}


const view: MailView = {
  actions: [],
  created_at: null,
  fields: [],
  filter_logic: 'AND',
  filters: [{ field: 'sender', operator: 'contains', value: 'team' }],
  group_by: 'sender',
  id: 'view-one',
  name: 'Team',
  sort_by: 'subject',
  sort_dir: 'asc',
  updated_at: null,
};


describe('mail list model', () => {
  it('builds account and pagination queries without changing folder semantics', () => {
    expect(accountEmails(null, [
      { email: 'one@example.com' },
      { email: 'ONE@example.com' },
      { username: 'two@example.com' },
    ])).toEqual(['one@example.com', 'two@example.com']);
    expect(buildMailListQuery(
      'one@example.com',
      'NOT_ARCHIVED',
      'Updates',
      { force: true, offset: 50, pageToken: 'next' },
    )).toEqual({
      category: 'Updates',
      email: 'one@example.com',
      folder: 'all',
      force: true,
      limit: 50,
      offset: 50,
      pageToken: 'next',
    });
  });

  it('removes only exact provider copies without colliding IMAP UIDs by scope', () => {
    const original = message('imap_42', {
      account: 'one@example.com',
      imap_folder: 'INBOX',
      imap_uid: '42',
      recipient: 'reader@example.com',
      sender: 'Sender <sender@example.com>',
      source: 'imap',
      subject: 'Same delivery',
      timestamp: 123,
    });
    const duplicateUid = message('imap_43', {
      ...original,
      id: 'imap_43',
      imap_uid: '43',
    });
    const otherAccount = message('imap_42', {
      ...original,
      account: 'two@example.com',
    });
    const otherFolder = message('imap_42', {
      ...original,
      imap_folder: 'Archive',
    });

    expect(deduplicateMailListMessages([
      original,
      duplicateUid,
      original,
      otherAccount,
      otherFolder,
    ])).toEqual([original, duplicateUid, otherAccount, otherFolder]);
  });

  it('never merges distinct account deliveries by Internet identity or display metadata', () => {
    const first = message('imap_7', {
      account: 'one@example.com',
      imap_folder: 'INBOX',
      imap_uid: '7',
      internet_message_id: '<delivery@example.test>',
      recipient: 'one@example.com',
      sender: 'Sender <sender@example.com>',
      source: 'imap',
      subject: 'Shared subject',
      timestamp: 100,
    });
    const mirrored = message('imap_91', {
      ...first,
      account: 'two@example.com',
      id: 'imap_91',
      imap_uid: '91',
      recipient: 'two@example.com',
      timestamp: 120,
    });
    const distinct = message('imap_92', {
      ...mirrored,
      id: 'imap_92',
      imap_uid: '92',
    });

    expect(deduplicateMailListMessages([first, mirrored, distinct])).toEqual([
      first,
      mirrored,
      distinct,
    ]);
  });

  it('fails open when provider identity is incomplete', () => {
    const first = message('same', { account: 'one@example.com' });
    const second = message('same', { account: 'one@example.com' });

    expect(deduplicateMailListMessages([first, second])).toEqual([first, second]);
  });

  it('applies search, tag, unread and advanced filters before sorting', () => {
    const messages = [
      message('b', { sender: 'team@example.com', subject: 'Zulu' }),
      message('a', { sender: 'team@example.com', subject: 'Alpha' }),
      message('c', { is_read: true, sender: 'other@example.com', subject: 'Alpha' }),
    ];

    expect(processMailListMessages(messages, {
      activeTagId: 'important',
      activeView: view,
      config: {
        groupBy: 'sender',
        showSnippet: true,
        showTimestamp: true,
        sortBy: 'subject',
        sortDir: 'asc',
      },
      folder: 'INBOX',
      messageTags: { a: ['important'], b: ['important'] },
      searchQuery: 'a',
      unreadOnly: true,
    }).map((candidate) => candidate.id)).toEqual(['a', 'b']);
  });

  it('removes full threads and derives newest thread summaries', () => {
    const messages = [
      message('one', { account: 'one@example.com', sender: 'First <first@example.com>', source: 'gmail', thread_id: 'thread', timestamp: 1 }),
      message('two', { account: 'one@example.com', is_read: true, sender: 'Second <second@example.com>', source: 'gmail', thread_id: 'thread', timestamp: 2 }),
      message('three', { account: 'one@example.com', source: 'gmail' }),
    ];

    expect(filterOutMailThread(messages, 'two', 'thread').map((candidate) => candidate.id))
      .toEqual(['three']);
    const threaded = threadMailListMessages(messages);
    expect(threaded[0]).toMatchObject({
      id: 'two',
      thread_count: 2,
      thread_senders: ['First', 'Second'],
      thread_unread: 1,
    });
  });

  it('scopes provider threads by account and IMAP folder', () => {
    const first = message('imap_1', {
      account: 'one@example.com',
      imap_folder: 'INBOX',
      imap_uid: '1',
      source: 'imap',
      thread_id: 'shared-thread',
    });
    const otherAccount = message('imap_1', {
      ...first,
      account: 'two@example.com',
    });
    const otherFolder = message('imap_1', {
      ...first,
      imap_folder: 'Archive',
    });

    expect(threadMailListMessages([first, otherAccount, otherFolder])).toHaveLength(3);
    expect(filterOutMailThread(
      [first, otherAccount, otherFolder],
      first.id,
      first.thread_id,
      first,
    )).toEqual([otherAccount, otherFolder]);
  });

  it('keeps date grouping labels localized', () => {
    const translate = (key: string): string => key;
    const groups = groupMailListMessages(
      [message('today', { timestamp: Date.parse('2026-08-30T10:00:00Z') / 1000 })],
      'date',
      translate,
      new Date('2026-08-30T12:00:00Z'),
    );

    expect(Object.keys(groups)).toEqual(['mail.today']);
  });
});
