import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';

import { fetchMailMessage } from '../../../shared/api/mail';
import { logError } from '../../../shared/notifications/notifyError';
import { canUseMailBody, hydrateMailMessageIdentity, isSameMailMessage, isSelectedMailBody, mailContentVersion, mailMessageIdentity, tryMailMessageIdentity } from '../mailIdentity';
import type { createMailContentCache } from './mailContentCache';
import type { MailViewerMessage } from './mailViewerTypes';


interface BodyEntry {
  readonly data: MailViewerMessage;
  readonly requestedVersion: string;
}

interface BodyRequest {
  readonly abort: AbortController;
  readonly version: string;
}

interface ThreadBodies {
  readonly key: string | null;
  readonly data: Record<string, BodyEntry>;
  readonly errors: ReadonlyMap<string, string>;
}

interface Input {
  readonly accountEmail?: string | null;
  readonly cache: RefObject<ReturnType<typeof createMailContentCache>>;
  readonly mailData: MailViewerMessage | null;
  readonly messages: readonly MailViewerMessage[];
  readonly selectedMail: MailViewerMessage | null;
  readonly selectionKey: string | null;
  readonly setMailData: (data: MailViewerMessage) => void;
}


export function useMailThreadBodies({ accountEmail, cache, mailData, messages, selectedMail, selectionKey, setMailData }: Input) {
  const requests = useRef(new Map<string, BodyRequest>());
  const [bodies, setBodies] = useState<ThreadBodies>({ key: null, data: {}, errors: new Map() });
  const [expandedThreadIds, setExpandedThreadIds] = useState<Set<string>>(() => new Set());
  const firstIdentity = messages[0] ? mailMessageIdentity(messages[0], accountEmail) : null;
  const bodyData = bodies.key === selectionKey ? bodies.data : {};
  const errors = bodies.key === selectionKey ? bodies.errors : new Map<string, string>();
  const threadMessageData: Record<string, MailViewerMessage> = {};
  const threadMessageErrors = new Set<string>();
  for (const message of messages) {
    const identity = mailMessageIdentity(message, accountEmail);
    const entry = bodyData[identity];
    if (entry && canUseMailBody(message, entry.data, entry.requestedVersion, accountEmail)) {
      threadMessageData[identity] = entry.data;
    }
    if (errors.get(identity) === mailContentVersion(message)) threadMessageErrors.add(identity);
  }

  useEffect(() => {
    const pending = requests.current;
    let active = true;
    queueMicrotask(() => {
      if (active) setBodies({ key: selectionKey, data: {}, errors: new Map() });
    });
    return () => {
      active = false;
      pending.forEach(request => { request.abort.abort(); });
      pending.clear();
    };
  }, [selectionKey]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setExpandedThreadIds(new Set(firstIdentity ? [firstIdentity] : []));
    });
    return () => { active = false; };
  }, [firstIdentity, selectionKey]);

  const load = (message: MailViewerMessage, retry = false): void => {
    if (!selectionKey || isSelectedMailBody(message, mailData, selectedMail, accountEmail)) return;
    const identity = mailMessageIdentity(message, accountEmail);
    const version = mailContentVersion(message);
    const pending = requests.current.get(identity);
    if (pending) {
      if (!version || !pending.version || version === pending.version) return;
      pending.abort.abort();
      requests.current.delete(identity);
    }
    if (!retry && (threadMessageData[identity] || threadMessageErrors.has(identity))) return;
    const email = message.account || message.account_email || accountEmail || undefined;
    const strictIdentity = tryMailMessageIdentity(message, accountEmail);
    const cacheKey = strictIdentity ? JSON.stringify([strictIdentity, message.id]) : null;
    const candidate = !retry && cacheKey ? cache.current.get(cacheKey) : null;
    const cached = candidate && canUseMailBody(message, candidate, '', accountEmail) ? candidate : null;
    if (candidate && !cached && cacheKey) cache.current.delete(cacheKey);
    const update = (data: MailViewerMessage | null, failed: boolean): void => {
      setBodies(previous => {
        const base = previous.key === selectionKey ? previous : { key: selectionKey, data: {}, errors: new Map<string, string>() };
        const nextErrors = new Map(base.errors);
        if (failed) nextErrors.set(identity, version);
        else nextErrors.delete(identity);
        const nextData = data
          ? { ...base.data, [identity]: { data, requestedVersion: version } }
          : Object.fromEntries(Object.entries(base.data).filter(([key]) => key !== identity));
        return { key: selectionKey, data: nextData, errors: nextErrors };
      });
    };
    if (cached) { update(cached, false); return; }
    update(null, false);
    const abort = new AbortController();
    const ownRequests = requests.current;
    ownRequests.set(identity, { abort, version });
    void fetchMailMessage(message.id, { email, folder: message.imap_folder || undefined }, abort.signal)
      .then(detail => {
        if (abort.signal.aborted) return;
        if (ownRequests.get(identity)?.abort === abort) ownRequests.delete(identity);
        const data = hydrateMailMessageIdentity(detail, message, email);
        if (!canUseMailBody(message, data, version, email)) {
          throw new Error('Message body does not match the requested account or mailbox');
        }
        if (cacheKey) cache.current.set(cacheKey, data);
        update(data, false);
        if (isSameMailMessage(message, selectedMail, accountEmail)) setMailData(data);
      }).catch((error: unknown) => {
        if (abort.signal.aborted) return;
        if (ownRequests.get(identity)?.abort === abort) ownRequests.delete(identity);
        logError('mail-viewer.thread-message', error);
        update(null, true);
      }).finally(() => {
        if (ownRequests.get(identity)?.abort === abort) ownRequests.delete(identity);
      });
  };
  const loadExpanded = useEffectEvent(() => {
    if (!mailData) return;
    for (const message of messages) {
      if (expandedThreadIds.has(mailMessageIdentity(message, accountEmail))) load(message);
    }
  });
  const versions = JSON.stringify(messages.map(message => [mailMessageIdentity(message, accountEmail), mailContentVersion(message)]));
  const expanded = JSON.stringify([...expandedThreadIds]);
  const hasContent = Boolean(mailData);
  useEffect(() => { loadExpanded(); }, [bodies, expanded, hasContent, selectionKey, versions]);

  const toggleThreadMessage = (message: MailViewerMessage): void => {
    const identity = mailMessageIdentity(message, accountEmail);
    setExpandedThreadIds(previous => {
      const next = new Set(previous);
      if (next.has(identity)) next.delete(identity);
      else next.add(identity);
      return next;
    });
  };

  return {
    expandedThreadIds, threadMessageData, threadMessageErrors, toggleThreadMessage,
    retryThreadMessage: (message: MailViewerMessage): void => { load(message, true); },
  };
}
