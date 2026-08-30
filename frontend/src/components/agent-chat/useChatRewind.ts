import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../lib/toast';
import { rewindChatSession } from '../../shared/api/chat-message-actions';
import { conversationRewindPlan } from '../agentChatConversationMerge';
import { hydrateChatMessages } from './liveConversationModel';
import type { StoredChatMessage } from './sessionModel';
import { logChatError } from './chatDiagnostics';

interface Options {
  readonly messages: readonly StoredChatMessage[];
  readonly selectedAgentId: string;
  readonly sessionId: string;
  readonly notebookId: string;
  readonly pendingRewindIndex: number | null;
  readonly isLoading: boolean;
  readonly isRewinding: boolean;
  readonly historyHydrationRef: RefObject<number>;
  readonly setMessages: Dispatch<SetStateAction<readonly StoredChatMessage[]>>;
  readonly setPendingConfirmation: (value: null) => void;
  readonly setDetailsMessageIndex: (value: null) => void;
  readonly setPendingRewindIndex: (value: null) => void;
  readonly setIsRewinding: (value: boolean) => void;
  readonly focusComposerWith: (value: string) => void;
}

export function useChatRewind({ messages, selectedAgentId, sessionId, notebookId, pendingRewindIndex, isLoading, isRewinding, historyHydrationRef, setMessages, setPendingConfirmation, setDetailsMessageIndex, setPendingRewindIndex, setIsRewinding, focusComposerWith }: Options) {
  const { t } = useTranslation();
  return useCallback(async () => {
    if (pendingRewindIndex === null || isLoading || isRewinding) return;
    const plan = conversationRewindPlan(messages, pendingRewindIndex); if (!plan) return;
    setIsRewinding(true);
    try {
      if (plan.beforeTurnId !== null && plan.beforeTurnId !== undefined && typeof plan.beforeTurnId !== 'string') {
        throw new Error('Conversation rewind requires a string turn identifier');
      }
      const canonical = await rewindChatSession({ agentId: selectedAgentId, id: sessionId }, { before_turn_id: plan.beforeTurnId, keep_messages: plan.keepMessages }, notebookId);
      const rewoundMessages = hydrateChatMessages(canonical, messages.slice(0, plan.localKeepCount));
      historyHydrationRef.current += 1;
      setMessages(rewoundMessages); setPendingConfirmation(null); setDetailsMessageIndex(null); setPendingRewindIndex(null);
      if (plan.prompt) focusComposerWith(plan.prompt);
      toast.success(t('chat.rewind_complete', 'Conversation rewound. Completed external actions were not reversed.'));
    } catch (error) {
      logChatError('agent-chat-rewind', error); toast.error(t('chat.rewind_failed', 'The conversation could not be rewound.'));
    } finally { setIsRewinding(false); }
  }, [focusComposerWith, historyHydrationRef, isLoading, isRewinding, messages, notebookId, pendingRewindIndex, selectedAgentId, sessionId, setDetailsMessageIndex, setIsRewinding, setMessages, setPendingConfirmation, setPendingRewindIndex, t]);
}
