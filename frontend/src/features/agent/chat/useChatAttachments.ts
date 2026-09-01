import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { removeChatAttachment, uploadChatAttachment } from '../../../shared/api/chat-attachments';
import type { StoredChatMessage } from './sessionModel';
import { pickChatAttachments, type ChatAttachment } from './composerModel';
import { logChatError } from './chatDiagnostics';

interface Options {
  readonly selectedAgentId: string;
  readonly sessionId: string;
  readonly attachments: readonly ChatAttachment[];
  readonly isUploadingAttachment: boolean;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>;
  readonly setIsUploadingAttachment: Dispatch<SetStateAction<boolean>>;
  readonly setMessages: Dispatch<SetStateAction<readonly StoredChatMessage[]>>;
}

export function useChatAttachments({ selectedAgentId, sessionId, attachments, isUploadingAttachment, fileInputRef, setAttachments, setIsUploadingAttachment, setMessages }: Options) {
  const { t } = useTranslation();
  const scope = { agent_id: selectedAgentId, session_id: sessionId };
  const handlePickAttachment = () => {
    if (!isUploadingAttachment) fileInputRef.current?.click();
  };
  const handleAttachmentInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!picked.length) return;
    const { valid, skipped } = pickChatAttachments(picked, attachments.length);
    if (skipped > 0) setMessages((previous) => [...previous, { role: 'system', content: t('chat.attachments_skipped_limits', 'Notice: {{count}} file(s) exceed the size or count limit and were not attached.', { count: skipped }) }]);
    if (!valid.length) return;
    setIsUploadingAttachment(true);
    const uploaded: ChatAttachment[] = [];
    try {
      for (const file of valid) {
        const path = await uploadChatAttachment(file, scope, t('chat.attachment_upload_failed', 'The file could not be uploaded'));
        uploaded.push({ id: crypto.randomUUID(), name: file.name, size: file.size, type: file.type, path, url: null });
      }
      setAttachments((previous) => [...previous, ...uploaded]);
    } catch (error) {
      for (const item of uploaded) void removeChatAttachment(item.path, scope).catch(() => {});
      setMessages((previous) => [...previous, { role: 'system', content: t('chat.attachment_upload_error', 'Error uploading attachment: {{message}}', { message: error instanceof Error ? error.message : '' }) }]);
    } finally { setIsUploadingAttachment(false); }
  };
  const removeAttachment = (id: string) => {
    const target = attachments.find((item) => item.id === id);
    setAttachments((previous) => previous.filter((item) => item.id !== id));
    if (target?.path) void removeChatAttachment(target.path, scope).catch((error: unknown) => { logChatError('agent-chat-abandoned-attachment', error); });
  };
  return { handlePickAttachment, handleAttachmentInputChange, removeAttachment };
}
