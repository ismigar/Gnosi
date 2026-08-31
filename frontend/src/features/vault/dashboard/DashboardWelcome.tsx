import { FileText } from 'lucide-react';
import type { TFunction } from 'i18next';

interface DashboardWelcomeProps {
  t: TFunction;
  onCreatePage: () => void;
  onCreateDatabase: () => void;
}

export function DashboardWelcome({ t, onCreatePage, onCreateDatabase }: DashboardWelcomeProps) {
  return <div className="flex flex-col items-center justify-center w-full h-[80vh] text-[var(--text-tertiary)] px-4">
    <FileText
      size={64}
      className="mb-4 text-[var(--bg-tertiary)]"
      strokeWidth={1}
    />
    <h2 className="text-xl font-medium text-[var(--text-secondary)]">{t('vault_welcome_title', 'Welcome')}</h2>
    <p className="mt-2 max-w-md text-center">{t('vault_welcome_subtitle', 'Select a knowledge page or')}</p>
    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
      <button onClick={onCreatePage} className="btn btn-gnosi-primary">
        {t('vault_welcome_create_page', 'Create a page')}
      </button>
      <button onClick={onCreateDatabase} className="btn btn-gnosi-primary">
        {t('vault_welcome_create_db', 'Create a DB')}
      </button>
    </div>
  </div>;
}
