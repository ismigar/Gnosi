import {
  Archive,
  FolderInput,
  MoreVertical,
  Paperclip,
  Star,
  Tag,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import MailTagPicker, { TagPill } from '../MailTagPicker';
import {
  cleanMailSender,
  formatMailListTimestamp,
  mailListMessageIdentity,
} from './mailListModel';
import type { MailListMessage } from './mailListTypes';
import type { MailListController } from './useMailListController';


interface MailMessageRowProps {
  readonly accountEmail?: string | null;
  readonly controller: MailListController;
  readonly index: number;
  readonly isComposing: boolean;
  readonly message: MailListMessage;
  readonly selectedMailId?: string;
}


export function MailMessageRow({
  accountEmail,
  controller,
  index,
  isComposing,
  message,
  selectedMailId,
}: MailMessageRowProps) {
  const { t } = useTranslation();
  const messageIdentity = mailListMessageIdentity(message);
  const isFocused = controller.focusedIndex === index;
  const isSelected = controller.selectedIds.has(messageIdentity);
  const assignedTagIds = controller.messageTags[message.id] ?? [];

  return (
    <div
      data-mail-index={index}
      onClick={() => {
        controller.setFocusedIndex(index);
        controller.onSelectMail(message);
      }}
      onMouseEnter={() => {
        controller.setHoveredMailId(messageIdentity);
      }}
      onMouseLeave={() => {
        controller.setHoveredMailId(null);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        controller.setContextMenu({
          msgId: message.id,
          x: event.clientX,
          y: event.clientY,
        });
      }}
      className={`group flex items-center px-4 py-2 cursor-pointer border-b border-[var(--border-primary)] transition-colors
        ${isFocused ? 'ring-1 ring-inset ring-[var(--gnosi-blue)]' : ''}
        ${selectedMailId === message.id || isSelected ? 'bg-[var(--mail-row-selected)]' : isFocused ? 'bg-[var(--bg-secondary)]' : 'hover:bg-[var(--bg-secondary)]'}`}
    >
      <div className="flex items-center gap-3 w-full relative">
        <div className="flex items-center gap-2 min-w-[200px] max-w-[260px]">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(event) => {
              controller.toggleSelect(event, message);
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
            aria-label={t('mail.select_message', 'Select message {{subject}}', {
              subject: message.subject || t('common.untitled'),
            })}
            className={`w-4 h-4 rounded border-[var(--border-primary)] text-[var(--gnosi-blue)] focus:ring-[var(--gnosi-blue)] transition-opacity shrink-0 ${isSelected || isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          />
          {Boolean(message.thread_unread) && !isSelected && (
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--gnosi-blue)] shrink-0 group-hover:hidden" />
          )}
          <span className={`text-[13.5px] truncate ${message.thread_unread ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
            {message.thread_senders && message.thread_senders.length > 1
              ? `${message.thread_senders.slice(0, 2).join(', ')}${message.thread_senders.length > 2 ? '…' : ''}`
              : cleanMailSender(message.sender) || t('mail.unknown_sender', 'Unknown')}
          </span>
          {(message.thread_count ?? 0) > 1 && (
            <span className="shrink-0 text-[11px] font-bold text-[var(--text-secondary)] bg-[var(--bg-secondary)] rounded px-1 py-0.5 leading-none">
              {message.thread_count}
            </span>
          )}
        </div>

        <div className="flex-1 flex items-center gap-3 min-w-0">
          <span className={`text-[13.5px] truncate shrink-0 max-w-[220px] ${!message.is_read ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
            {message.subject || `(${t('common.untitled')})`}
          </span>
          {controller.effectiveConfig.showSnippet && (
            <span className="text-[13px] text-[var(--text-secondary)] truncate opacity-70">
              {message.snippet}
            </span>
          )}
          {controller.hoveredMailId === messageIdentity && (
            <div className="absolute left-1/3 top-full mt-2 z-[var(--z-modal-dropdown)] w-96 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl p-5 animate-in fade-in zoom-in-95 duration-200 pointer-events-none origin-top-left">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-xl bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)] flex items-center justify-center text-[11px] font-bold uppercase border border-[var(--border-primary)]">
                  {message.sender[0]}
                </div>
                <div className="flex flex-col">
                  <span className="text-[13px] font-bold text-[var(--text-primary)] leading-tight">
                    {cleanMailSender(message.sender)}
                  </span>
                  <span className="text-[11px] text-[var(--text-secondary)]">{message.date}</span>
                </div>
              </div>
              <h4 className="text-[14px] font-extrabold text-[var(--text-primary)] mb-2 leading-snug">
                {message.subject}
              </h4>
              <p className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed line-clamp-6">
                {message.snippet}
              </p>
            </div>
          )}
        </div>

        {assignedTagIds.length > 0 && (
          <div className="flex items-center gap-1 shrink-0 max-w-[140px] overflow-hidden">
            {assignedTagIds.slice(0, 2).map((tagId) => {
              const tag = controller.tags.find((candidate) => candidate.id === tagId);
              return tag ? <TagPill key={tagId} tag={tag} /> : null;
            })}
            {assignedTagIds.length > 2 && (
              <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>
                +{assignedTagIds.length - 2}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 shrink-0 ml-4">
          {message.has_attachments && (
            <Paperclip size={14} className="text-[var(--text-secondary)]" />
          )}
          <div className={`flex items-center gap-0.5 transition-opacity ${(selectedMailId || isComposing) ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100'}`}>
            <button
              title={message.is_starred
                ? t('mail.unstar', 'Remove star')
                : t('mail.star_action', 'Mark as starred')}
              className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] hover:text-[var(--status-warning)] transition-colors"
              onClick={(event) => {
                void controller.handleInlineAction(event, 'star', message);
              }}
            >
              <Star
                size={15}
                fill={message.is_starred ? 'currentColor' : 'none'}
                className={message.is_starred ? 'text-[var(--status-warning)]' : ''}
              />
            </button>
            <button
              title={t('mail.archive_action', 'Archive')}
              className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] transition-colors"
              onClick={(event) => {
                void controller.handleInlineAction(event, 'archive', message);
              }}
            >
              <Archive size={15} />
            </button>
            <button
              title={t('mail.move_to_folder_title', 'Move to folder')}
              className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] transition-colors"
              onClick={(event) => {
                void controller.handleInlineMoveOpen(event, message);
              }}
            >
              <FolderInput size={15} />
            </button>
            <button
              title={t('mail.delete_action', 'Delete')}
              className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] hover:text-[var(--status-error)] transition-colors"
              onClick={(event) => {
                void controller.handleInlineAction(event, 'trash', message);
              }}
            >
              <Trash2 size={15} />
            </button>
            <button
              title={t('mail.labels', 'Labels')}
              className={`p-1.5 rounded transition-colors ${controller.inlineTagPicker?.msgId === messageIdentity ? 'text-[var(--gnosi-blue)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                controller.setInlineTagPicker((current) => (
                  current?.msgId === messageIdentity
                    ? null
                    : { msgId: messageIdentity, rect }
                ));
              }}
            >
              <Tag size={15} />
            </button>
          </div>
          {controller.inlineTagPicker?.msgId === messageIdentity && (
            <MailTagPicker
              tags={controller.tags}
              selectedTagIds={assignedTagIds}
              anchorRect={controller.inlineTagPicker.rect}
              onClose={() => {
                controller.setInlineTagPicker(null);
              }}
              onToggleTag={async (tagId) => {
                const next = assignedTagIds.includes(tagId)
                  ? assignedTagIds.filter((id) => id !== tagId)
                  : [...assignedTagIds, tagId];
                controller.setMessageTags((previous) => ({
                  ...previous,
                  [message.id]: next,
                }));
                await controller.saveMessageTags(message.id, next, {
                  account_email: accountEmail || message.account || '',
                  date: message.date,
                  sender: message.sender,
                  subject: message.subject,
                }).catch(() => undefined);
              }}
              onCreateTag={async (input) => {
                await controller.createTag(input);
              }}
              onDeleteTag={async (id) => {
                await controller.deleteTag(id);
                controller.setMessageTags((previous) => Object.fromEntries(
                  Object.entries(previous).map(([messageId, tagIds]) => [
                    messageId,
                    tagIds.filter((tagId) => tagId !== id),
                  ]),
                ));
              }}
            />
          )}
          {controller.effectiveConfig.showTimestamp && (
            <span className="text-[12px] font-medium text-[var(--text-secondary)] min-w-[42px] text-right">
              {formatMailListTimestamp(message.timestamp)}
            </span>
          )}
          <MoreVertical
            size={15}
            className={`text-[var(--text-secondary)] transition-opacity ${selectedMailId ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'}`}
          />
        </div>
      </div>
    </div>
  );
}
