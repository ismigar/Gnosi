import { format } from 'date-fns';
import { ca } from 'date-fns/locale';
import { ChevronDown } from 'lucide-react';

import { MailAttachments } from './MailAttachments';
import { MailBody } from './MailBody';
import { isSameMailMessage, mailMessageIdentity } from '../mailIdentity';
import { cleanMailAddress } from './mailViewerModel';
import type { MailViewerController } from './useMailViewerController';


export function MailThread({ controller }: { readonly controller: MailViewerController }) {
  const { t } = controller;
  return (
    <div className="space-y-2 mb-8">
      {controller.allThreadMessages.map((message, index) => {
        const identity = mailMessageIdentity(message, controller.account?.email);
        const main = isSameMailMessage(
          message,
          controller.mailData,
          controller.account?.email,
        )
          || (index === 0 && !controller.mailData);
        const expanded = controller.expandedThreadIds.has(identity);
        const sent = controller.isSentMessage(message);
        const sender = sent
          ? t('mail.you_label', 'You')
          : cleanMailAddress(message.sender);
        const content = main
          ? controller.mailData
          : controller.threadMessageData[identity];
        const date = message.timestamp
          ? format(new Date(message.timestamp * 1000), 'd MMM yyyy · HH:mm', { locale: ca })
          : '';
        return (
          <div className={`rounded-xl overflow-hidden border transition-all ${sent ? 'border-[var(--gnosi-blue)]/40 bg-[var(--sidebar-item-active)]/40' : 'border-[var(--border-primary)] bg-[var(--bg-primary)]'}`} key={identity}>
            <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-secondary)]/60 transition-colors text-left" onClick={() => { controller.toggleThreadMessage(message); }} type="button">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-[12px] font-bold shrink-0 ${sent ? 'bg-[var(--gnosi-blue)] text-white' : 'bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)]'}`}>
                {sender[0]?.toLocaleUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[13px] font-bold ${sent ? 'text-[var(--gnosi-blue)]' : 'text-[var(--text-primary)]'}`}>{sender}</span>
                  {sent && <span className="text-[10px] font-bold text-[var(--gnosi-blue)]/60 uppercase tracking-wider">{t('mail.sent_badge', 'sent')}</span>}
                  {!sent && !expanded && <span className="text-[12px] text-[var(--text-secondary)] truncate opacity-60 max-w-[300px]">{message.snippet}</span>}
                </div>
                {expanded && (
                  <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                    {sent ? t('mail.to_label_short', 'To') : t('mail.to_label', 'To')}: {cleanMailAddress(message.recipient || controller.mailData?.recipient)}
                    {(message.cc || (main && controller.mailData?.cc)) && <span className="ml-2 opacity-70">{t('mail.cc_label', 'CC')}: {cleanMailAddress(message.cc || controller.mailData?.cc)}</span>}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-[var(--text-secondary)] font-medium">{date}</span>
                <ChevronDown className={`text-[var(--text-secondary)] transition-transform ${expanded ? 'rotate-180' : ''}`} size={14} />
              </div>
            </button>
            {expanded && (
              <div className="border-t border-[var(--border-primary)]/60 px-5 py-5">
                {content ? (
                  <>
                    <MailBody bodyHtml={content.body_html} bodyText={content.body_text || message.snippet} email={message.account || controller.account?.email} folder={message.imap_folder} messageId={message.id} remoteImageBlockedLabel={t('mail.remote_image_blocked', 'Remote image blocked for privacy')} remoteImageOpenOriginalLabel={t('mail.remote_image_open_original', 'Open original')} remoteImageRecoveryLabel={t('mail.remote_image_recovery', 'Load safely')} remoteImageRecoveringLabel={t('mail.remote_image_recovering', 'Loading safely…')} remoteImageRetryLabel={t('common.retry', 'Try again')} remoteImageUnavailableDetail={t('mail.remote_image_unavailable_detail', 'The origin blocked access or requires data that Gnosi does not send.')} remoteImageUnavailableLabel={t('mail.remote_image_unavailable', 'Remote image unavailable')} />
                    {(content.attachments?.length ?? 0) > 0 && (
                      <MailAttachments attachments={content.attachments ?? []} email={message.account || controller.account?.email || ''} folder={message.imap_folder} messageId={message.id} />
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-center py-8"><div className="w-5 h-5 border-2 border-[var(--gnosi-blue)] border-t-transparent rounded-full animate-spin" /></div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
