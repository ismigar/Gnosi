import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { toast } from '../../../../shared/notifications/toast';
import {
  fetchMailMessages,
  type MailMessages,
} from '../../../../shared/api/mail';
import { mailEventsUrl } from '../../../../shared/api/mail-specialized';
import { openEventStream } from '../../../../shared/api/specialized-transports';
import {
  purgeMailListCacheIds,
  readMailListCache,
  writeMailListCache,
} from './mailListCache';
import {
  accountEmails,
  buildMailListQuery,
  enabledMailAccounts,
  filterOutMailThread,
  mailListCacheKey,
} from './mailListModel';
import type { MailAccount, MailListMessage } from './mailListTypes';


interface UseMailListDataOptions {
  readonly account: MailAccount | null;
  readonly accounts: readonly MailAccount[];
  readonly category: string | null;
  readonly folder: string | null;
  readonly listRefreshToken: number;
  readonly onMessagesLoaded?: (messages: readonly MailListMessage[]) => void;
  readonly readMailId: string | null;
  readonly removedMailId: string | null;
}


interface FetchMessagesOptions {
  readonly force?: boolean;
}


type NumberByAccount = Record<string, number>;
type TokenByAccount = Record<string, string | null>;
type MessageMemoryCache = Record<string, MailListMessage[]>;


const EMPTY_MAIL_MESSAGES: MailMessages = {
  messages: [],
  next_page_token: null,
  total: 0,
};


