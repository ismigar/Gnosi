import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function SettingsBackButton({ onClick }: { readonly onClick: () => void }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            className="btn-gnosi btn-gnosi-secondary"
            onClick={onClick}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 16 }}
        >
            <ArrowLeft size={16} /> {t('settings.tabs.plugins', 'Plugins')}
        </button>
    );
}
