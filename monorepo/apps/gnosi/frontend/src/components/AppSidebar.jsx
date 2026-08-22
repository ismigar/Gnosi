import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Home, Network, BookOpen, Gauge, Share2, Settings, Menu, X, FileText, Calendar, Inbox, LayoutGrid, Clock, PenTool, Image as ImageIcon, Users, User, LogOut, CalendarRange, CircleHelp, NotebookTabs } from 'lucide-react';
import { useTranslation } from 'react-i18next';
// The Settings modal drags in the BlockEditor (blocknote/tiptap) and other
// heavy views. By lazy-loading it we avoid these libraries
// entering the initial bundle just because the sidebar references the modal.
const GlobalSettingsModal = lazy(() =>
  import('./GlobalSettingsModal').then((m) => ({ default: m.GlobalSettingsModal })),
);
import { WorkspaceSwitcher } from './Navigation/WorkspaceSwitcher';
import VaultMenu from './VaultMenu';
import { useAuth } from '../context/AuthContext';
import { toast } from '../lib/toast';
import { usePlugins } from '../plugins/usePlugins';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useModalKeyboard } from '../hooks/useModalKeyboard';

export const ENGINEERING_DOCUMENTATION_URL = 'https://gnosi.temenosismael.org/engineering/';

const GIcon = ({ size = 14 }) => (
    <div style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '4px',
        border: '1.5px solid currentColor',
        color: 'inherit',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Outfit',
        fontWeight: 'bold',
        fontSize: `${Math.floor(size * 0.65)}px`,
        transition: 'all 0.2s ease'
    }}>G</div>
);

const navItems = [
    { to: '/vault',             icon: FileText,   labelKey: 'sidebar.nav_vault',     shortcut: 'Ctrl 1' },
    { to: '/graph',             icon: Network,    labelKey: 'sidebar.nav_graph',     shortcut: 'Ctrl 2' },
    { to: '/contacts',          icon: Users,      labelKey: 'sidebar.nav_contacts',  shortcut: 'Ctrl 3', pluginId: 'contacts' },
    { to: '/mail',              icon: Inbox,      labelKey: 'sidebar.nav_mail',      shortcut: 'Ctrl 4', pluginId: 'mail' },
    { to: '/calendar',          icon: Calendar,   labelKey: 'sidebar.nav_calendar',  shortcut: 'Ctrl 5', pluginId: 'calendar' },
    { to: '/reader',            icon: BookOpen,   labelKey: 'sidebar.nav_reader',    shortcut: 'Ctrl 6', pluginId: 'feeds-reader' },
    { to: '/notebooks',         icon: NotebookTabs, labelKey: 'sidebar.nav_notebooks', shortcut: '', pluginId: 'grounded-notebooks' },
    { to: '/social-dashboard',  icon: Share2,     labelKey: 'sidebar.nav_social',    shortcut: 'Ctrl 7', pluginId: 'social-publishing' },
    { to: '/media',             icon: ImageIcon,  labelKey: 'sidebar.nav_media',     shortcut: 'Ctrl 8', pluginId: 'social-publishing' },
    { to: '/planning',          icon: CalendarRange, labelKey: 'sidebar.nav_planning', shortcut: '', pluginId: 'project-planning' },
];

function getInitialSettingsRequest() {
    const params = new URLSearchParams(window.location.search);
    return {
        open: params.has('auth'),
        tab: params.get('tab') || 'general',
    };
}

