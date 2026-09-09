import { Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function MailViewerEmpty() {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[var(--bg-primary)]">
      <div className="w-24 h-24 rounded-3xl bg-[var(--bg-secondary)] flex items-center justify-center mb-6 shadow-inner"><Mail className="text-[var(--border-primary)]" size={40} /></div>
      <p className="text-lg font-semibold text-[var(--text-secondary)]">{t('mail.select_mail')}</p>
      <p className="text-sm text-[var(--text-secondary)] opacity-60">{t('mail.select_mail_hint')}</p>
    </div>
  );
}
