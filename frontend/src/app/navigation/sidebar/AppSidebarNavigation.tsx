import type { RefObject } from 'react';
import { NavLink } from 'react-router-dom';
import {
    CircleHelp,
    Gauge,
    LogOut,
    PanelTopOpen,
    Settings,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { legacyBrowserPathToCanonical } from '../../../shared/routing/vaultRouting';
import VaultMenu from '../../../features/vault-management/VaultMenu';
import {
    ENGINEERING_DOCUMENTATION_URL,
    type SidebarNavItem,
} from './appSidebarModel';


interface SidebarRailProps {
    readonly items: readonly SidebarNavItem[];
    readonly onSelect: () => void;
    readonly onToggleQuickAccess: () => void;
    readonly quickAccessOpen: boolean;
    readonly quickAccessTriggerRef: RefObject<HTMLButtonElement | null>;
    readonly showQuickAccess: boolean;
}


export function SidebarRail({
    items,
    onSelect,
    onToggleQuickAccess,
    quickAccessOpen,
    quickAccessTriggerRef,
    showQuickAccess,
}: SidebarRailProps) {
    const { t } = useTranslation();
    return <div
        className="app-sidebar__nav"
        aria-label={t('sidebar.pinned_applications', 'Pinned applications')}
    >
        {items.map(({ to, icon: Icon, labelKey, shortcut }) => {
            const label = t(labelKey);
            return <NavLink
                key={to}
                to={legacyBrowserPathToCanonical(to)}
                end={to === '/'}
                title={label}
                aria-label={label}
                onClick={onSelect}
                className={({ isActive }) => (
                    `app-sidebar__item ${isActive ? 'app-sidebar__item--active' : ''}`
                )}
            >
                <Icon size={16} strokeWidth={1.5} />
                <span className="app-sidebar__tooltip">
                    <span>{label}</span>
                    {shortcut ? <kbd className="app-sidebar__tooltip-kbd">{shortcut}</kbd> : null}
                </span>
            </NavLink>;
        })}
        {showQuickAccess ? <button
            ref={quickAccessTriggerRef}
            type="button"
            className="app-sidebar__item"
            title={t('sidebar.open_app_launcher', 'More applications')}
            aria-label={t('sidebar.open_app_launcher', 'More applications')}
            aria-haspopup="menu"
            aria-expanded={quickAccessOpen}
            onClick={onToggleQuickAccess}
        >
            <PanelTopOpen size={16} strokeWidth={1.5} />
            <span className="app-sidebar__tooltip">
                <span>{t('sidebar.open_app_launcher', 'More applications')}</span>
            </span>
        </button> : null}
    </div>;
}


interface SidebarFooterProps {
    readonly isPersonal: boolean;
    readonly onLogout: () => Promise<void>;
    readonly onOpenSettings: () => void;
    readonly onSelect: () => void;
    readonly userLabel: string | null;
}


export function SidebarFooter({
    isPersonal,
    onLogout,
    onOpenSettings,
    onSelect,
    userLabel,
}: SidebarFooterProps) {
    const { t } = useTranslation();
    return <div className="app-sidebar__footer">
        {isPersonal ? <VaultMenu /> : null}
        <a
            href={ENGINEERING_DOCUMENTATION_URL}
            target="_blank"
            rel="noopener noreferrer"
            title={t('sidebar.nav_documentation', 'Engineering documentation')}
            aria-label={t('sidebar.nav_documentation', 'Engineering documentation')}
            className="app-sidebar__item"
        >
            <CircleHelp size={16} strokeWidth={1.5} />
            <span className="app-sidebar__tooltip">
                <span>{t('sidebar.nav_documentation', 'Engineering documentation')}</span>
            </span>
        </a>
        <NavLink
            to="/dashboard"
            title={t('sidebar.nav_dashboard')}
            aria-label={t('sidebar.nav_dashboard')}
            onClick={onSelect}
            className={({ isActive }) => (
                `app-sidebar__item ${isActive ? 'app-sidebar__item--active' : ''}`
            )}
        >
            <Gauge size={16} strokeWidth={1.5} />
            <span className="app-sidebar__tooltip"><span>{t('sidebar.nav_dashboard')}</span></span>
        </NavLink>
        <button
            className="app-sidebar__item"
            title={t('sidebar.nav_settings')}
            aria-label={t('sidebar.nav_settings')}
            onClick={onOpenSettings}
        >
            <Settings size={16} strokeWidth={1.5} />
            <span className="app-sidebar__tooltip">
                <span>{t('sidebar.nav_settings')}</span>
                <kbd className="app-sidebar__tooltip-kbd">Ctrl ,</kbd>
            </span>
        </button>
        {userLabel ? <button
            className="app-sidebar__item"
            title={t('sidebar.logout_tooltip_title', '{{user}} — Sign out', { user: userLabel })}
            aria-label={t('sidebar.logout_tooltip_label', 'Sign out ({{user}})', { user: userLabel })}
            onClick={() => {
                void onLogout();
            }}
        >
            <LogOut size={16} strokeWidth={1.5} />
            <span className="app-sidebar__tooltip">
                <span>{t('sidebar.logout_tooltip_label', 'Sign out ({{user}})', { user: userLabel })}</span>
            </span>
        </button> : null}
    </div>;
}


interface QuickAccessMenuProps {
    readonly items: readonly SidebarNavItem[];
    readonly navigationRef: RefObject<HTMLElement | null>;
    readonly onSelect: () => void;
}


export function QuickAccessMenu({ items, navigationRef, onSelect }: QuickAccessMenuProps) {
    const { t } = useTranslation();
    return <nav
        ref={navigationRef}
        className="app-quick-access"
        role="menu"
        aria-label={t('sidebar.quick_access', 'Quick access')}
    >
        {items.map(({ to, icon: Icon, labelKey }) => {
            const label = t(labelKey);
            return <NavLink
                key={to}
                to={legacyBrowserPathToCanonical(to)}
                role="menuitem"
                title={label}
                aria-label={label}
                onClick={onSelect}
                className={({ isActive }) => (
                    `app-sidebar__item ${isActive ? 'app-sidebar__item--active' : ''}`
                )}
            >
                <Icon size={16} strokeWidth={1.5} />
                <span className="app-sidebar__tooltip"><span>{label}</span></span>
            </NavLink>;
        })}
    </nav>;
}
