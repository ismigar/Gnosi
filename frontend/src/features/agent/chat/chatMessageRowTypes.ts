import type { AgentConfirmation } from './confirmationModel';
import type { StoredChatMessage } from './sessionModel';
import type { useChatMessageActions } from './useChatMessageActions';

export interface ChatMessageRowProps extends ReturnType<typeof useChatMessageActions> {
  readonly message: StoredChatMessage;
  readonly index: number;
  readonly notebookId: string;
  readonly readOnly: boolean;
  readonly conversationMode: string;
  readonly storageIdentity: string;
  readonly agentName: string;
  readonly isLoading: boolean;
  readonly isRewinding: boolean;
  readonly detailsMessageIndex: number | null;
  readonly confirmationTitle: (confirmation: AgentConfirmation) => string;
  readonly setPendingConfirmation: (confirmation: AgentConfirmation) => void;
  readonly setPendingRewindIndex: (index: number) => void;
  readonly setDetailsMessageIndex: (index: number | null) => void;
}
