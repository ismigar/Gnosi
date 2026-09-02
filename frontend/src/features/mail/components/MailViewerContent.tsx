import { FileText, Mail, Tag } from 'lucide-react';

import { TagPill } from './MailTagPicker';
import { MailSmartSuggestions } from './MailSmartSuggestions';
import { MailThread } from './MailThread';
import type { MailViewerController } from './useMailViewerController';


export function MailViewerContent({ controller }: { readonly controller: MailViewerController }) {
  const { t } = controller;
  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide" data-role="mail-viewer-scroll">
      <div className="max-w-5xl mx-auto px-6 lg:px-12 pt-8">
        <h1 className="text-2xl font-extrabold text-[var(--text-primary)] leading-tight mb-3 tracking-tight">{controller.mailData?.subject}</h1>
        <div className="flex flex-wrap gap-2 items-center mb-6">
          <div className="flex items-center gap-1.5 bg-[var(--bg-secondary)] px-2 py-1 rounded-lg border border-[var(--border-primary)]">
            <Tag className="text-[var(--text-secondary)]" size={11} />
            <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">{controller.mailData?.category || t('mail.category_general', 'General')}</span>
          </div>
          {controller.activeTagIds.map((tagId) => {
            const tag = controller.mailTags.tags.find((item) => item.id === tagId);
            return tag ? (
              <TagPill key={tagId} onRemove={(id) => { void controller.setTags(controller.activeTagIds.filter((item) => item !== id)); }} tag={tag} />
            ) : null;
          })}
          {controller.allThreadMessages.length > 1 && (
            <div className="flex items-center gap-1.5 bg-[var(--bg-secondary)] px-2 py-1 rounded-lg border border-[var(--border-primary)]">
              <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">{t('mail.thread_messages_count', { count: controller.allThreadMessages.length })}</span>
            </div>
          )}
          {controller.formLinks.map((link) => (
            <button className="flex items-center gap-2 bg-gradient-to-r from-orange-500 to-amber-500 text-white px-2.5 py-1 rounded-lg shadow-sm hover:shadow-md transition-all animate-pulse hover:animate-none" key={link} onClick={() => { void controller.fillForm(link); }} type="button">
              <FileText size={12} /><span className="text-[10px] font-bold uppercase tracking-wider">{t('mail.fill_form_button', 'Fill Form')}</span>
            </button>
          ))}
        </div>
        <MailSmartSuggestions controller={controller} />
        <MailThread controller={controller} />
      </div>
    </div>
  );
}


export function MailViewerEmpty({ controller }: { readonly controller: MailViewerController }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[var(--bg-primary)]">
      <div className="w-24 h-24 rounded-3xl bg-[var(--bg-secondary)] flex items-center justify-center mb-6 shadow-inner"><Mail className="text-[var(--border-primary)]" size={40} /></div>
      <p className="text-lg font-semibold text-[var(--text-secondary)]">{controller.t('mail.select_mail')}</p>
      <p className="text-sm text-[var(--text-secondary)] opacity-60">{controller.t('mail.select_mail_hint')}</p>
    </div>
  );
}


export function MailViewerLoading({ controller }: { readonly controller: MailViewerController }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[var(--bg-primary)]">
      <div className="w-12 h-12 border-4 border-[var(--gnosi-blue)] border-t-transparent rounded-full animate-spin mb-4" />
      <p className="text-[var(--text-secondary)] font-medium">{controller.t('mail.loading')}</p>
    </div>
  );
}
