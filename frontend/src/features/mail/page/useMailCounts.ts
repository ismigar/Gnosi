import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchMailCounts, type MailCounts } from '../../../shared/api/mail';
import { mailAccountAddress, mergeMailCounts, type MailAccount } from './mailPageModel';

export interface MailCountAccountStatus {
  readonly email: string;
  readonly status: 'pending' | 'ready' | 'unavailable';
  readonly hasPrevious: boolean;
}

interface AccountCounts {
  readonly counts?: MailCounts;
  readonly status: MailCountAccountStatus['status'];
}

export function useMailCounts(accounts: readonly MailAccount[], selectedAccount: MailAccount | null) {
  const emails = useMemo(() => [...new Set(
    (selectedAccount ? [selectedAccount] : accounts.filter(account => account.enabled !== false))
      .map(mailAccountAddress).filter(Boolean),
  )], [accounts, selectedAccount]);
  const [byAccount, setByAccount] = useState<Record<string, AccountCounts>>({});
  const requestRef = useRef<AbortController | null>(null);

  const refreshCounts = useCallback(() => {
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    setByAccount(previous => {
      const next = { ...previous };
      for (const email of emails) next[email] = { ...previous[email], status: 'pending' };
      return next;
    });
    for (const email of emails) {
      void fetchMailCounts(email, request.signal).then(counts => {
        if (request.signal.aborted) return;
        setByAccount(previous => ({ ...previous, [email]: { counts, status: 'ready' } }));
      }).catch(() => {
        if (request.signal.aborted) return;
        // Keep the last successful value, explicitly marked unavailable. A
        // rejected account must never become a successful empty/zero account.
        setByAccount(previous => ({
          ...previous, [email]: { ...previous[email], status: 'unavailable' },
        }));
      });
    }
  }, [emails]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) refreshCounts(); });
    return () => { active = false; requestRef.current?.abort(); };
  }, [refreshCounts]);

  const counts = useMemo(() => mergeMailCounts(emails.flatMap(email => {
    const value = byAccount[email]?.counts;
    return value ? [value] : [];
  })), [byAccount, emails]);
  const countStatuses = useMemo<readonly MailCountAccountStatus[]>(() => emails.map(email => ({
    email,
    status: byAccount[email]?.status ?? 'pending',
    hasPrevious: byAccount[email]?.counts !== undefined && byAccount[email].status !== 'ready',
  })), [byAccount, emails]);

  return { counts, countStatuses, refreshCounts };
}
