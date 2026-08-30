import type { ChangeEvent, Dispatch, RefObject, SetStateAction, SyntheticEvent } from 'react';
import type { ChatStreamRequest } from '../../shared/api/chat-streaming';
import type { CatalogMention, ChatAttachment } from './composerModel';

export interface ChatComposerProps {
  readonly readOnly: boolean;
  readonly embedded: boolean;
  readonly isLoading: boolean;
  readonly agentHasModel: boolean;
  readonly isUploadingAttachment: boolean;
  readonly showMentionMenu: boolean;
  readonly showSessionsView: boolean;
  readonly inputValue: string;
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly messagesContainerRef: RefObject<HTMLDivElement | null>;
  readonly attachments: readonly ChatAttachment[];
  readonly contextRefs: NonNullable<ChatStreamRequest['context_refs']>;
  readonly mentionResults: readonly CatalogMention[];
  readonly setInputValue: (value: string) => void;
  readonly setShowSessionsView: Dispatch<SetStateAction<boolean>>;
  readonly handleSubmit: (event: Pick<SyntheticEvent, 'preventDefault'>) => Promise<void>;
  readonly handlePickAttachment: () => void;
  readonly handleAttachmentInputChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  readonly removeAttachment: (id: string) => void;
  readonly applyMention: (mention: CatalogMention) => void;
  readonly createNewSession: () => void | Promise<void>;
}
