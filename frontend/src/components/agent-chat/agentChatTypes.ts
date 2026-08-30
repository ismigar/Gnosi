import type { ChatStreamRequest } from '../../shared/api/chat-streaming';

export interface AgentChatProps {
  readonly storageIdentity?: string;
  readonly contextRefs?: NonNullable<ChatStreamRequest['context_refs']>;
  readonly embedded?: boolean;
  readonly forcedSessionId?: string;
  readonly forcedAgentId?: string;
  readonly notebookId?: string;
  readonly conversationMode?: string;
  readonly readOnly?: boolean;
}
