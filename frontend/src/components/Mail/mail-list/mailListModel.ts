import { format, isSameDay, parseISO, subDays } from 'date-fns';
import { ca } from 'date-fns/locale';
import type { MailMessagesQuery, MailView } from '../../../shared/api/mail';
import type {
  MailAccount,
  MailListConfig,
  MailListMessage,
} from './mailListTypes';


type MailListTranslate = (key: string, fallback?: string) => string;


export const DEFAULT_MAIL_LIST_CONFIG: MailListConfig = {
  groupBy: 'date',
  showSnippet: true,
  showTimestamp: true,
  sortBy: 'date',
  sortDir: 'desc',
};


export function cleanMailSender(address?: string | null): string {
  const value = address ?? '';
  return value.split('<')[0]?.trim().replace(/^["']+|["']+$/g, '').trim()
    || value;
}


export function enabledMailAccounts(
  accounts: readonly MailAccount[],
): MailAccount[] {
  return accounts.filter((account) => account.enabled !== false);
}


export function accountEmails(
  account: MailAccount | null,
  accounts: readonly MailAccount[],
): string[] {
  if (account?.email) return [account.email];
  return accounts.flatMap((candidate) => {
    const address = candidate.email || candidate.username;
    return address ? [address] : [];
  });
}


export function mailListCacheKey(
  emails: readonly string[],
  folder: string | null,
  category: string | null,
): string {
  return `${emails.join(',')}|${folder || ''}|${category || ''}`;
}


export function buildMailListQuery(
  email: string,
  folder: string | null,
  category: string | null,
  options: {
    readonly force?: boolean;
    readonly offset?: number;
    readonly pageToken?: string | null;
  } = {},
): MailMessagesQuery {
  return {
    email,
    folder: folder === 'NOT_ARCHIVED' ? 'all' : (folder || 'all'),
    limit: 50,
    ...(category ? { category } : {}),
    ...(options.pageToken ? { pageToken: options.pageToken } : {}),
    ...(options.offset ? { offset: options.offset } : {}),
    ...(options.force ? { force: true } : {}),
  };
}


export function filterOutMailThread(
  messages: readonly MailListMessage[],
  messageId: string,
  threadId?: string | null,
): MailListMessage[] {
  return messages.filter((message) => (
    message.id !== messageId
    && !(threadId && threadId !== messageId && message.thread_id === threadId)
  ));
}


function legacyString(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean'
    || typeof value === 'bigint' || typeof value === 'symbol') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => (
      item === null || item === undefined ? '' : legacyString(item)
    )).join(',');
  }
  return Object.prototype.toString.call(value);
}


function filterDate(value: MailView['filters'][number]['value']): number {
  const input = typeof value === 'number' || typeof value === 'string'
    ? value
    : value === null || typeof value === 'boolean'
      ? Number(value)
      : legacyString(value);
  return new Date(input).getTime() / 1000;
}


function applyViewFilter(
  message: MailListMessage,
  filter: MailView['filters'][number],
): boolean {
  const raw = message[filter.field];
  const value = filter.value;
  const text = legacyString(raw ?? '');
  switch (filter.operator) {
    case 'contains':
      return text.toLowerCase().includes(String(value).toLowerCase());
    case 'starts_with':
      return text.toLowerCase().startsWith(String(value).toLowerCase());
    case 'equals':
      return text.toLowerCase() === String(value).toLowerCase();
    case 'is':
      return Boolean(raw) === Boolean(value);
    case 'is_not':
      return Boolean(raw) !== Boolean(value);
    case 'before':
      return message.timestamp < filterDate(value);
    case 'after':
      return message.timestamp > filterDate(value);
    default:
      return true;
  }
}


interface ProcessMessagesOptions {
  readonly activeTagId: string | null;
  readonly activeView: MailView | null;
  readonly config: MailListConfig;
  readonly folder: string | null;
  readonly messageTags: Readonly<Record<string, readonly string[]>>;
  readonly searchQuery: string;
  readonly unreadOnly: boolean;
}