function uniqueMessages(messages: readonly MailListMessage[]): MailListMessage[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (!message.id || seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}


export function useMailListData({
  account,
  accounts,
  category,
  folder,
  listRefreshToken,
  onMessagesLoaded,
  readMailId,
  removedMailId,
}: UseMailListDataOptions) {
  const enabledAccounts = useMemo(() => enabledMailAccounts(accounts), [accounts]);
  const emails = useMemo(
    () => accountEmails(account, enabledAccounts),
    [account, enabledAccounts],
  );
  const cacheKey = useMemo(
    () => mailListCacheKey(emails, folder, category),
    [category, emails, folder],
  );
  const [messages, setMessages] = useState<MailListMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pageTokens, setPageTokens] = useState<TokenByAccount>({});
  const [offsets, setOffsets] = useState<NumberByAccount>({});
  const [totals, setTotals] = useState<NumberByAccount>({});
  const messageCacheRef = useRef<MessageMemoryCache>({});

  const fetchMessages = useCallback((options: FetchMessagesOptions = {}): void => {
    setPageTokens({});
    setOffsets({});
    setTotals({});
    if (emails.length === 0) {
      setMessages([]);
      setLoading(false);
      onMessagesLoaded?.([]);
      return;
    }

    const stale = messageCacheRef.current[cacheKey]
      || (!options.force && readMailListCache(cacheKey));
    if (stale && !options.force) {
      setMessages(stale);
      setLoading(false);
      onMessagesLoaded?.(stale);
      setSyncing(true);
    } else {
      setLoading(true);
    }

    void Promise.all(emails.map(async (email) => {
      try {
        return await fetchMailMessages(buildMailListQuery(
          email,
          folder,
          category,
          { force: options.force },
        ));
      } catch {
        return EMPTY_MAIL_MESSAGES;
      }
    })).then((results) => {
      const newTokens: TokenByAccount = {};
      const newOffsets: NumberByAccount = {};
      const newTotals: NumberByAccount = {};
      results.forEach((result, index) => {
        const email = emails[index];
        if (!email) return;
        newTokens[email] = result.next_page_token;
        newTotals[email] = result.total;
        newOffsets[email] = result.messages.length;
        if (result.error) toast.error(result.error, { duration: 6000 });
      });
      setPageTokens(newTokens);
      setOffsets(newOffsets);
      setTotals(newTotals);

      const merged = uniqueMessages(results.flatMap((result) => result.messages));
      messageCacheRef.current[cacheKey] = merged;
      writeMailListCache(cacheKey, merged);
      setMessages(merged);
      setLoading(false);
      setSyncing(false);
      onMessagesLoaded?.(merged);

      if ((folder === 'INBOX' || !folder) && !options.force) {
        ['SENT', 'DRAFTS', 'TRASH'].forEach((prefetchFolder) => {
          const prefetchKey = mailListCacheKey(emails, prefetchFolder, null);
          if (messageCacheRef.current[prefetchKey]) return;
          void Promise.all(emails.map(async (email) => {
            try {
              return await fetchMailMessages({
                email,
                folder: prefetchFolder,
                limit: 50,
              });
            } catch {
              return EMPTY_MAIL_MESSAGES;
            }
          })).then((prefetchResults) => {
            const prefetched = uniqueMessages(
              prefetchResults.flatMap((result) => result.messages),
            );
            messageCacheRef.current[prefetchKey] = prefetched;
            writeMailListCache(prefetchKey, prefetched);
          }).catch(() => undefined);
        });
      }
    }).catch(() => {
      setLoading(false);
      setSyncing(false);
    });
  }, [cacheKey, category, emails, folder, onMessagesLoaded]);

  const hasMore = emails.some((email) => (
    Boolean(pageTokens[email])
    || Boolean(totals[email] && (offsets[email] ?? 0) < (totals[email] ?? 0))
  ));

  const loadMore = useCallback((): void => {
    if (loadingMore) return;
    setLoadingMore(true);
    void Promise.all(emails.map(async (email) => {
      const token = pageTokens[email];
      const offset = offsets[email] ?? 0;
      const total = totals[email] ?? 0;
      if (!token && total && offset >= total) {
        return { ...EMPTY_MAIL_MESSAGES, total };
      }
      try {
        return await fetchMailMessages(buildMailListQuery(
          email,
          folder,
          category,
          { offset, pageToken: token },
        ));
      } catch {
        return EMPTY_MAIL_MESSAGES;
      }
    })).then((results) => {
      const newTokens = { ...pageTokens };
      const newOffsets = { ...offsets };
      results.forEach((result, index) => {
        const email = emails[index];
        if (!email) return;
        newTokens[email] = result.next_page_token;
        newOffsets[email] = (newOffsets[email] ?? 0) + result.messages.length;
      });
      setPageTokens(newTokens);
      setOffsets(newOffsets);
      setMessages((current) => {
        const seen = new Set(current.map((message) => message.id));
        const added = results
          .flatMap((result) => result.messages)
          .filter((message) => message.id && !seen.has(message.id));
        return [...current, ...added];
      });
      setLoadingMore(false);
    }).catch(() => {
      setLoadingMore(false);
    });
  }, [category, emails, folder, loadingMore, offsets, pageTokens, totals]);

  const fetchRef = useRef(fetchMessages);
  useEffect(() => {
    fetchRef.current = fetchMessages;
  }, [fetchMessages]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setMessages((current) => (
        messageCacheRef.current[cacheKey] ? current : []
      ));
      fetchRef.current();
    });
    return () => {
      active = false;
    };
  }, [account, accounts, cacheKey]);

  useEffect(() => {
    let stream: EventSource;
    try {
      stream = openEventStream(mailEventsUrl(account?.email ?? undefined));
    } catch {
      return undefined;
    }
    const refresh = (): void => {
      messageCacheRef.current = Object.fromEntries(
        Object.entries(messageCacheRef.current).filter(([key]) => key !== cacheKey),
      );
      fetchRef.current({ force: true });
    };
    stream.addEventListener('new_message', refresh);
    stream.addEventListener('message_removed', refresh);
    stream.addEventListener('flags_changed', refresh);
    stream.onerror = () => undefined;
    return () => {
      try {
        stream.close();
      } catch {
        return;
      }
    };
  }, [account?.email, cacheKey]);

  useEffect(() => {
    if (!removedMailId) return;
    setMessages((current) => {
      const threadId = current.find(
        (message) => message.id === removedMailId,
      )?.thread_id;
      Object.entries(messageCacheRef.current).forEach(([key, cached]) => {
        messageCacheRef.current[key] = filterOutMailThread(
          cached,
          removedMailId,
          threadId,
        );
      });
      purgeMailListCacheIds([removedMailId]);
      return filterOutMailThread(current, removedMailId, threadId);
    });
  }, [removedMailId]);

  useEffect(() => {
    if (!readMailId) return;
    queueMicrotask(() => {
      setMessages((current) => current.map((message) => (
        message.id === readMailId ? { ...message, is_read: true } : message
      )));
    });
  }, [readMailId]);

  useEffect(() => {
    if (listRefreshToken <= 0) return;
    queueMicrotask(() => {
      fetchRef.current({ force: true });
    });
  }, [listRefreshToken]);

  const purgeMessageFromCaches = useCallback((
    messageId: string,
    threadId?: string | null,
  ): void => {
    Object.entries(messageCacheRef.current).forEach(([key, cached]) => {
      messageCacheRef.current[key] = filterOutMailThread(
        cached,
        messageId,
        threadId,
      );
    });
    purgeMailListCacheIds([messageId]);
  }, []);

  const purgeMessagesFromCaches = useCallback((ids: readonly string[]): void => {
    const selected = new Set(ids);
    Object.entries(messageCacheRef.current).forEach(([key, cached]) => {
      messageCacheRef.current[key] = cached.filter(
        (message) => !selected.has(message.id),
      );
    });
    purgeMailListCacheIds(ids);
  }, []);

  const clearCurrentMemoryCache = useCallback((): void => {
    messageCacheRef.current[cacheKey] = [];
  }, [cacheKey]);

  return {
    cacheKey,
    clearCurrentMemoryCache,
    emails,
    enabledAccounts,
    fetchMessages,
    hasMore,
    loadMore,
    loading,
    loadingMore,
    messages,
    purgeMessageFromCaches,
    purgeMessagesFromCaches,
    setLoading,
    setMessages,
    syncing,
  };
}
