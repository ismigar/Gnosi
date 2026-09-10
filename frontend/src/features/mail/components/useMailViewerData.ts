import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';

import type { MailTagsContextValue } from '../hooks/useMailTags';
import { logError } from '../../../shared/notifications/notifyError';
import { toast } from '../../../shared/notifications/toast';
import {
  extractMailEntities,
  fetchMailMessage,
  fetchMailThread,
  markMailRead,
  type MailAnalysisMetadata,
} from '../../../shared/api/mail';
import { normalizeMailEntities } from './mailViewerModel';
import {
  hydrateMailMessageIdentity,
  isSameMailMessage,
  mailMessageIdentity,
  selectMailDisplayMessage,
} from '../mailIdentity';
import type {
  MailAnalysisStatus,
  MailExtractedEntities,
  MailViewerAccount,
  MailViewerMessage,
} from './mailViewerTypes';


interface MailViewerDataInput {
  readonly account: MailViewerAccount | null;
  readonly mailTags: MailTagsContextValue;
  readonly onMailRead?: (mail: MailViewerMessage) => void;
  readonly selectedMail: MailViewerMessage | null;
  readonly t: TFunction;
}


export function useMailViewerData({
  account,
  mailTags,
  onMailRead,
  selectedMail,
  t,
}: MailViewerDataInput) {
  const [mailData, setMailData] = useState<MailViewerMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedThreadIds, setExpandedThreadIds] = useState<Set<string>>(() => new Set());
  const [threadMessageData, setThreadMessageData] = useState<Record<string, MailViewerMessage>>({});
  const [fullThreadMessages, setFullThreadMessages] = useState<MailViewerMessage[]>([]);
  const [extractedEntities, setExtractedEntities] = useState<MailExtractedEntities | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<MailAnalysisStatus>('idle');
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const analysisRequestRef = useRef(0);
  const analysisRunningRef = useRef(false);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const { getMessageTags } = mailTags;
  const selectedMailIdentity = selectedMail
    ? mailMessageIdentity(selectedMail, account?.email)
    : null;
  const localThreadMessages = selectedMail?.thread_messages ?? [];
  const allThreadMessages = fullThreadMessages.length > 0
    ? fullThreadMessages
    : localThreadMessages.length > 0
      ? localThreadMessages
      : selectedMail ? [selectedMail] : [];
  const firstThreadMessage = allThreadMessages[0];
  const firstThreadMessageIdentity = firstThreadMessage
    ? mailMessageIdentity(firstThreadMessage, account?.email)
    : null;
  const loadedSelection = mailData && selectMailDisplayMessage(
    mailData, selectedMail, account?.email,
  ) === mailData ? mailData : null;
  const threadId = loadedSelection?.thread_id || selectedMail?.thread_id;
  const threadEmail = loadedSelection?.account || loadedSelection?.account_email
    || selectedMail?.account || account?.email || '';

  const markAsRead = useCallback((
    message: MailViewerMessage,
    email: string,
    folder?: string,
  ): void => {
    if (!email) return;
    void markMailRead(message.id, email, folder || undefined)
      .then(() => { onMailRead?.(message); })
      .catch((error: unknown) => { logError('mail-viewer.mark-read', error); });
  }, [onMailRead]);

  const extractedEntitiesRef = useRef<MailExtractedEntities | null>(null);
  const scanEntities = useCallback(async (
    context: string,
    metadata: MailAnalysisMetadata = {},
  ): Promise<void> => {
    if (!context || analysisRunningRef.current) return;
    const requestId = ++analysisRequestRef.current;
    const abortController = new AbortController();
    analysisAbortRef.current = abortController;
    analysisRunningRef.current = true;
    setAnalyzing(true);
    setAnalysisStatus('analyzing');
    try {
      const response = await extractMailEntities(
        context,
        metadata,
        abortController.signal,
      );
      if (requestId !== analysisRequestRef.current) return;
      const entities = normalizeMailEntities(response);
      const hasResults = entities.events.length > 0 || entities.contacts.length > 0
        || entities.localAnalysis !== null;
      if (response.error && !hasResults) {
        const status: MailAnalysisStatus = entities.analysisReason
          ?? (response.error === 'not_configured'
            ? 'not_configured'
            : response.error === 'invalid_response'
              ? 'invalid_response'
              : 'temporarily_unavailable');
        setAnalysisStatus(status);
        return;
      }
      if (hasResults) {
        setExtractedEntities(entities);
        extractedEntitiesRef.current = entities;
        setAnalysisStatus('results');
        if (entities.resultSource === 'provider') {
          toast.success(t('mail.smart_suggestions_found', 'Smart suggestions found'));
        }
      } else {
        setAnalysisStatus(entities.analysisReason ?? 'no_entities');
      }
    } catch {
      if (requestId !== analysisRequestRef.current) return;
      if (abortController.signal.aborted) return;
      const previous = extractedEntitiesRef.current;
      setAnalysisStatus(previous ? 'results' : 'temporarily_unavailable');
    } finally {
      if (requestId === analysisRequestRef.current) {
        analysisAbortRef.current = null;
        analysisRunningRef.current = false;
        setAnalyzing(false);
      }
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setFullThreadMessages([]);
      setThreadMessageData({});
    });
    const id = selectedMail?.id;
    if (!id || !loadedSelection
      || !threadId || threadId === id
      || !threadEmail || selectedMail.source === 'vault') {
      return () => { cancelled = true; };
    }
    const abortController = new AbortController();
    void fetchMailThread(threadId, threadEmail, abortController.signal)
      .then((data) => {
        if (cancelled) return;
        const messages = [...data.messages].reverse();
        if (messages.length > 0) setFullThreadMessages(messages);
      })
      .catch((error: unknown) => {
        if (!abortController.signal.aborted) logError('mail-viewer.thread', error);
      });
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [loadedSelection, selectedMail, threadEmail, threadId]);

  useEffect(() => {
    if (!firstThreadMessageIdentity) return undefined;
    let active = true;
    queueMicrotask(() => {
      if (active) setExpandedThreadIds(new Set([firstThreadMessageIdentity]));
    });
    return () => { active = false; };
  }, [firstThreadMessageIdentity, selectedMailIdentity]);

  useEffect(() => {
    if (!firstThreadMessage || !firstThreadMessageIdentity
      || firstThreadMessageIdentity === selectedMailIdentity
      || isSameMailMessage(firstThreadMessage, mailData, account?.email)) return;
    const abortController = new AbortController();
    const identity = firstThreadMessageIdentity;
    void fetchMailMessage(firstThreadMessage.id, {
      email: firstThreadMessage.account || firstThreadMessage.account_email
        || account?.email || undefined,
      folder: firstThreadMessage.imap_folder || undefined,
    }, abortController.signal).then((data) => {
      if (abortController.signal.aborted) return;
      setThreadMessageData(current => ({
        ...current,
        [identity]: hydrateMailMessageIdentity(data, firstThreadMessage, account?.email),
      }));
    }).catch((error: unknown) => {
      if (!abortController.signal.aborted) logError('mail-viewer.thread-message', error);
    });
    return () => { abortController.abort(); };
  }, [account?.email, firstThreadMessage, firstThreadMessageIdentity, mailData, selectedMailIdentity]);

  useEffect(() => {
    const id = selectedMail?.id;
    if (!id) {
      queueMicrotask(() => { setActiveTagIds([]); });
      return undefined;
    }
    let cancelled = false;
    void getMessageTags(selectedMail)
      .then((tags) => { if (!cancelled) setActiveTagIds(tags); })
      .catch((error: unknown) => {
        logError('mail-viewer.message-tags', error);
        if (!cancelled) setActiveTagIds([]);
      });
    return () => { cancelled = true; };
  }, [getMessageTags, selectedMail, selectedMail?.id, selectedMailIdentity]);

  useEffect(() => {
    const id = selectedMail?.id;
    if (!id) {
      queueMicrotask(() => { setMailData(null); });
      return undefined;
    }
    let cancelled = false;
    const abortController = new AbortController();
    queueMicrotask(() => {
      if (!cancelled) {
        setExtractedEntities(null);
        extractedEntitiesRef.current = null;
        setLoading(true);
      }
    });
    const email = selectedMail.account || account?.email || '';
    void fetchMailMessage(id, {
      email: email || undefined,
      folder: selectedMail.imap_folder || undefined,
    }, abortController.signal).then((data) => {
      if (cancelled) return;
      setMailData(hydrateMailMessageIdentity(data, selectedMail, email));
      setLoading(false);
      if (!data.is_read) {
        markAsRead(
          selectedMail,
          email,
          data.imap_folder || selectedMail.imap_folder || undefined,
        );
      }
    }).catch((error: unknown) => {
      if (!abortController.signal.aborted) logError('mail-viewer.message', error);
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [account?.email, markAsRead, selectedMail]);

  useEffect(() => {
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    analysisRequestRef.current += 1;
    analysisRunningRef.current = false;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setAnalyzing(false);
      setAnalysisStatus('idle');
      setExtractedEntities(null);
      extractedEntitiesRef.current = null;
    });
    return () => {
      active = false;
      analysisAbortRef.current?.abort();
    };
  }, [selectedMailIdentity]);

  const toggleThreadMessage = (message: MailViewerMessage): void => {
    const identity = mailMessageIdentity(message, account?.email);
    const willExpand = !expandedThreadIds.has(identity);
    setExpandedThreadIds((current) => {
      const next = new Set(current);
      if (next.has(identity)) next.delete(identity);
      else next.add(identity);
      return next;
    });
    if (willExpand && !isSameMailMessage(message, mailData, account?.email)
      && !threadMessageData[identity]) {
      void fetchMailMessage(message.id, {
        email: message.account || account?.email || undefined,
        folder: message.imap_folder || undefined,
      }).then((data) => {
        setThreadMessageData((current) => ({ ...current, [identity]: data }));
      }).catch((error: unknown) => { logError('mail-viewer.thread-message', error); });
    }
  };

  return {
    activeTagIds,
    analysisStatus,
    analyzing,
    allThreadMessages,
    expandedThreadIds,
    extractedEntities,
    loading,
    mailData,
    scanEntities,
    setActiveTagIds,
    setExtractedEntities,
    setMailData,
    threadMessageData,
    toggleThreadMessage,
  };
}