export function AppSidebar() {
    const initialSettingsRequest = getInitialSettingsRequest();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(initialSettingsRequest.open);
    const [settingsTab, setSettingsTab] = useState(initialSettingsRequest.tab);
    const [gnosiMode, setGnosiMode] = useState('personal');
    const mobileToggleRef = React.useRef(null);
    const navigationRef = React.useRef(null);
    const isCompact = useMediaQuery('(max-width: 767px)');
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { user, logout } = useAuth();
    const { isEnabled } = usePlugins();
    const visibleNavItems = useMemo(
        () => navItems.filter((item) => !item.pluginId || isEnabled(item.pluginId)),
        [isEnabled],
    );

    useModalKeyboard({
        isOpen: isCompact && mobileOpen,
        onClose: () => setMobileOpen(false),
        containerRef: navigationRef,
        trapFocus: true,
    });

    // The command palette (and other places) can request opening settings.
    useEffect(() => {
        const open = () => setSettingsOpen(true);
        window.addEventListener('gnosi:open-settings', open);
        return () => window.removeEventListener('gnosi:open-settings', open);
    }, []);

    const handleLogout = async () => {
        await logout();
        toast.success(t('sidebar.logged_out', "Signed out."));
    };

    useEffect(() => {
        // Fetch health to get gnosi_mode
        fetch('/api/health')
            .then(res => res.json())
            .then(data => {
                if (data.gnosi_mode) setGnosiMode(data.gnosi_mode);
            })
            .catch(err => console.error("Error fetching gnosi mode:", err));

        // Detect OAuth return params
        const params = new URLSearchParams(window.location.search);
        if (params.get('auth')) {
            // Clean up URL params without refreshing
            const newUrl = window.location.pathname;
            window.history.replaceState({}, '', newUrl);
        }

        const handleOpenSettings = (e) => {
            if (e.detail) {
                setSettingsTab(typeof e.detail === 'string' ? e.detail : (e.detail.tab || 'general'));
            }
            setSettingsOpen(true);
        };
        window.addEventListener('open-settings', handleOpenSettings);
        return () => window.removeEventListener('open-settings', handleOpenSettings);
    }, []);

    useEffect(() => {
        const handler = (e) => {
            if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
            const target = navItems.find((item) => item.shortcut === `Ctrl ${e.key}`);
            if (target && (!target.pluginId || isEnabled(target.pluginId))) {
                e.preventDefault();
                navigate(target.to);
                setMobileOpen(false);
            } else if (e.key === ',') {
                e.preventDefault();
                setSettingsOpen(true);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isEnabled, navigate]);

    return (
        <>
            {/* Mobile Toggle */}
            <button
                ref={mobileToggleRef}
                className="app-sidebar-mobile-toggle"
                onClick={() => setMobileOpen(!mobileOpen)}
                aria-expanded={mobileOpen}
                aria-controls="gnosi-global-navigation"
                aria-label={t('sidebar.toggle_navigation', 'Toggle navigation')}
            >
                {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            {/* Overlay */}
            {mobileOpen && (
                <div
                    className="app-sidebar-overlay"
                    onClick={() => setMobileOpen(false)}
                    aria-hidden="true"
                />
            )}

            {/* Sidebar */}
            <nav
                ref={navigationRef}
                id="gnosi-global-navigation"
                aria-label={t('sidebar.main_navigation', 'Main navigation')}
                aria-hidden={isCompact && !mobileOpen ? 'true' : undefined}
                inert={isCompact && !mobileOpen}
                className={`app-sidebar ${mobileOpen ? 'app-sidebar--open' : ''}`}
            >
                <div className="app-sidebar__header">
                    {/* Logo */}
                    <div className="app-sidebar__logo-wrapper">
                        <Link
                            to="/"
                            className="app-sidebar__logo"
                            title="Gnosi"
                            aria-label={t('command_palette.nav_home', 'Go to Home')}
                            onClick={() => setMobileOpen(false)}
                        >
                            G
                        </Link>
                    </div>

                    {gnosiMode !== 'personal' && <WorkspaceSwitcher />}
                </div>

                {/* Nav Items */}
                <div className="app-sidebar__nav">
                    {visibleNavItems.map(({ to, icon: Icon, labelKey, shortcut }) => {
                        const label = t(labelKey);
                        return (
                            <NavLink
                                key={to}
                                to={to}
                                end={to === '/'}
                                title={label}
                                aria-label={label}
                                onClick={() => setMobileOpen(false)}
                                className={({ isActive }) =>
                                    `app-sidebar__item ${isActive ? 'app-sidebar__item--active' : ''}`
                                }
                            >
                                <Icon size={16} strokeWidth={1.5} />
                                <span className="app-sidebar__tooltip">
                                    <span>{label}</span>
                                    {shortcut && <kbd className="app-sidebar__tooltip-kbd">{shortcut}</kbd>}
                                </span>
                            </NavLink>
                        );
                    })}
                </div>

                <div className="app-sidebar__footer">
                    {gnosiMode === 'personal' && <VaultMenu />}
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
                        onClick={() => setMobileOpen(false)}
                        className={({ isActive }) =>
                            `app-sidebar__item ${isActive ? 'app-sidebar__item--active' : ''}`
                        }
                    >
                        <Gauge size={16} strokeWidth={1.5} />
                        <span className="app-sidebar__tooltip">
                            <span>{t('sidebar.nav_dashboard')}</span>
                        </span>
                    </NavLink>
                    <button
                        className="app-sidebar__item"
                        title={t('sidebar.nav_settings')}
                        aria-label={t('sidebar.nav_settings')}
                        onClick={() => setSettingsOpen(true)}
                    >
                        <Settings size={16} strokeWidth={1.5} />
                        <span className="app-sidebar__tooltip">
                            <span>{t('sidebar.nav_settings')}</span>
                            <kbd className="app-sidebar__tooltip-kbd">Ctrl ,</kbd>
                        </span>
                    </button>

                    {user && (
                        <button
                            className="app-sidebar__item"
                            title={t('sidebar.logout_tooltip_title', "{{user}} — Sign out", { user: user.name || user.email })}
                            aria-label={t('sidebar.logout_tooltip_label', "Sign out ({{user}})", { user: user.name || user.email })}
                            onClick={handleLogout}
                        >
                            <LogOut size={16} strokeWidth={1.5} />
                            <span className="app-sidebar__tooltip">
                                <span>{t('sidebar.logout_tooltip_label', "Sign out ({{user}})", { user: user.name || user.email })}</span>
                            </span>
                        </button>
                    )}

                </div>
            </nav>

            {/* Global Settings Modal */}
            {settingsOpen && (
                <Suspense fallback={null}>
                    <GlobalSettingsModal
                        isOpen={settingsOpen}
                        onClose={() => setSettingsOpen(false)}
                        initialTab={settingsTab}
                    />
                </Suspense>
            )}
        </>
    );
}
