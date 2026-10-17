import { useCallback, useEffect, useEffectEvent, useRef, useState, type SetStateAction } from 'react';

import { fetchMailMessage, fetchMailThread, markMailRead } from '../../../shared/api/mail';
import { useRequestContext } from '../../../shared/hooks/useRequestContext';
import { logError } from '../../../shared/notifications/notifyError';
import {
  hydrateMailMessageIdentity,
  mailContentVersion,
  mailMessageIdentity,
  tryMailMessageIdentity,
} from '../mailIdentity';
import { createMailContentCache } from './mailContentCache';
import { useMailThreadBodies } from './useMailThreadBodies';
import type { MailViewerAccount, MailViewerMessage } from './mailViewerTypes';


interface ReaderInput {
  readonly account: MailViewerAccount | null;
  readonly onMailRead?: (mail: MailViewerMessage) => void;
  readonly selectedMail: MailViewerMessage | null;
}

interface SelectedContent {
  readonly key: string;
  readonly scope: string;
  readonly version: string;
  readonly data: MailViewerMessage | null;
  readonly status: 'loading' | 'ready' | 'error';
}

interface ThreadContent {
  readonly key: string;
  readonly messages: MailViewerMessage[];
  readonly failed: boolean;
}

function contentCacheKey(message: MailViewerMessage, fallbackEmail?: string | null): string | null {
  const identity = tryMailMessageIdentity(message, fallbackEmail);
  return identity ? JSON.stringify([identity, message.id]) : null;
}


function cachedContentFor(cache: ReturnType<typeof createMailContentCache>, key: string | null, version: string) {
  const cached = key ? cache.get(key) : null;
  const cachedVersion = mailContentVersion(cached);
  if (key && version && cachedVersion && version !== cachedVersion) {
    cache.delete(key);
    return null;
  }
  return cached;
}


