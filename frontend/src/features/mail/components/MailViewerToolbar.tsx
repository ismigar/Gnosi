import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import {
  Archive,
  Clock,
  ExternalLink,
  FolderInput,
  Forward,
  Reply,
  ReplyAll,
  ShieldAlert,
  Sparkles,
  Star,
  Tag,
  Trash2,
  X,
} from 'lucide-react';

import MailTagPicker from './MailTagPicker';
import { translateFolderName } from './mailFolderUtils';
import type { MailViewerController } from './useMailViewerController';


interface MailViewerToolbarProps {
  readonly controller: MailViewerController;
}


function ToolbarButton({
  children,
  className = '',
  disabled = false,
  onClick,
  title,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly title: string;
}) {
  return (
    <button
      className={`p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}


export function MailViewerToolbar({ controller }: MailViewerToolbarProps) {
  const { moveButtonRef, t } = controller;
  const toggleTag = (tagId: string): void => {
    const next = controller.activeTagIds.includes(tagId)
      ? controller.activeTagIds.filter((id) => id !== tagId)
      : [...controller.activeTagIds, tagId];
    void controller.setTags(next);
  };

  return (
    <div className="h-14 border-b border-[var(--border-primary)] flex items-center bg-[var(--bg-primary)]/80 backdrop-blur-xl sticky top-0 z-20">
      <div className="flex-1 overflow-x-auto scrollbar-hide flex items-center gap-1 pl-6 pr-2">
        <button
          className="p-2 hover:bg-[var(--sidebar-item-active)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--gnosi-blue)] transition-all flex items-center gap-2 text-sm font-medium"
          onClick={() => { void controller.addToVault(); }}
          title={t('mail.add_to_vault')}
          type="button"
        >
          <ExternalLink size={16} />
          <span className="hidden xl:block">{t('mail.add_to_vault')}</span>
        </button>
        <ToolbarButton
          className="hover:text-amber-500"
          disabled={controller.analyzing || !controller.canAnalyze}
          onClick={controller.analyzeMessage}
          title={controller.t('mail.smart_analysis', 'Smart analysis')}
        >
          {controller.analyzing
            ? <span className="block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            : <Sparkles size={16} />}
        </ToolbarButton>
        <div className="w-px h-5 bg-[var(--border-primary)] mx-1" />
        <ToolbarButton onClick={() => { controller.compose('reply'); }} title={t('mail.reply_title')}><Reply size={16} /></ToolbarButton>
        <ToolbarButton onClick={() => { controller.compose('reply_all'); }} title={t('mail.reply_all_title')}><ReplyAll size={16} /></ToolbarButton>
        <ToolbarButton onClick={() => { controller.compose('forward'); }} title={t('mail.forward_title')}><Forward size={16} /></ToolbarButton>
        <div className="w-px h-5 bg-[var(--border-primary)] mx-1" />
        <ToolbarButton onClick={controller.archive} title={t('mail.archive_action')}><Archive size={16} /></ToolbarButton>

        <div className="relative">
          <button
            className={`p-2 rounded-xl transition-all flex items-center gap-1.5 ${controller.activeTagIds.length > 0 ? 'text-[var(--gnosi-blue)] bg-[var(--sidebar-item-active)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
            onClick={(event) => {
              controller.setTagPickerAnchor(event.currentTarget.getBoundingClientRect());
              controller.setShowTagPicker(!controller.showTagPicker);
            }}
            title={t('mail.labels', 'Labels')}
            type="button"
          >
            <Tag size={16} />
            {controller.activeTagIds.length > 0 && <span className="text-[11px] font-bold">{controller.activeTagIds.length}</span>}
          </button>
          {controller.showTagPicker && (
            <MailTagPicker
              anchorRect={controller.tagPickerAnchor}
              onClose={() => { controller.setShowTagPicker(false); }}
              onCreateTag={controller.mailTags.createTag}
              onDeleteTag={(id) => { void controller.deleteTag(id); }}
              onToggleTag={toggleTag}
              selectedTagIds={controller.activeTagIds}
              tags={controller.mailTags.tags}
            />
          )}
        </div>

        <div className="relative">
          <button
            className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all"
            disabled={controller.moving}
            onClick={() => { void controller.openMove(); }}
            ref={moveButtonRef}
            title={t('mail.move_to_folder_title', 'Move to folder')}
            type="button"
          >
            {controller.moving ? <span className="block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <FolderInput size={16} />}
          </button>
          {controller.showMove && createPortal((
            <>
              <button aria-label={t('common.close')} className="fixed inset-0" onClick={() => { controller.setShowMove(false); }} style={{ zIndex: 'var(--z-overlay)' }} type="button" />
              <div className="fixed bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-lg py-1 w-52 animate-in fade-in zoom-in-95 duration-150" style={{ left: controller.moveMenuPos.x, top: controller.moveMenuPos.y, zIndex: 'var(--z-popover)' }}>
                <div className="px-3 py-1.5 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{t('mail.move_to_ellipsis', 'Move to...')}</div>
                {controller.moveFolders.length === 0 ? (
                  <div className="px-3 py-2 text-[13px] text-[var(--text-secondary)]">{t('common.loading', 'Loading...')}</div>
                ) : controller.moveFolders.filter((folder) => folder.name !== controller.mailData?.imap_folder).map((folder) => (
                  <button className="w-full text-left px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors flex items-center gap-2" key={folder.name} onClick={() => { void controller.moveToFolder(folder.name); }} type="button">
                    <span className="text-[var(--text-secondary)] text-[10px] font-mono uppercase opacity-60 w-14 shrink-0">{folder.type}</span>
                    {translateFolderName(folder.name, t)}
                  </button>
                ))}
              </div>
            </>
          ), document.body)}
        </div>

        <div className="relative">
          <button
            className="p-2 hover:bg-[var(--bg-secondary)] rounded-xl text-[var(--text-secondary)] transition-all flex items-center gap-1"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              controller.setSnoozeMenuPos({ x: rect.left, y: rect.bottom + 4 });
              controller.setShowSnooze(!controller.showSnooze);
            }}
            title={t('mail.snooze')}
            type="button"
          ><Clock size={16} /></button>
          {controller.showSnooze && createPortal((
            <>
              <button aria-label={t('common.close')} className="fixed inset-0" onClick={() => { controller.setShowSnooze(false); }} style={{ zIndex: 'var(--z-overlay)' }} type="button" />
              <div className="fixed bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-lg py-1 w-48 animate-in fade-in zoom-in-95 duration-150" style={{ left: controller.snoozeMenuPos.x, top: controller.snoozeMenuPos.y, zIndex: 'var(--z-popover)' }}>
                <div className="px-3 py-1.5 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{t('mail.snooze')}</div>
                {(['1h', 'tomorrow', 'next_week'] as const).map((option) => (
                  <button className="w-full text-left px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors" key={option} onClick={() => { void controller.snooze(option); }} type="button">{t(`mail.snooze_${option}`)}</button>
                ))}
              </div>
            </>
          ), document.body)}
        </div>

        <ToolbarButton className="hover:text-[var(--status-error)]" onClick={controller.remove} title={t('mail.delete_action')}><Trash2 size={16} /></ToolbarButton>
        <button className={`p-2 rounded-xl transition-all flex items-center gap-2 text-sm font-medium ${controller.spam ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-amber-600'}`} onClick={controller.toggleSpam} title={controller.spam ? t('mail.unmark_spam_title', 'Not spam (Move to inbox)') : t('mail.mark_spam_title', 'Mark as spam')} type="button"><ShieldAlert fill={controller.spam ? 'currentColor' : 'none'} size={16} /></button>
      </div>
      <div className="flex items-center gap-1 shrink-0 px-2 border-l border-[var(--border-primary)]">
        <button className={`p-2 rounded-xl transition-all ${controller.mailData?.is_starred ? 'text-[var(--status-warning)] bg-[var(--bg-secondary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`} onClick={controller.toggleStar} type="button"><Star fill={controller.mailData?.is_starred ? 'currentColor' : 'none'} size={16} /></button>
        <ToolbarButton className="active:scale-90" onClick={() => { controller.onClose?.(); }} title={t('common.close')}><X size={16} /></ToolbarButton>
      </div>
    </div>
  );
}
