import { File as FileIcon, FileText, Paperclip } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mailAttachmentUrl } from '../../../shared/api/mail-specialized';
import { MailPdfViewer } from './MailPdfViewer';
import type { MailViewerAttachment } from './mailViewerTypes';


interface MailAttachmentsProps {
  readonly attachments: readonly MailViewerAttachment[];
  readonly email: string;
  readonly folder?: string | null;
  readonly messageId: string;
}


function attachmentUrl(
  attachment: MailViewerAttachment,
  messageId: string,
  email: string,
  folder: string,
  inline = false,
): string {
  const id = attachment.attachment_id ?? attachment.part_index ?? '';
  return mailAttachmentUrl(messageId, String(id), email, {
    contentType: inline ? attachment.content_type || undefined : undefined,
    filename: attachment.filename || undefined,
    folder: folder || 'INBOX',
    inline: inline || undefined,
  });
}


function attachmentSize(size: number | null | undefined): string {
  const bytes = size ?? 0;
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${String(Math.round(bytes / 1024))} KB`;
}


function AttachmentIcon({ contentType }: { readonly contentType?: string | null }) {
  if (contentType?.includes('pdf')) {
    return <FileText size={16} className="shrink-0 text-red-500" />;
  }
  return <FileIcon size={16} className={contentType?.startsWith('image/') ? 'shrink-0 text-blue-400' : 'shrink-0 text-[var(--gnosi-blue)]'} />;
}


export function MailAttachments({
  attachments,
  email,
  folder = 'INBOX',
  messageId,
}: MailAttachmentsProps) {
  const { t } = useTranslation();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const safeFolder = folder || 'INBOX';
  const active = previewIndex === null ? null : attachments[previewIndex] ?? null;
  const activePdf = Boolean(active && (
    active.content_type?.includes('pdf')
    || active.filename?.toLocaleLowerCase().endsWith('.pdf')
  ));
  const activeImage = Boolean(active?.content_type?.startsWith('image/'));

  return (
    <div className="mb-2 mt-6">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">
        <Paperclip size={12} />
        {t('mail.attachments_count', { count: attachments.length })}
      </div>
      <div className="flex flex-wrap gap-2">
        {attachments.map((attachment, index) => {
          const canPreview = Boolean(
            attachment.content_type?.includes('pdf')
            || attachment.filename?.toLocaleLowerCase().endsWith('.pdf')
            || attachment.content_type?.startsWith('image/'),
          );
          const isActive = previewIndex === index;
          return (
            <div key={`${attachment.filename || 'attachment'}-${String(index)}`} className="flex items-center gap-1">
              <a
                href={attachmentUrl(attachment, messageId, email, safeFolder)}
                download={attachment.filename || undefined}
                className="flex max-w-[220px] items-center gap-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-[13px] font-medium text-[var(--text-primary)] transition-all hover:bg-[var(--sidebar-item-active)] hover:text-[var(--gnosi-blue)]"
                title={t('mail.download_attachment', 'Download')}
              >
                <AttachmentIcon contentType={attachment.content_type} />
                <span className="truncate">{attachment.filename}</span>
                <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">
                  {attachmentSize(attachment.size)}
                </span>
              </a>
              {canPreview && (
                <button
                  type="button"
                  onClick={() => { setPreviewIndex(isActive ? null : index); }}
                  className={`shrink-0 rounded-xl border px-2 py-2 text-[11px] font-bold transition-all ${isActive ? 'border-[var(--gnosi-blue)] bg-[var(--gnosi-blue)] text-white' : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--gnosi-blue)] hover:bg-[var(--sidebar-item-active)]'}`}
                  title={t('mail.preview_attachment', 'Preview')}
                >{isActive ? '▲' : '▼'}</button>
              )}
            </div>
          );
        })}
      </div>
      {active && (
        <div className="mt-4 w-full">
          {activePdf && (
            <MailPdfViewer url={attachmentUrl(active, messageId, email, safeFolder, true)} />
          )}
          {activeImage && (
            <img
              src={attachmentUrl(active, messageId, email, safeFolder, true)}
              alt={active.filename || ''}
              className="w-full rounded-xl border border-[var(--border-primary)]"
              style={{ maxHeight: '75vh', objectFit: 'contain' }}
            />
          )}
        </div>
      )}
    </div>
  );
}
