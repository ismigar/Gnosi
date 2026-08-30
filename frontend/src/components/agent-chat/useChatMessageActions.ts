import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../lib/toast';
import { writeClipboardText } from '../../shared/platform/clipboard';
import { recordChatFeedback, requestChatMessageJob, type JobAction } from '../../shared/api/chat-message-actions';
import { boundedJob } from '../agentChatTransparency';
import { isRecord } from '../agentChatMessageTypes';
import type { StoredChatMessage } from './sessionModel';
import { messageFeedback, previousPrompt, type MessageActionValues, type MessageRating } from './messageActionModel';
import { logChatError } from './chatDiagnostics';

interface Options {
  readonly messages: readonly StoredChatMessage[];
  readonly setMessages: Dispatch<SetStateAction<readonly StoredChatMessage[]>>;
  readonly agentName?: string;
  readonly selectedAgentId: string;
  readonly sessionId: string;
  readonly isLoading: boolean;
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
  readonly setInputValue: (value: string) => void;
  readonly setShowMentionMenu: (value: boolean) => void;
}

export function useChatMessageActions({ messages, setMessages, agentName, selectedAgentId, sessionId, isLoading, inputRef, setInputValue, setShowMentionMenu }: Options) {
  const { t, i18n } = useTranslation();
  const focusComposerWith = useCallback((value: string) => {
    setInputValue(value); setShowMentionMenu(false);
    requestAnimationFrame(() => { inputRef.current?.focus(); });
  }, [inputRef, setInputValue, setShowMentionMenu]);
  const copyMessage = useCallback(async (content: string) => {
    try { await writeClipboardText(content || ''); toast.success(t('chat.message_copied', 'Message copied')); }
    catch (error) { logChatError('agent-chat-copy', error); toast.error(t('chat.copy_failed', 'Could not copy the message')); }
  }, [t]);
  const quoteMessage = useCallback((message: StoredChatMessage | null | undefined) => {
    const prefix = message?.role === 'user' ? t('chat.you', 'You') : agentName || 'Gnosi Copilot';
    focusComposerWith(`> ${prefix}: ${(message?.content || '').replace(/\n/g, '\n> ')}\n\n`);
  }, [agentName, focusComposerWith, t]);
  const markMessage = useCallback(<Key extends keyof MessageActionValues>(index: number, field: Key, value: MessageActionValues[Key]) => {
    setMessages((previous) => previous.map((message, messageIndex) => messageIndex === index ? { ...message, [field]: value } : message));
  }, [setMessages]);
  const submitMessageFeedback = useCallback(async (index: number, rating: MessageRating) => {
    const message = messages[index]; if (!message) return;
    const previousRating = typeof message.feedback === 'string' ? message.feedback : null;
    const nextRating = rating === previousRating ? null : rating;
    const body = messageFeedback(message, selectedAgentId, sessionId, i18n.resolvedLanguage || i18n.language || 'en', nextRating);
    if (!body) return;
    markMessage(index, 'feedback', nextRating);
    try { await recordChatFeedback(body); }
    catch (error) {
      logChatError('agent-chat-feedback', error); markMessage(index, 'feedback', previousRating);
      toast.error(t('chat.feedback_failed', 'Could not record response feedback.'));
    }
  }, [i18n.language, i18n.resolvedLanguage, markMessage, messages, selectedAgentId, sessionId, t]);
  const refreshMessageJob = useCallback(async (index: number, action: JobAction = 'status') => {
    const job = messages[index]?.job; if (!job?.job_id) return;
    try {
      const payload = await requestChatMessageJob(job.job_id, action);
      if (payload === null || payload === undefined) throw new Error('Capability job returned no response');
      const record = isRecord(payload) ? payload : {};
      const nextJob = boundedJob({ ...job, ...record, capabilities: record.capabilities || job.capabilities });
      if (nextJob) markMessage(index, 'job', nextJob);
    } catch (error) { logChatError('agent-chat-job', error); toast.error(t('chat.job_update_failed', 'Could not update the background job.')); }
  }, [markMessage, messages, t]);
  const previousUserPrompt = useCallback((index: number) => previousPrompt(messages, index), [messages]);
  const retryMessage = useCallback((index: number) => {
    if (isLoading) return;
    const prompt = previousUserPrompt(index); if (!prompt) return;
    focusComposerWith(prompt);
    toast(t('chat.retry_prefilled', 'The original request is ready to retry. Review it and send again.'));
  }, [focusComposerWith, isLoading, previousUserPrompt, t]);
  return { focusComposerWith, copyMessage, quoteMessage, markMessage, submitMessageFeedback, refreshMessageJob, previousUserPrompt, retryMessage };
}
