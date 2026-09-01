import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Inbox, PanelLeft } from 'lucide-react';

import { AppHeader } from '../../../shared/ui/layout/AppHeader';
import MailComposer from '../components/MailComposer';
import MailList from '../components/MailList';
import MailSidebar from '../components/MailSidebar';
import MailViewer from '../components/MailViewer';
import type { MailView } from '../../../shared/api/mail';
import type { MailPageController } from './useMailPageController';
import type {
  MailAccount,
  MailComposeData,
} from './mailPageModel';


interface MailSidebarBoundaryProps {
  readonly accounts: readonly MailAccount[];
  readonly activeCategory: string | null;
  readonly activeFolder: string | null;
  readonly activeTagId: string | null;
  readonly activeViewId?: string;
  readonly counts: MailPageController['counts'];
  readonly onCompose: () => void;
  readonly onSearch: (value: string) => void;
  readonly onSelectAccount: (account: MailAccount | null) => void;
  readonly onSelectCategory: (category: string) => void;
  readonly onSelectFolder: (folder: string) => void;
  readonly onSelectTag: (tagId: string | null) => void;
  readonly onSelectView: (view: MailView | null) => void;
  readonly selectedAccount: MailAccount | null;
}


interface MailComposerBoundaryProps extends MailComposeData {
  readonly account: MailAccount | null;
  readonly accounts: readonly MailAccount[];
  readonly onClose: () => void;
  readonly onDraftSaved: () => void;
  readonly onSent: () => void;
}


const TypedMailSidebar = MailSidebar as unknown as ComponentType<MailSidebarBoundaryProps>;
const TypedMailComposer = MailComposer as unknown as ComponentType<MailComposerBoundaryProps>;


interface MailPageViewProps {
  readonly controller: MailPageController;
}


export function MailPageView({ controller }: MailPageViewProps) {
  const { t } = useTranslation();
  const hasDetail = controller.selectedMail !== null || controller.isComposing;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-primary)]">
      <AppHeader icon={Inbox} title={t('sidebar.nav_mail', 'Mail')}>
        <button
          type="button"
          className="gnosi-icon-button md:hidden"
          onClick={() => {
            controller.setShowMailboxSidebar((open) => !open);
          }}
          title={controller.showMailboxSidebar
            ? t('mail.hide_mailbox', 'Hide mailbox')
            : t('mail.show_mailbox', 'Show mailbox')}
          aria-label={controller.showMailboxSidebar
            ? t('mail.hide_mailbox', 'Hide mailbox')
            : t('mail.show_mailbox', 'Show mailbox')}
          aria-expanded={controller.showMailboxSidebar}
        >
          <PanelLeft size={18} />
        </button>
      </AppHeader>
      <div className="mail-workspace">
        {controller.isCompact && controller.showMailboxSidebar && (
          <button
            type="button"
            className="mail-workspace__backdrop"
            onClick={() => {
              controller.setShowMailboxSidebar(false);
            }}
            aria-label={t('common.close', 'Close')}
          />
        )}
        {controller.showMailboxSidebar && (
          <div className="mail-workspace__mailboxes">
            <TypedMailSidebar
              selectedAccount={controller.selectedAccount}
              onSelectAccount={controller.setSelectedAccount}
              accounts={controller.accounts}
              activeFolder={controller.activeFolder}
              activeCategory={controller.activeCategory}
              activeViewId={controller.activeView?.id}
              activeTagId={controller.activeTagId}
              onSelectFolder={controller.handleSelectFolder}
              onSelectCategory={controller.handleSelectCategory}
              onSelectView={controller.handleSelectView}
              onSelectTag={controller.handleSelectTag}
              onCompose={controller.handleCompose}
              onSearch={controller.setSearchQuery}
              counts={controller.counts}
            />
          </div>
        )}

        <div className="mail-workspace__content">
          <div className={`mail-workspace__list ${hasDetail ? 'mail-workspace__list--with-detail' : ''}`}>
            <MailList
              account={controller.selectedAccount}
              accounts={controller.accounts}
              folder={controller.activeFolder}
              category={controller.activeCategory}
              activeView={controller.activeView}
              activeTagId={controller.activeTagId}
              onSelectMail={controller.handleMailSelected}
              selectedMailId={controller.selectedMail?.id}
              isComposing={controller.isComposing}
              searchQuery={controller.searchQuery}
              onMessagesLoaded={controller.setMessages}
              onMailRead={controller.handleMailRead}
              onBatchDone={controller.refreshCounts}
              showMailboxSidebar={controller.showMailboxSidebar}
              onToggleMailboxSidebar={() => {
                controller.setShowMailboxSidebar((open) => !open);
              }}
              removedMailId={controller.removedMailId}
              readMailId={controller.readMailId}
              listRefreshToken={controller.listRefreshToken}
              onRecordAction={controller.handleRecordAction}
            />
          </div>

          <div className={`mail-workspace__detail ${hasDetail ? 'mail-workspace__detail--active' : ''}`}>
            {controller.isComposing ? (
              <TypedMailComposer
                account={controller.selectedAccount}
                accounts={controller.identities}
                onClose={controller.closeComposer}
                onSent={controller.closeComposer}
                onDraftSaved={() => {
                  controller.setListRefreshToken((current) => current + 1);
                }}
                {...(controller.composeData ?? {})}
              />
            ) : (
            <MailViewer
                account={controller.selectedAccount}
                mail={controller.selectedMail}
                onClose={() => {
                  controller.setSelectedMail(null);
                }}
                onMailRead={controller.handleMailRead}
                onActionDone={controller.handleActionDone}
                onMoved={controller.handleMailMoved}
                onCompose={controller.handleOpenComposer}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