export function useMailReaderContent({ account, onMailRead, selectedMail }: ReaderInput) {
  const requestContext = useRequestContext();
  const requestScope = JSON.stringify(requestContext);
  const [selected, setSelected] = useState<SelectedContent | null>(null);
  const selectedIdentity = selectedMail ? mailMessageIdentity(selectedMail, account?.email) : null;
  const selectionScope = selectedIdentity ? JSON.stringify([
    requestScope, selectedIdentity, selectedMail?.id,
  ]) : null;
  const previousSelection = selected?.scope === selectionScope ? selected : null;
  const incomingVersion = mailContentVersion(selectedMail);
  const knownVersion = mailContentVersion(previousSelection?.data) || previousSelection?.version || '';
  // Missing headers can enrich an existing request; only a known contradiction
  // replaces it. Keep one cache slot per physical message so sparse headers
  // cannot resurrect an older version after a replacement was loaded.
  const selectionVersion = previousSelection && (!incomingVersion || !knownVersion || incomingVersion === knownVersion)
    ? previousSelection.version : incomingVersion;
  const selectionKey = selectionScope ? JSON.stringify([selectionScope, selectionVersion]) : null;
  const cache = useRef(createMailContentCache());
  const [selectedAttempt, setSelectedAttempt] = useState(0);
  const [thread, setThread] = useState<ThreadContent | null>(null);
  const [threadAttempt, setThreadAttempt] = useState(0);
  const current = selected?.key === selectionKey ? selected : null;
  const mailData = current?.data ?? null;
  const threadId = mailData?.thread_id;
  const threadEmail = mailData?.account || mailData?.account_email || selectedMail?.account
    || selectedMail?.account_email || account?.email || '';
  const threadKey = mailData && selectedMail && selectedMail.source !== 'vault'
    && threadId && threadId !== selectedMail.id && threadEmail
    ? JSON.stringify([selectionKey, threadEmail.trim().toLowerCase(), threadId]) : null;
  const fullThreadMessages = thread?.key === threadKey ? thread.messages : [];
  const localThreadMessages = selectedMail?.thread_messages ?? [];
  const allThreadMessages = fullThreadMessages.length > 0 ? fullThreadMessages
    : localThreadMessages.length > 0 ? localThreadMessages : selectedMail ? [selectedMail] : [];
  // Effect Events read current headers/callbacks without turning a read-flag update
  // or parent callback replacement into a new network request.
  const selectionSnapshot = useEffectEvent(() => ({ selectedMail, fallbackEmail: account?.email }));
  const reportRead = useEffectEvent((message: MailViewerMessage) => { onMailRead?.(message); });

  useEffect(() => { cache.current.clear(); }, [requestScope]);

  useEffect(() => {
    const { selectedMail: message, fallbackEmail } = selectionSnapshot();
    if (!message?.id || !selectionKey || !selectionScope) return undefined;
    const abort = new AbortController();
    const email = message.account || message.account_email || fallbackEmail || '';
    const identity = contentCacheKey(message, fallbackEmail);
    const cached = cachedContentFor(cache.current, identity, selectionVersion);
    const finish = (detail: MailViewerMessage): void => {
      if (abort.signal.aborted) return;
      const data = hydrateMailMessageIdentity(detail, message, email);
      const contentIdentity = identity || contentCacheKey(data, email);
      if (contentIdentity && !cached) cache.current.set(contentIdentity, data);
      setSelected({ key: selectionKey, scope: selectionScope, version: selectionVersion, data, status: 'ready' });
      if (!data.is_read && email) {
        void markMailRead(message.id, email, data.imap_folder || message.imap_folder || undefined)
          .then(() => { if (!abort.signal.aborted) reportRead(message); })
          .catch((error: unknown) => { logError('mail-viewer.mark-read', error); });
      }
    };
    if (cached) {
      queueMicrotask(() => { finish({ ...cached, is_read: message.is_read ?? cached.is_read,
        is_starred: message.is_starred ?? cached.is_starred }); });
    } else {
      queueMicrotask(() => {
        if (!abort.signal.aborted) setSelected({ key: selectionKey, scope: selectionScope, version: selectionVersion, data: null, status: 'loading' });
      });
      void fetchMailMessage(message.id, {
        email: email || undefined, folder: message.imap_folder || undefined,
      }, abort.signal).then(finish).catch((error: unknown) => {
        if (abort.signal.aborted) return;
        logError('mail-viewer.message', error);
        setSelected({ key: selectionKey, scope: selectionScope, version: selectionVersion, data: null, status: 'error' });
      });
    }
    return () => { abort.abort(); };
  }, [selectionKey, selectionScope, selectionVersion, selectedAttempt]);

  const threadSnapshot = useEffectEvent(() => ({ threadId, threadEmail }));
  useEffect(() => {
    if (!threadKey) return undefined;
    const { threadId: id, threadEmail: email } = threadSnapshot();
    if (!id) return undefined;
    const abort = new AbortController();
    queueMicrotask(() => {
      if (!abort.signal.aborted) setThread({ key: threadKey, messages: [], failed: false });
    });
    void fetchMailThread(id, email, abort.signal).then((result) => {
      if (abort.signal.aborted) return;
      const messages = [...result.messages].reverse().map(message => ({
        ...message, account: typeof message.account === 'string' && message.account
          ? message.account : typeof message.account_email === 'string' && message.account_email
            ? message.account_email : email,
      }));
      setThread({ key: threadKey, messages, failed: false });
    }).catch((error: unknown) => {
      if (abort.signal.aborted) return;
      logError('mail-viewer.thread', error);
      setThread({ key: threadKey, messages: [], failed: true });
    });
    return () => { abort.abort(); };
  }, [threadKey, threadAttempt]);

  const setMailData = useCallback((update: SetStateAction<MailViewerMessage | null>): void => {
    setSelected(previous => previous?.key === selectionKey ? {
      ...previous, data: typeof update === 'function' ? update(previous.data) : update,
    } : previous);
  }, [selectionKey, setSelected]);

  const threadBodies = useMailThreadBodies({
    accountEmail: account?.email, cache, mailData, messages: allThreadMessages,
    selectedMail, selectionKey, setMailData,
  });

  const retryMessage = (): void => {
    if (selectedMail) {
      const identity = contentCacheKey(selectedMail, account?.email);
      if (identity) cache.current.delete(identity);
    }
    setSelectedAttempt(value => value + 1);
  };

  return {
    allThreadMessages, ...threadBodies,
    loading: Boolean(selectedMail && (!current || current.status === 'loading')),
    mailData, messageError: current?.status === 'error', retryMessage,
    retryThread: (): void => { setThreadAttempt(value => value + 1); },
    setMailData, threadError: thread?.key === threadKey && thread.failed,
  };
}
