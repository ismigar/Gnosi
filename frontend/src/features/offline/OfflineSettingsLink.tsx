import { useTranslation } from 'react-i18next';

export function OfflineSettingsLink() {
    const { t } = useTranslation();
    return <section style={{ marginBottom: 24 }}>
        <h3>{t('offline.title', 'Gnosi offline notes')}</h3>
        <p>{t('offline.settingsHelp', 'Open the mobile web companion to choose notes for encrypted offline reading and editing on this device. Sign in and select a Vault first.')}</p>
        <a className="btn-gnosi btn-gnosi-secondary" href="/offline.html" target="_blank" rel="noopener noreferrer">{t('offline.open', 'Set up offline notes')}</a>
    </section>;
}
