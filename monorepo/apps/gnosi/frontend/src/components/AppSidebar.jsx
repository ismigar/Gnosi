import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Home, Network, BookOpen, Gauge, Share2, Settings, Menu, X, FileText, Calendar, Inbox, LayoutGrid, Clock, PenTool, Image as ImageIcon, Users, User, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
// El modal de Configuració arrossega el BlockEditor (blocknote/tiptap) i altres
// vistes pesades. Carregant-lo mandrosament evitem que aquestes llibreries
// entrin al bundle inicial només perquè la barra lateral hi referencia el modal.
const GlobalSettingsModal = lazy(() =>
  import('./GlobalSettingsModal').then((m) => ({ default: m.GlobalSettingsModal })),
);
import { WorkspaceSwitcher } from './Navigation/WorkspaceSwitcher';
import { useAuth } from '../context/AuthContext';
import { toast } from '../lib/toast';

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
    { to: '/contacts',          icon: Users,      labelKey: 'sidebar.nav_contacts',  shortcut: 'Ctrl 3' },
    { to: '/mail',              icon: Inbox,      labelKey: 'sidebar.nav_mail',      shortcut: 'Ctrl 4' },
    { to: '/calendar',          icon: Calendar,   labelKey: 'sidebar.nav_calendar',  shortcut: 'Ctrl 5' },
    { to: '/reader',            icon: BookOpen,   labelKey: 'sidebar.nav_reader',    shortcut: 'Ctrl 6' },
    { to: '/social-dashboard',  icon: Share2,     labelKey: 'sidebar.nav_social',    shortcut: 'Ctrl 7' },
    { to: '/media',             icon: ImageIcon,  labelKey: 'sidebar.nav_media',     shortcut: 'Ctrl 8' },
];

export function AppSidebar() {
    const [mobileOpen, setMobileOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsTab, setSettingsTab] = useState('general');
    const [gnosiMode, setGnosiMode] = useState('personal');
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { user, logout } = useAuth();

    // La paleta de comandes (i altres llocs) poden demanar obrir la configuració.
    useEffect(() => {
        const open = () => setSettingsOpen(true);
        window.addEventListener('gnosi:open-settings', open);
        return () => window.removeEventListener('gnosi:open-settings', open);
    }, []);

    const handleLogout = async () => {
        await logout();
        toast.success('Sessió tancada.');
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
            const tab = params.get('tab');
            if (tab) setSettingsTab(tab);
            setSettingsOpen(true);
            
            // Clean up URL params without refreshing
            const newUrl = window.location.pathname;
            window.history.replaceState({}, '', newUrl);
        }

        const handleOpenSettings = (e) => {
            if (e.detail) {
                setSettingsTab(e.detail);
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
            const idx = parseInt(e.key) - 1;
            if (idx >= 0 && idx < navItems.length) {
                e.preventDefault();
                navigate(navItems[idx].to);
            } else if (e.key === ',') {
                e.preventDefault();
                setSettingsOpen(true);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [navigate]);

    return (
        <>
            {/* Mobile Toggle */}
            <button
                className="app-sidebar-mobile-toggle"
                onClick={() => setMobileOpen(!mobileOpen)}
                aria-label="Toggle navigation"
            >
                {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            {/* Overlay */}
            {mobileOpen && (
                <div
                    className="app-sidebar-overlay"
                    onClick={() => setMobileOpen(false)}
                />
            )}

            {/* Sidebar */}
            <nav className={`app-sidebar ${mobileOpen ? 'app-sidebar--open' : ''}`}>
                <div className="app-sidebar__header">
                    {/* Logo */}
                    <div className="app-sidebar__logo-wrapper">
                        <Link to="/" className="app-sidebar__logo" title="Gnosi">
                            G
                        </Link>
                    </div>

                    {gnosiMode !== 'personal' && <WorkspaceSwitcher />}
                </div>

                {/* Nav Items */}
                <div className="app-sidebar__nav">
                    {navItems.map(({ to, icon: Icon, labelKey, shortcut }) => {
                        const label = t(labelKey);
                        return (
                            <NavLink
                                key={to}
                                to={to}
                                end={to === '/'}
                                title={label}
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
                    <NavLink
                        to="/dashboard"
                        title={t('sidebar.nav_dashboard')}
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
                            title={`${user.name || user.email} — Tancar sessió`}
                            onClick={handleLogout}
                        >
                            <LogOut size={16} strokeWidth={1.5} />
                            <span className="app-sidebar__tooltip">
                                <span>Tancar sessió ({user.name || user.email})</span>
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
                        onClose={() => { setSettingsOpen(false); setTimeout(() => window.location.reload(), 400); }}
                        initialTab={settingsTab}
                    />
                </Suspense>
            )}
        </>
    );
}
