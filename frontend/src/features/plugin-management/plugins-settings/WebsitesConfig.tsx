import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { vaultPath } from '../../../shared/routing/vaultRouting';

/** The website manager is a full application surface, not a nested settings editor. */
export function WebsitesConfig() {
    const { t } = useTranslation();
    return <Link to={vaultPath('websites')} className="inline-flex rounded-lg border border-[var(--border-primary)] px-4 py-2 text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]">{t('websites.openManager')}</Link>;
}
