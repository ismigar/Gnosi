import { Archive, Trash2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { browserDocumentBody } from '../../../../shared/platform/browser-events';
import { translateFolderName } from '../mailFolderUtils';
import type { MailListController } from './useMailListController';


interface MailListMenusProps {
  readonly controller: MailListController;
}


export function MailListMenus({ controller }: MailListMenusProps) {
  const { t } = useTranslation();
  return (
    <>
      {controller.moveMenu && createPortal((
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 'var(--z-overlay)' }}
            onClick={() => {
              controller.setMoveMenu(null);
            }}
          />
          <div
            className="fixed bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-xl py-1 w-52 animate-in fade-in zoom-in-95 duration-100"
            style={{
              left: controller.moveMenu.x,
              top: controller.moveMenu.y,
              zIndex: 'var(--z-popover)',
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="px-3 py-1.5 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
              {t('mail.move_to_ellipsis', 'Move to...')}
            </div>
            {controller.moveMenu.folders.length === 0 ? (
              <div className="px-3 py-2 text-[13px] text-[var(--text-secondary)]">
                {t('common.loading')}
              </div>
            ) : controller.moveMenu.folders
              .filter((folder) => folder.name !== controller.moveMenu?.msg.imap_folder)
              .map((folder) => (
                <button
                  key={folder.name}
                  onClick={() => {
                    void controller.handleInlineMoveToFolder(folder.name);
                  }}
                  className="w-full text-left px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors flex items-center gap-2"
                >
                  <span className="text-[var(--text-secondary)] text-[10px] font-mono uppercase opacity-60 w-14 shrink-0">
                    {folder.type}
                  </span>
                  {translateFolderName(folder.name, t)}
                </button>
              ))}
          </div>
        </>
      ), browserDocumentBody())}

      {controller.batchMoveMenu && createPortal((
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 'var(--z-overlay)' }}
            onClick={() => {
              controller.setBatchMoveMenu(null);
            }}
          />
          <div
            className="fixed bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-xl py-1 w-52 animate-in fade-in zoom-in-95 duration-100"
            style={{
              left: controller.batchMoveMenu.x,
              top: controller.batchMoveMenu.y,
              zIndex: 'var(--z-popover)',
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="px-3 py-1.5 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
              {t('mail.move_batch_menu_title', {
                count: controller.selectedIds.size,
                defaultValue_one: 'Move {{count}} message to...',
                defaultValue_other: 'Move {{count}} messages to...',
              })}
            </div>
            {controller.batchMoveMenu.folders.length === 0 ? (
              <div className="px-3 py-2 text-[13px] text-[var(--text-secondary)]">
                {t('common.loading')}
              </div>
            ) : controller.batchMoveMenu.folders.map((folder) => (
              <button
                key={folder.name}
                onClick={() => {
                  void controller.handleBatchMoveToFolder(folder.name);
                }}
                className="w-full text-left px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors flex items-center gap-2"
              >
                <span className="text-[var(--text-secondary)] text-[10px] font-mono uppercase opacity-60 w-14 shrink-0">
                  {folder.type}
                </span>
                {translateFolderName(folder.name, t)}
              </button>
            ))}
          </div>
        </>
      ), browserDocumentBody())}

      {controller.contextMenu && (
        <>
          <div
            className="fixed inset-0 z-[var(--z-overlay)]"
            onClick={() => {
              controller.setContextMenu(null);
            }}
          />
          <div
            className="fixed z-[var(--z-modal)] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-xl py-1 w-48 animate-in fade-in zoom-in-95 duration-100"
            style={{
              left: controller.contextMenu.x,
              top: controller.contextMenu.y,
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <button
              onClick={() => {
                void controller.handleBatchAction('archive');
                controller.setContextMenu(null);
              }}
              className="w-full text-left px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] flex items-center gap-2"
            >
              <Archive size={14} /> {t('mail.archive_action')}
            </button>
            <button
              onClick={() => {
                void controller.handleBatchAction('trash');
                controller.setContextMenu(null);
              }}
              className="w-full text-left px-4 py-2 text-sm text-[var(--status-error)] hover:bg-[var(--bg-secondary)] flex items-center gap-2"
            >
              <Trash2 size={14} /> {t('mail.delete_action')}
            </button>
            <div className="border-t border-[var(--border-primary)] my-1" />
            <button
              onClick={() => {
                controller.setContextMenu(null);
              }}
              className="w-full text-left px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
            >
              {t('mail.cancel')}
            </button>
          </div>
        </>
      )}
    </>
  );
}
