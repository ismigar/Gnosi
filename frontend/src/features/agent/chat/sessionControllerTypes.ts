import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { StoredChatMessage, StoredChatSession } from './sessionModel';

export interface ChatSessionController {
  readonly browserStorageScope: string;
  readonly defaultSessionTitle: string;
  readonly embedded: boolean;
  readonly forcedAgentId: string;
  readonly forcedSessionId: string;
  readonly notebookId: string;
  readonly isLoading: boolean;
  readonly scopeReady: boolean;
  readonly selectedAgentId: string;
  readonly sessionId: string;
  readonly chatSessions: StoredChatSession[];
  readonly messages: readonly StoredChatMessage[];
  readonly scopedStorageKey: (key: string) => string;
  readonly requestAbortRef: RefObject<AbortController | null>;
  readonly historyHydrationRef: RefObject<number>;
  readonly setChatSessions: Dispatch<SetStateAction<StoredChatSession[]>>;
  readonly setMessages: Dispatch<SetStateAction<readonly StoredChatMessage[]>>;
  readonly setSelectedAgentId: Dispatch<SetStateAction<string>>;
  readonly setSessionId: Dispatch<SetStateAction<string>>;
  readonly setSessionsHydrated: Dispatch<SetStateAction<boolean>>;
  readonly setHydratedStorageScope: Dispatch<SetStateAction<string>>;
  readonly setPendingConfirmation: (value: null) => void;
  readonly setAgentRuntime: (value: null) => void;
  readonly clearDraftMentions: () => void;
  readonly clearDraftAttachments: () => void;
  readonly setInputValue: Dispatch<SetStateAction<string>>;
  readonly setShowSessionsView: Dispatch<SetStateAction<boolean>>;
}
