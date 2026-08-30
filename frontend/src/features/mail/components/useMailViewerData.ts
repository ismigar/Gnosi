import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';

import type { MailTagsContextValue } from '../hooks/useMailTags';
import { logError } from '../../../lib/notifyError';
import { toast } from '../../../lib/toast';
import {
  extractMailEntities,
  fetchMailMessage,
  fetchMailThread,
  markMailRead,
} from '../../../shared/api/mail';
import { normalizeMailEntities } from './mailViewerModel';
import type {
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
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const scannedIdsRef = useRef(new Set<string>());
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
    if (!context) return;
    setExtractedEntities(null);
    try {
      const entities = normalizeMailEntities(await extractMailEntities(context));
      if (entities.events.length > 0 || entities.contacts.length > 0) {
        setExtractedEntities(entities);
        toast.success(t('mail.smart_suggestions_found', 'Smart suggestions found'));
      }
    } catch (error) {
      logError('mail-viewer.entity-scan', error);
      toast.error(t('mail.smart_analysis_error', 'Error during smart analysis'));
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
    if (!id || !threadId || threadId === id || !email || selectedMail.source === 'vault') {
      return () => { cancelled = true; };
    }
    void fetchMailThread(threadId, email)
      .then((data) => {
        if (cancelled) return;
        const messages = [...data.messages].reverse();
        if (messages.length > 1) setFullThreadMessages(messages);
      })
      .catch((error: unknown) => { logError('mail-viewer.thread', error); });
    return () => { cancelled = true; };
  }, [account?.email, selectedMail]);

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
    queueMicrotask(() => { if (!cancelled) setLoading(true); });
    const email = selectedMail.account || account?.email || '';
    void fetchMailMessage(id, {
      email: email || undefined,
      folder: selectedMail.imap_folder || undefined,
    }).then((data) => {
      if (cancelled) return;
      setMailData(data);
      setLoading(false);
      if (!data.is_read) markAsRead(data.id, email, data.imap_folder || selectedMail.imap_folder || undefined);
      const context = data.body_text || data.snippet || '';
      if (!scannedIdsRef.current.has(data.id) && context) {
        scannedIdsRef.current.add(data.id);
        void scanEntities(context);
      }
    }).catch((error: unknown) => {
      logError('mail-viewer.message', error);
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [account?.email, markAsRead, scanEntities, selectedMail]);

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
    allThreadMessages,
    expandedThreadIds,
    extractedEntities,
    loading,
    mailData,
    setActiveTagIds,
    setExtractedEntities,
    setMailData,
    threadMessageData,
    toggleThreadMessage,
  };
}
