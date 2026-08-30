import { describe, expect, it } from 'vitest';

import type { MailView } from '../../../../shared/api/mail';
import {
  accountEmails,
  buildMailListQuery,
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
      message('one', { sender: 'First <first@example.com>', thread_id: 'thread', timestamp: 1 }),
      message('two', { is_read: true, sender: 'Second <second@example.com>', thread_id: 'thread', timestamp: 2 }),
      message('three'),
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
