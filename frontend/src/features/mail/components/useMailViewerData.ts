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
} from '../../../shared/api/mail';
import { normalizeMailEntities } from './mailViewerModel';
import type {
  MailAnalysisStatus,
  MailExtractedEntities,
  MailViewerAccount,
  MailViewerMessage,
} from './mailViewerTypes';


interface MailViewerDataInput {
  readonly account: MailViewerAccount | null;
  readonly mailTags: MailTagsContextValue;
  readonly onMailRead?: (id: string) => void;
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
  const { getMessageTags } = mailTags;
  const firstThreadMessageId = selectedMail?.thread_messages?.[0]?.id || selectedMail?.id;
  const localThreadMessages = selectedMail?.thread_messages ?? [];
  const allThreadMessages = fullThreadMessages.length > 0
    ? fullThreadMessages
    : localThreadMessages.length > 0
      ? localThreadMessages
      : selectedMail ? [selectedMail] : [];

  const markAsRead = useCallback((id: string, email: string, folder?: string): void => {
    if (!email) return;
    void markMailRead(id, email, folder || undefined)
      .then(() => { onMailRead?.(id); })
      .catch((error: unknown) => { logError('mail-viewer.mark-read', error); });
  }, [onMailRead]);

  const scanEntities = useCallback(async (context: string): Promise<void> => {
    if (!context || analysisRunningRef.current) return;
    const requestId = ++analysisRequestRef.current;
    analysisRunningRef.current = true;
    setAnalyzing(true);
    setAnalysisStatus('analyzing');
    setExtractedEntities(null);
    try {
      const response = await extractMailEntities(context);
      if (requestId !== analysisRequestRef.current) return;
      if (response.error) {
        const status: MailAnalysisStatus = response.error === 'not_configured'
          ? 'not_configured'
          : response.error === 'invalid_response'
            ? 'invalid_response'
            : 'temporarily_unavailable';
        setAnalysisStatus(status);
        return;
      }
      const entities = normalizeMailEntities(response);
      if (entities.events.length > 0 || entities.contacts.length > 0) {
        setExtractedEntities(entities);
        setAnalysisStatus('results');
        toast.success(t('mail.smart_suggestions_found', 'Smart suggestions found'));
      } else {
        setAnalysisStatus('no_entities');
      }
    } catch (error) {
      if (requestId !== analysisRequestRef.current) return;
      logError('mail-viewer.entity-scan', error);
      setAnalysisStatus('temporarily_unavailable');
    } finally {
      if (requestId === analysisRequestRef.current) {
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
    const threadId = selectedMail?.thread_id;
    const email = selectedMail?.account || account?.email || '';
    if (!id || mailData?.id !== id || !threadId || threadId === id
      || !email || selectedMail.source === 'vault') {
      return () => { cancelled = true; };
    }
    const abortController = new AbortController();
    void fetchMailThread(threadId, email, abortController.signal)
      .then((data) => {
        if (cancelled) return;
        const messages = [...data.messages].reverse();
        if (messages.length > 1) setFullThreadMessages(messages);
      })
      .catch((error: unknown) => {
        if (!abortController.signal.aborted) logError('mail-viewer.thread', error);
      });
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [account?.email, mailData?.id, selectedMail]);

  useEffect(() => {
    if (!firstThreadMessageId) return undefined;
    let active = true;
    queueMicrotask(() => { if (active) setExpandedThreadIds(new Set([firstThreadMessageId])); });
    return () => { active = false; };
  }, [firstThreadMessageId, selectedMail?.id]);

  useEffect(() => {
    const id = selectedMail?.id;
    if (!id) {
      queueMicrotask(() => { setActiveTagIds([]); });
      return undefined;
    }
    let cancelled = false;
    void getMessageTags(id)
      .then((tags) => { if (!cancelled) setActiveTagIds(tags); })
      .catch((error: unknown) => {
        logError('mail-viewer.message-tags', error);
        if (!cancelled) setActiveTagIds([]);
      });
    return () => { cancelled = true; };
  }, [getMessageTags, selectedMail?.id]);

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
        setLoading(true);
      }
    });
    const email = selectedMail.account || account?.email || '';
    void fetchMailMessage(id, {
      email: email || undefined,
      folder: selectedMail.imap_folder || undefined,
    }, abortController.signal).then((data) => {
      if (cancelled) return;
      setMailData(data);
      setLoading(false);
      if (!data.is_read) markAsRead(data.id, email, data.imap_folder || selectedMail.imap_folder || undefined);
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
    analysisRequestRef.current += 1;
    analysisRunningRef.current = false;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setAnalyzing(false);
      setAnalysisStatus('idle');
      setExtractedEntities(null);
    });
    return () => { active = false; };
  }, [selectedMail?.id]);

  const toggleThreadMessage = (message: MailViewerMessage): void => {
    const willExpand = !expandedThreadIds.has(message.id);
    setExpandedThreadIds((current) => {
      const next = new Set(current);
      if (next.has(message.id)) next.delete(message.id);
      else next.add(message.id);
      return next;
    });
    if (willExpand && message.id !== mailData?.id && !threadMessageData[message.id]) {
      void fetchMailMessage(message.id, {
        email: message.account || account?.email || undefined,
        folder: message.imap_folder || undefined,
      }).then((data) => {
        setThreadMessageData((current) => ({ ...current, [message.id]: data }));
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
