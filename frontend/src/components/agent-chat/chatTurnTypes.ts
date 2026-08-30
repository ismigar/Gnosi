import type { RefObject } from 'react';
import type { ChatStreamRequest } from '../../shared/api/chat-streaming';
import type { AgentChatMention } from '../agentChatMentionUtils';
import type { ChatAttachment } from './composerModel';
import type { StreamEventContext } from './streamEventModel';

export interface ChatTurnContext extends Omit<StreamEventContext, 'requestScope' | 'agentId' | 'turnId'> {
  readonly browserStorageScope: string;
  readonly selectedAgentId: string;
  readonly notebookId: string;
  readonly contextRefs: NonNullable<ChatStreamRequest['context_refs']>;
  readonly inputValue: string;
  readonly readOnly: boolean;
  readonly isLoading: boolean;
  readonly agentHasModel: boolean;
  readonly selectedMentions: readonly AgentChatMention[];
  readonly attachments: readonly ChatAttachment[];
  readonly requestAbortRef: RefObject<AbortController | null>;
  readonly processingStartedAtRef: RefObject<number | null>;
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
  readonly clearDraftMentions: () => void;
  readonly clearDraftAttachments: () => void;
  readonly setInputValue: (value: string) => void;
  readonly setShowMentionMenu: (show: boolean) => void;
  readonly setIsLoading: (loading: boolean) => void;
}
