import { useTranslation } from 'react-i18next';

import { MailMessageRow } from './MailMessageRow';
import { mailListMessageIdentity } from './mailListModel';
import type { MailListController } from './useMailListController';


interface MailListBodyProps {
  readonly accountEmail?: string | null;
  readonly controller: MailListController;
  readonly listElementRef: (element: HTMLDivElement | null) => void;
  readonly selectedMailIdentity?: string;
  readonly sentinelElementRef: (element: HTMLDivElement | null) => void;
}


export function MailListBody({
  accountEmail,
  controller,
  listElementRef,
  selectedMailIdentity,
  sentinelElementRef,
}: MailListBodyProps) {
  const { t } = useTranslation();
  const isEmpty = Object.keys(controller.groupedMessages).length === 0
    || controller.processedMessages.length === 0;

  return (
    <>
      {controller.unavailableAccountCount > 0 && (
        <div
          className="flex items-center justify-between gap-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-2 text-xs text-[var(--text-secondary)]"
          data-mail-partial-status="unavailable"
          role="status"
        >
          <span>
            {accountEmail
              ? t('mail.account_temporarily_unavailable')
              : t('mail.some_accounts_temporarily_unavailable')}
          </span>
          <button
            className="shrink-0 font-semibold text-[var(--gnosi-blue)] hover:underline"
            onClick={() => { controller.fetchMessages({ force: true }); }}
            type="button"
          >
            {t('common.retry')}
          </button>
        </div>
      )}
      <div
        ref={listElementRef}
        className="flex-1 overflow-y-auto"
        tabIndex={0}
        style={{ outline: 'none' }}
      >
        {controller.loading && controller.messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 space-y-4">
            <div className="w-8 h-8 border-2 border-[var(--gnosi-blue)] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-[var(--text-secondary)]">
              {t('mail.syncing')}
            </p>
          </div>
        ) : isEmpty ? (
          <div className="p-12 text-center">
            <p className="text-[var(--text-secondary)] font-medium">
              {controller.unavailableAccountCount > 0
                ? t('mail.messages_temporarily_unavailable')
                : t('mail.no_messages')}
            </p>
          </div>
        ) : Object.entries(controller.groupedMessages).map(([title, messages]) => (
          <div key={title} className="mb-2">
            {title && (
              <h3 className="px-6 py-2 text-[12px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                {title}
              </h3>
            )}
            <div className="border-t border-[var(--border-primary)]">
              {messages.map((message) => (
                <MailMessageRow
                  key={mailListMessageIdentity(message)}
                  accountEmail={accountEmail}
                  controller={controller}
                  index={controller.threadedMessages.findIndex(
                    (candidate) => (
                      mailListMessageIdentity(candidate) === mailListMessageIdentity(message)
                    ),
                  )}
                  isComposing={controller.isComposing}
                  message={message}
                  selectedMailIdentity={selectedMailIdentity}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div ref={sentinelElementRef} className="py-3 flex justify-center">
        {controller.loadingMore && (
          <div className="w-4 h-4 border-2 border-[var(--gnosi-blue)] border-t-transparent rounded-full animate-spin" />
        )}
      </div>
    </>
  );
}
