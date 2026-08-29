import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveVaultName } from '../hooks/useActiveVaultName';

interface AppHeaderIconProps {
    readonly size?: number;
    readonly strokeWidth?: number;
}

export interface AppHeaderProps {
    readonly children?: ReactNode;
    readonly icon?: ComponentType<AppHeaderIconProps>;
    readonly showVault?: boolean;
    readonly subtitle?: ReactNode;
    readonly title: ReactNode;
}

export function AppHeader({
    icon: Icon,
    title,
    subtitle,
    children,
    showVault = true,
}: AppHeaderProps) {
    const { t } = useTranslation();
    const activeVaultName = useActiveVaultName();

    return (
        <header className={`app-header ${children ? 'app-header--with-actions' : ''}`}>
            <div className="app-header__identity">
                {Icon && (
                    <span className="app-header__icon" aria-hidden="true">
                        <Icon size={18} strokeWidth={1.8} />
                    </span>
                )}
                <div className="app-header__copy">
                    <div className="app-header__title-row">
                        <h1 className="app-header__title">{title}</h1>
                        {showVault && (
                            <span className="gnosi-vault-badge">
                                {t('common.vault_label', 'Vault')}: {activeVaultName || '…'}
                            </span>
                        )}
                    </div>
                    {subtitle && <p className="app-header__subtitle">{subtitle}</p>}
                </div>
            </div>
            {children && <div className="app-header__actions">{children}</div>}
        </header>
    );
}
