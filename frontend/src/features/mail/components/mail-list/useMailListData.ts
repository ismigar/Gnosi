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
  purgeMailListCacheMessages,
  readMailListCache,
  writeMailListCache,
} from './mailListCache';
import {
  accountEmails,
  buildMailListQuery,
  deduplicateMailListMessages,
  enabledMailAccounts,
  filterOutMailThread,
  mailListCacheKey,
} from './mailListModel';
import { mailMessageIdentity } from '../../mailIdentity';
import type { MailIdentityMessage } from '../../mailIdentity';
import type { MailAccount, MailListMessage } from './mailListTypes';


interface UseMailListDataOptions {
  readonly account: MailAccount | null;
  readonly accountsLoading: boolean;
  readonly accounts: readonly MailAccount[];
  readonly category: string | null;
  readonly folder: string | null;
  readonly listRefreshToken: number;
  readonly onMessagesLoaded?: (messages: readonly MailListMessage[]) => void;
  readonly readMail: MailIdentityMessage | null;
  readonly removedMail: MailIdentityMessage | null;
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


export function markMailReadInList(
  messages: readonly MailListMessage[],
  target: MailIdentityMessage,
): MailListMessage[] {
  const identity = mailMessageIdentity(target);
  return messages.map((message) => (
    mailMessageIdentity(message) === identity
      ? { ...message, is_read: true }
      : message
  ));
}


export function useMailListData({
  account,
  accountsLoading,
  accounts,
  category,
  folder,
  listRefreshToken,
  onMessagesLoaded,
  readMail,
  removedMail,
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
  const fetchAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);

  const fetchMessages = useCallback((options: FetchMessagesOptions = {}): void => {
    fetchAbortRef.current?.abort();
    loadMoreAbortRef.current?.abort();
    setLoadingMore(false);
    const abortController = new AbortController();
    fetchAbortRef.current = abortController;
    setPageTokens({});
    setOffsets({});
    setTotals({});
    if (emails.length === 0) {
      setMessages([]);
      setLoading(accountsLoading);
      if (!accountsLoading) onMessagesLoaded?.([]);
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
        ), abortController.signal);
      } catch (error) {
        if (abortController.signal.aborted) throw error;
        return EMPTY_MAIL_MESSAGES;
      }
    })).then((results) => {
      if (abortController.signal.aborted) return;
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

      const merged = deduplicateMailListMessages(
        results.flatMap((result) => result.messages),
      );
      messageCacheRef.current[cacheKey] = merged;
      writeMailListCache(cacheKey, merged);
      setMessages(merged);
      setLoading(false);
      setSyncing(false);
      onMessagesLoaded?.(merged);

    }).catch(() => {
      if (abortController.signal.aborted) return;
      setLoading(false);
      setSyncing(false);
    });
  }, [accountsLoading, cacheKey, category, emails, folder, onMessagesLoaded]);

  const hasMore = emails.some((email) => (
    Boolean(pageTokens[email])
    || Boolean(totals[email] && (offsets[email] ?? 0) < (totals[email] ?? 0))
  ));

  const loadMore = useCallback((): void => {
    if (loadingMore) return;
    loadMoreAbortRef.current?.abort();
    const abortController = new AbortController();
    loadMoreAbortRef.current = abortController;
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
        ), abortController.signal);
      } catch (error) {
        if (abortController.signal.aborted) throw error;
        return EMPTY_MAIL_MESSAGES;
      }
    })).then((results) => {
      if (abortController.signal.aborted) return;
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
        return deduplicateMailListMessages([
          ...current,
          ...results.flatMap((result) => result.messages),
        ]);
      });
      setLoadingMore(false);
    }).catch(() => {
      if (abortController.signal.aborted) return;
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
      fetchAbortRef.current?.abort();
      loadMoreAbortRef.current?.abort();
    };
  }, [account, accounts, accountsLoading, cacheKey]);

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
    if (!removedMail) return;
    setMessages((current) => {
      Object.entries(messageCacheRef.current).forEach(([key, cached]) => {
        messageCacheRef.current[key] = filterOutMailThread(cached, removedMail);
      });
      purgeMailListCacheMessages([removedMail]);
      return filterOutMailThread(current, removedMail);
    });
  }, [removedMail]);

  useEffect(() => {
    if (!readMail) return;
    queueMicrotask(() => {
      setMessages((current) => markMailReadInList(current, readMail));
    });
  }, [readMail]);

  useEffect(() => {
    if (listRefreshToken <= 0) return;
    queueMicrotask(() => {
      fetchRef.current({ force: true });
    });
  }, [listRefreshToken]);

  const purgeMessageFromCaches = useCallback((message: MailListMessage): void => {
    Object.entries(messageCacheRef.current).forEach(([key, cached]) => {
      messageCacheRef.current[key] = filterOutMailThread(cached, message);
    });
    purgeMailListCacheMessages([message]);
  }, []);

  const purgeMessagesFromCaches = useCallback((targets: readonly MailListMessage[]): void => {
    const selected = new Set(targets.map((message) => mailMessageIdentity(message)));
    Object.entries(messageCacheRef.current).forEach(([key, cached]) => {
      messageCacheRef.current[key] = cached.filter(
        (message) => !selected.has(mailMessageIdentity(message)),
      );
    });
    purgeMailListCacheMessages(targets);
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
