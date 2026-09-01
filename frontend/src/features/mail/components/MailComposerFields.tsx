import { ChevronDown, File as FileIcon, X } from 'lucide-react';
import type { ChangeEvent } from 'react';

import MailBlockEditor from '../editor/Mail/MailBlockEditor';
import { AddressInput } from './MailAddressInput';
import { accountAddress } from './mailComposerModel';
import type { MailComposerController } from './useMailComposerController';


interface AttachmentBadgeProps {
  readonly file: File;
  readonly onRemove: (file: File) => void;
}


function AttachmentBadge({ file, onRemove }: AttachmentBadgeProps) {
  return (
    <div className="flex max-w-[200px] items-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1.5 text-[12px]">
      <FileIcon size={13} className="shrink-0 text-[var(--gnosi-blue)]" />
      <span className="truncate font-medium text-[var(--text-primary)]">
        {file.name}
      </span>
      <span className="shrink-0 text-[var(--text-secondary)]">
        {Math.round(file.size / 1024)}KB
      </span>
      <button
        type="button"
        onClick={() => { onRemove(file); }}
        className="shrink-0 text-[var(--text-secondary)] transition-colors hover:text-[var(--status-error)]"
      >
        <X size={13} />
      </button>
    </div>
  );
}


interface MailComposerFieldsProps {
  readonly controller: MailComposerController;
}


export function MailComposerFields({ controller }: MailComposerFieldsProps) {
  const {
    account,
    accounts,
    attachFile,
    attachments,
    bcc,
    cc,
    editorInitialHtml,
    fromAccount,
    isReplyOrForward,
    quotedHtml,
    editorRef,
    removeAttachment,
    setBcc,
    setCc,
    setFromAccount,
    setShowCcBcc,
    setSubject,
    setTo,
    showCcBcc,
    signatureHtml,
    subject,
    t,
    to,
  } = controller;

  const selectAccount = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = accounts.find(
      (candidate) => accountAddress(candidate) === event.target.value,
    );
    if (next) setFromAccount(next);
  };

  return (
    <div className="flex-1 space-y-0 overflow-y-auto p-8">
      <div className="mx-auto max-w-[800px]">
        <div className="flex items-center border-b border-[var(--border-primary)] py-2">
          <span className="w-20 shrink-0 text-[13px] font-bold uppercase text-[var(--text-secondary)]">
            {t('mail.from_label')}:
          </span>
          <select
            value={accountAddress(fromAccount)}
            onChange={selectAccount}
            className="flex-1 cursor-pointer appearance-none border-none bg-transparent text-[15px] font-medium text-[var(--text-primary)] outline-none focus:ring-0"
          >
            {accounts.map((candidate) => {
              const email = accountAddress(candidate);
              const label = candidate.name
                ? `${candidate.name} <${email}>`
                : email;
              return <option key={email} value={email}>{label}</option>;
            })}
            {accounts.length === 0 && fromAccount && (
              <option value={accountAddress(fromAccount)}>
                {accountAddress(fromAccount)}
              </option>
            )}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none shrink-0 text-[var(--text-secondary)]"
          />
        </div>

        <AddressInput
          accountEmail={account?.email || undefined}
          label={t('mail.to_label')}
          onChange={setTo}
          placeholder={t('mail.to_email_placeholder', 'example@mail.com')}
          value={to}
        />

        <div className="flex items-center border-b border-[var(--border-primary)] py-2">
          <span className="w-20 shrink-0 text-[13px] font-bold uppercase text-[var(--text-secondary)]">
            {t('mail.subject_label')}:
          </span>
          <input
            type="text"
            className="flex-1 border-none bg-transparent text-[15px] font-bold text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:ring-0"
            placeholder={t('mail.subject_placeholder')}
            value={subject}
            onChange={(event) => { setSubject(event.target.value); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
          />
          <button
            type="button"
            onClick={() => { setShowCcBcc((visible) => !visible); }}
            className="ml-2 flex shrink-0 items-center gap-1 text-[12px] font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--gnosi-blue)]"
          >
            {t('mail.cc_bcc_toggle', 'CC/BCC')}
            <ChevronDown
              size={13}
              className={`transition-transform ${showCcBcc ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        {showCcBcc && (
          <div className="animate-in slide-in-from-top-1 duration-200">
            <AddressInput
              accountEmail={account?.email || undefined}
              label={t('mail.cc_label')}
              onChange={setCc}
              placeholder={t('mail.cc_email_placeholder', 'cc@example.com')}
              value={cc}
            />
            <AddressInput
              accountEmail={account?.email || undefined}
              label={t('mail.bcc_label', 'BCC')}
              onChange={setBcc}
              placeholder={t('mail.bcc_email_placeholder', 'bcc@example.com')}
              value={bcc}
            />
          </div>
        )}

        <div className="min-h-[200px] pt-6">
          <MailBlockEditor
            autoFocus
            editorRef={editorRef}
            initialContent={editorInitialHtml}
            onAttachFile={attachFile}
            onChange={controller.setBody}
            prependEmptyLines={quotedHtml ? 2 : 0}
          />
        </div>

        {!isReplyOrForward && signatureHtml && (
          <div className="mt-3 border-t border-[var(--border-primary)] pt-3">
            <div
              className="text-[13px] leading-relaxed text-[var(--text-secondary)] [&_a]:text-[var(--gnosi-blue)]"
              dangerouslySetInnerHTML={{ __html: signatureHtml }}
            />
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 animate-in slide-in-from-bottom-2 duration-200">
            {attachments.map((file) => (
              <AttachmentBadge
                key={`${file.name}:${String(file.size)}:${String(file.lastModified)}`}
                file={file}
                onRemove={removeAttachment}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