export function processMailListMessages(
  messages: readonly MailListMessage[],
  options: ProcessMessagesOptions,
): MailListMessage[] {
  let result = [...messages];
  if (options.folder === 'NOT_ARCHIVED') {
    result = result.filter((message) => !message.archived);
  }
  if (options.unreadOnly) result = result.filter((message) => !message.is_read);
  if (options.searchQuery.trim()) {
    const query = options.searchQuery.toLowerCase();
    result = result.filter((message) => (
      message.subject.toLowerCase().includes(query)
      || message.sender.toLowerCase().includes(query)
      || message.snippet?.toLowerCase().includes(query)
    ));
  }
  if (options.activeTagId) {
    result = result.filter((message) => (
      options.messageTags[message.id]?.includes(options.activeTagId ?? '')
    ));
  }
  if (options.activeView?.filters.length) {
    const logic = options.activeView.filter_logic || 'AND';
    result = result.filter((message) => {
      const matches = options.activeView?.filters.map(
        (filter) => applyViewFilter(message, filter),
      ) ?? [];
      return logic === 'OR' ? matches.some(Boolean) : matches.every(Boolean);
    });
  } else {
    const filterBy = options.config.filterBy;
    if (filterBy === 'unread') result = result.filter((message) => !message.is_read);
    else if (filterBy === 'starred') result = result.filter((message) => message.is_starred);
    else if (filterBy === 'attachment') result = result.filter((message) => message.has_attachments);
    else if (filterBy === 'not_archived') result = result.filter((message) => !message.archived);
  }
  result.sort((left, right) => {
    let leftValue: number | string;
    let rightValue: number | string;
    if (options.config.sortBy === 'sender') {
      leftValue = left.sender.toLowerCase();
      rightValue = right.sender.toLowerCase();
    } else if (options.config.sortBy === 'subject') {
      leftValue = left.subject.toLowerCase();
      rightValue = right.subject.toLowerCase();
    } else {
      leftValue = left.timestamp;
      rightValue = right.timestamp;
    }
    if (leftValue < rightValue) return options.config.sortDir === 'asc' ? -1 : 1;
    if (leftValue > rightValue) return options.config.sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  return result;
}


export function threadMailListMessages(
  messages: readonly MailListMessage[],
): MailListMessage[] {
  const threads = new Map<string, MailListMessage[]>();
  messages.forEach((message) => {
    const threadId = message.thread_id || message.id;
    const current = threads.get(threadId) ?? [];
    current.push(message);
    threads.set(threadId, current);
  });
  return [...threads.values()].map((threadMessages) => {
    const sorted = [...threadMessages].sort(
      (left, right) => right.timestamp - left.timestamp,
    );
    const latest = sorted[0];
    if (!latest) throw new Error('A mail thread cannot be empty');
    const senders = [...new Set(
      [...threadMessages]
        .sort((left, right) => left.timestamp - right.timestamp)
        .map((message) => cleanMailSender(message.sender)),
    )];
    return {
      ...latest,
      thread_count: threadMessages.length,
      thread_messages: sorted,
      thread_senders: senders,
      thread_unread: threadMessages.filter((message) => !message.is_read).length,
    };
  });
}


export function groupMailListMessages(
  messages: readonly MailListMessage[],
  groupBy: string,
  translate: MailListTranslate,
  now = new Date(),
): Record<string, MailListMessage[]> {
  if (groupBy === 'none') return { '': [...messages] };
  const groups: Record<string, MailListMessage[]> = {};
  messages.forEach((message) => {
    let title: string;
    if (groupBy === 'sender') {
      title = (message.thread_senders?.[0] || message.sender
        || translate('mail.unknown_sender', 'Unknown')).split('<')[0]?.trim() ?? '';
    } else {
      const timestamp = message.timestamp || Date.now() / 1000;
      const date = parseISO(new Date(timestamp * 1000).toISOString());
      const difference = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
      if (isSameDay(date, now)) title = translate('mail.today');
      else if (isSameDay(date, subDays(now, 1))) title = translate('mail.yesterday');
      else if (difference <= 7) title = translate('mail.last_7_days');
      else if (difference <= 30) title = translate('mail.last_30_days');
      else {
        title = format(
          date,
          date.getFullYear() < now.getFullYear() ? 'MMMM yyyy' : 'MMMM',
          { locale: ca },
        );
      }
    }
    (groups[title] ??= []).push(message);
  });
  return groups;
}


export function effectiveMailListConfig(activeView: MailView | null): MailListConfig {
  if (!activeView) return DEFAULT_MAIL_LIST_CONFIG;
  return {
    groupBy: activeView.group_by || 'none',
    showSnippet: DEFAULT_MAIL_LIST_CONFIG.showSnippet,
    showTimestamp: DEFAULT_MAIL_LIST_CONFIG.showTimestamp,
    sortBy: activeView.sort_by || 'date',
    sortDir: activeView.sort_dir || 'desc',
  };
}


export function mailFolderTitleKey(
  folder: string | null,
  category: string | null,
): string {
  const names: Record<string, string> = {
    DRAFTS: 'drafts_title',
    Forums: 'category_forums',
    INBOX: 'inbox_title',
    NOT_ARCHIVED: 'not_archived_title',
    Promotions: 'category_promotions',
    SENT: 'sent_title',
    SPAM: 'spam_title',
    STARRED: 'starred_title',
    Social: 'category_social',
    TRASH: 'trash_title',
    Updates: 'category_updates',
    all: 'all_mail_title',
  };
  return names[folder ?? ''] || names[category ?? ''] || 'inbox_title';
}


export function formatMailListTimestamp(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp * 1000);
  const difference = Math.floor((now - date.getTime()) / 86_400_000);
  return format(date, difference < 1 ? 'HH:mm' : 'd MMM');
}
