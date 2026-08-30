import {
  Archive,
  CheckCircle2,
  CircleDot,
  FolderInput,
  PanelLeft,
  RefreshCw,
  Tag,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import MailTagPicker from '../MailTagPicker';
import type { MailView } from '../../../../shared/api/mail';
import type { MailAccount } from './mailListTypes';
import type { MailListController } from './useMailListController';


interface MailListHeaderProps {
  readonly account: MailAccount | null;
  readonly activeView: MailView | null;
  readonly controller: MailListController;
  readonly folder: string | null;
  readonly onToggleMailboxSidebar: () => void;
  readonly showMailboxSidebar: boolean;
}


export function MailListHeader({
  account,
  activeView,
  controller,
  folder,
  onToggleMailboxSidebar,
  showMailboxSidebar,
}: MailListHeaderProps) {
  const { t } = useTranslation();
  const selectedCount = controller.selectedIds.size;

  return (
    <div className="px-4 py-4 flex items-center justify-between border-b border-[var(--border-primary)] min-h-[72px] gap-2">
      <button
        onClick={onToggleMailboxSidebar}
        title={showMailboxSidebar
          ? t('mail.hide_mailbox', 'Hide mailbox')
          : t('mail.show_mailbox', 'Show mailbox')}
        aria-label={showMailboxSidebar
          ? t('mail.hide_mailbox', 'Hide mailbox')
          : t('mail.show_mailbox', 'Show mailbox')}
        className="hidden p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded-lg transition-colors shrink-0 md:inline-flex"
      >
        <PanelLeft size={16} />
      </button>
      {selectedCount > 0 ? (
        <div className="flex items-center justify-between flex-1 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selectedCount === controller.messages.length}
                onChange={controller.selectAll}
                className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--gnosi-blue)] focus:ring-[var(--gnosi-blue)]"
              />
              <span className="text-sm font-bold text-[var(--text-primary)]">
                {selectedCount} {t('mail.selected')}
              </span>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => {
                  controller.handleBatchActionWithConfirm('archive');
                }}
                title={t('mail.archive_selected', 'Archive selected')}
                className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] transition-all"
              >
                <Archive size={16} />
              </button>
              <button
                onClick={() => {
                  controller.handleBatchActionWithConfirm('trash');
                }}
                title={t('mail.delete_selected', 'Delete selected')}
                className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--status-error)] transition-all"
              >
                <Trash2 size={16} />
              </button>
              <button
                onClick={(event) => {
                  void controller.handleBatchMoveOpen(event);
                }}
                title={t('mail.move_to_folder_title', 'Move to folder')}
                className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] transition-all"
              >
                <FolderInput size={16} />
              </button>
              <button
                onClick={() => {
                  void controller.handleBatchAction('read');
                }}
                title={t('mail.mark_read', 'Mark as read')}
                className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] transition-all"
              >
                <CheckCircle2 size={16} />
              </button>
              <div className="relative">
                <button
                  title={t('mail.assign_tag', 'Assign tag')}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    controller.setInlineTagPicker((current) => (
                      current?.msgId === '__batch__'
                        ? null
                        : { msgId: '__batch__', rect }
                    ));
                  }}
                  className={`p-2 rounded-lg transition-all ${controller.inlineTagPicker?.msgId === '__batch__' ? 'bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                >
                  <Tag size={16} />
                </button>
                {controller.inlineTagPicker?.msgId === '__batch__' && (
                  <MailTagPicker
                    tags={controller.tags}
                    selectedTagIds={[]}
                    anchorRect={controller.inlineTagPicker.rect}
                    onClose={() => {
                      controller.setInlineTagPicker(null);
                    }}
                    onToggleTag={async (tagId) => {
                      await Promise.all([...controller.selectedIds].map(async (messageId) => {
                        const current = controller.messageTags[messageId] ?? [];
                        const next = current.includes(tagId)
                          ? current.filter((id) => id !== tagId)
                          : [...current, tagId];
                        const message = controller.messages.find(
                          (candidate) => candidate.id === messageId,
                        );
                        await controller.saveMessageTags(messageId, next, {
                          account_email: account?.email || message?.account || '',
                          date: message?.date || '',
                          sender: message?.sender || '',
                          subject: message?.subject || '',
                        }).catch(() => undefined);
                        controller.setMessageTags((previous) => ({
                          ...previous,
                          [messageId]: next,
                        }));
                      }));
                    }}
                    onCreateTag={async (input) => {
                      await controller.createTag(input);
                    }}
                    onDeleteTag={async (id) => {
                      await controller.deleteTag(id);
                    }}
                  />
                )}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              controller.setSelectedIds(new Set());
            }}
            className="text-sm font-bold text-[var(--gnosi-blue)] hover:opacity-80"
          >
            {t('mail.cancel')}
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <h2 className="text-xl font-bold text-[var(--text-primary)] tracking-tight truncate">
              {activeView ? activeView.name : t(`mail.${controller.folderTitleKey}`)}
            </h2>
            {Boolean(activeView?.filters.length) && (
              <span className="shrink-0 px-2 py-0.5 bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)] text-[11px] font-bold rounded-full">
                {activeView?.filters.length} filtre{activeView?.filters.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {(folder?.toUpperCase() === 'TRASH'
              || folder?.toUpperCase() === 'SPAM') && (
              <button
                onClick={controller.handleEmptyFolder}
                className="p-2 text-[var(--status-error)] hover:bg-[var(--status-error)]/10 rounded-xl transition-all"
                title={folder.toUpperCase() === 'TRASH'
                  ? t('mail.empty_trash_tooltip', 'Empty trash')
                  : t('mail.empty_junk_tooltip', 'Empty junk')}
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              onClick={() => {
                controller.setUnreadOnly(!controller.unreadOnly);
              }}
              className={`p-2 rounded-xl transition-all ${controller.unreadOnly ? 'bg-[var(--gnosi-blue)] text-white shadow-lg' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
              title={controller.unreadOnly
                ? t('mail.show_all', 'Show all')
                : t('mail.filter_unread', 'Filter unread')}
            >
              <CircleDot
                size={16}
                fill={controller.unreadOnly ? 'currentColor' : 'none'}
              />
            </button>
            <div className="w-px h-4 bg-[var(--border-primary)] mx-1" />
            <button
              onClick={() => {
                controller.fetchMessages({ force: true });
              }}
              disabled={controller.loading}
              className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg transition-colors disabled:opacity-40 shrink-0"
              title={t('common.refresh')}
            >
              <RefreshCw
                size={16}
                className={(controller.loading || controller.syncing) ? 'animate-spin' : ''}
              />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
