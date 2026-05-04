import React, { useState, useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Home, Network, BookOpen, Gauge, Share2, Settings, Menu, X, FileText, Calendar, Inbox, LayoutGrid, Clock, PenTool, Image as ImageIcon } from 'lucide-react';
import { GlobalSettingsModal } from './GlobalSettingsModal';

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
    { to: '/vault', icon: FileText, label: 'Vault' },
    { to: '/graph', icon: Network, label: 'Graf' },
    { to: '/mail', icon: Inbox, label: 'Mail' },
    { to: '/calendar', icon: Calendar, label: 'Calendari' },
    { to: '/reader', icon: BookOpen, label: 'Lector' },
    { to: '/social-dashboard', icon: Share2, label: 'Social' },
    { to: '/media', icon: ImageIcon, label: 'Fotos' },
];

export function AppSidebar() {
    const [mobileOpen, setMobileOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsTab, setSettingsTab] = useState('general');

    useEffect(() => {
        const handleOpenSettings = (e) => {
            if (e.detail) {
                setSettingsTab(e.detail);
            }
            setSettingsOpen(true);
        };
        window.addEventListener('open-settings', handleOpenSettings);
        return () => window.removeEventListener('open-settings', handleOpenSettings);
    }, []);


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
                {/* Logo */}
                <div className="app-sidebar__logo-wrapper">
                    <Link to="/" className="app-sidebar__logo" title="Gnosi">
                        G
                    </Link>
                </div>

                {/* Nav Items */}
                <div className="app-sidebar__nav">
                    {navItems.map(({ to, icon: Icon, label }) => (
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
                            <Icon size={18} strokeWidth={1.5} />
                            <span className="app-sidebar__tooltip">{label}</span>
                        </NavLink>
                    ))}
                </div>

                <div className="app-sidebar__footer">
                    <NavLink
                        to="/dashboard"
                        title="Control Center"
                        onClick={() => setMobileOpen(false)}
                        className={({ isActive }) =>
                            `app-sidebar__item ${isActive ? 'app-sidebar__item--active' : ''}`
                        }
                    >
                        <Gauge size={18} strokeWidth={1.5} />
                        <span className="app-sidebar__tooltip">Control</span>
                    </NavLink>
                    <button
                        className="app-sidebar__item"
                        title="Configuració"
                        onClick={() => setSettingsOpen(true)}
                    >
                        <Settings size={18} strokeWidth={1.5} />
                        <span className="app-sidebar__tooltip">Config</span>
                    </button>

                </div>
            </nav>

            {/* Global Settings Modal */}
            <GlobalSettingsModal
                isOpen={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                initialTab={settingsTab}
            />
        </>
    );
}
