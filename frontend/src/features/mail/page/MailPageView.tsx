import { lazy, Suspense, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Inbox, PanelLeft } from 'lucide-react';

import { AppHeader } from '../../../shared/ui/layout/AppHeader';
import MailList from '../components/MailList';
import MailSidebar from '../components/MailSidebar';
import { MailViewerEmpty } from '../components/MailViewerEmpty';
import type { MailView } from '../../../shared/api/mail';
import type { MailPageController } from './useMailPageController';
import { mailMessageIdentity } from '../mailIdentity';
import type {
  MailAccount,
  MailComposeData,
} from './mailPageModel';

const MailComposer = lazy(() => import('../components/MailComposer'));
const MailViewer = lazy(() => import('../components/MailViewer'));

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
      {controller.countStatuses.some(account => account.status !== 'ready') && (
        <div
          role="status"
          data-mail-counts-status={controller.countStatuses.some(account => account.status === 'unavailable') ? 'unavailable' : 'pending'}
          className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-2 text-xs text-[var(--text-secondary)]"
        >
          <p>{t('mail.counts_partial', 'Folder counts are incomplete or awaiting an update.')}</p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {controller.countStatuses.filter(account => account.status !== 'ready').map(account => (
              <li key={account.email} data-mail-count-account={account.email} data-count-state={account.status}>
                {account.email}: {account.status === 'pending'
                  ? t('mail.counts_pending', 'Updating')
                  : t('mail.counts_unavailable', 'Unavailable')}
                {account.hasPrevious && <> · {t('mail.counts_previous', 'Previous count retained')}</>}
              </li>
            ))}
          </ul>
          {controller.countStatuses.some(account => account.status === 'unavailable') && (
            <button type="button" className="mt-1 font-semibold text-[var(--gnosi-blue)] hover:underline" onClick={controller.refreshCounts}>
              {t('common.retry', 'Retry')}
            </button>
          )}
        </div>
      )}
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
              accountsLoading={controller.accountsLoading}
              folder={controller.activeFolder}
              category={controller.activeCategory}
              activeView={controller.activeView}
              activeTagId={controller.activeTagId}
              onSelectMail={controller.handleMailSelected}
              selectedMailIdentity={controller.selectedMail
                ? mailMessageIdentity(controller.selectedMail)
                : undefined}
              isComposing={controller.isComposing}
              searchQuery={controller.searchQuery}
              onMessagesLoaded={controller.setMessages}
              onMailRead={controller.handleMailRead}
              onBatchDone={controller.refreshCounts}
              showMailboxSidebar={controller.showMailboxSidebar}
              onToggleMailboxSidebar={() => {
                controller.setShowMailboxSidebar((open) => !open);
              }}
              removedMail={controller.removedMail}
              readMail={controller.readMail}
              listRefreshToken={controller.listRefreshToken}
              onRecordAction={controller.handleRecordAction}
            />
          </div>

          <div className={`mail-workspace__detail ${hasDetail ? 'mail-workspace__detail--active' : ''}`}>
            <Suspense fallback={
              <div className="flex flex-1 flex-col items-center justify-center gap-3">
                <p role="status">{t('mail.loading')}</p>
                <button type="button" className="gnosi-btn gnosi-btn-secondary" onClick={() => {
                  if (controller.isComposing) controller.closeComposer();
                  else controller.setSelectedMail(null);
                }}>{t('common.close', 'Close')}</button>
              </div>
            }>
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
              ) : controller.selectedMail ? (
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
              ) : <MailViewerEmpty />}
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
