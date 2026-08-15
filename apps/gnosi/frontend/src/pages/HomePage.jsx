import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Network, BookOpen, Gauge, Share2, FileText, Calendar, Inbox, Settings, Users, Image as ImageIcon } from 'lucide-react';
import { useActiveVaultName } from '../hooks/useActiveVaultName';

const MODULES = [
    {
        to: '/vault',
        icon: FileText,
        titleKey: 'common.knowledge',
        title: 'Knowledge',
        descKey: 'home.module_vault_desc',
        description: 'Write and organize your notes and documents.',
    },
    {
        to: '/graph',
        icon: Network,
        titleKey: 'home.module_graph_title',
        title: 'Knowledge Graph',
        descKey: 'home.module_graph_desc',
        description: 'Explore the connections between your ideas and resources.',
    },
    {
        to: '/contacts',
        icon: Users,
        titleKey: 'sidebar.nav_contacts',
        title: 'Contacts',
        descKey: 'home.module_contacts_desc',
        description: 'Manage your contacts and profiles.',
    },
    {
        to: '/mail',
        icon: Inbox,
        titleKey: 'home.module_mail_title',
        title: 'Mail (Inbox)',
        descKey: 'home.module_mail_desc',
        description: 'Process your incoming mail.',
    },
    {
        to: '/calendar',
        icon: Calendar,
        titleKey: 'sidebar.nav_calendar',
        title: 'Calendar',
        descKey: 'home.module_calendar_desc',
        description: 'View and manage your events.',
    },
    {
        to: '/reader',
        icon: BookOpen,
        titleKey: 'home.module_reader_title',
        title: 'Feed Reader',
        descKey: 'home.module_reader_desc',
        description: 'Read and listen to the latest news with AI podcasts.',
    },
    {
        to: '/social-dashboard',
        icon: Share2,
        titleKey: 'home.module_social_title',
        title: 'Social Media',
        descKey: 'home.module_social_desc',
        description: 'Manage your social networks from one place.',
    },
    {
        to: '/media',
        icon: ImageIcon,
        titleKey: 'home.module_media_title',
        title: 'Photos and Media',
        descKey: 'home.module_media_desc',
        description: 'Explore your media library.',
    },
    {
        to: '/dashboard',
        icon: Gauge,
        titleKey: 'home.module_dashboard_title',
        title: 'Control Center',
        descKey: 'home.module_dashboard_desc',
        description: 'Monitor system status and approve tools.',
    },
    {
        id: 'settings',
        icon: Settings,
        titleKey: 'sidebar.nav_settings',
        title: 'Settings',
        descKey: 'home.module_settings_desc',
        description: 'Manage your ecosystem settings.',
    },
];

function HomePage() {
    const { t } = useTranslation();
    const activeVaultName = useActiveVaultName();
    const handleSettingsClick = (e) => {
        if (e) e.preventDefault();
        window.dispatchEvent(new CustomEvent('open-settings'));
    };

    return (
        <div className="home-page">
            {/* Background Ambient Glows */}
            <div className="home-page__glow home-page__glow--1" />
            <div className="home-page__glow home-page__glow--2" />

            {/* Hero */}
            <header className="home-page__hero">
                <div className="flex items-center justify-center gap-3">
                    <h1 className="home-page__title m-0">Gnosi</h1>
                    <span className="gnosi-vault-badge">
                        {t('common.vault_label', 'Vault')}: {activeVaultName || '…'}
                    </span>
                </div>
                <p className="home-page__subtitle mx-auto mt-2 mb-0">
                    {t('home.subtitle', "Your personal knowledge ecosystem")}
                </p>
            </header>

            {/* Cards Grid */}
            <div className="home-page__grid">
                {MODULES.map(({ to, id, icon: Icon, titleKey, title, descKey, description }) => {
                    if (id === 'settings') {
                        return (
                            <button key={id} onClick={handleSettingsClick} className="home-card">
                                <div className="home-card__icon-wrap">
                                    <Icon size={28} strokeWidth={1.5} />
                                </div>
                                <h2 className="home-card__title">{t(titleKey, title)}</h2>
                                <p className="home-card__desc">{t(descKey, description)}</p>
                                <span className="home-card__arrow">→</span>
                            </button>
                        );
                    }
                    return (
                        <Link key={to} to={to} className="home-card">
                            <div className="home-card__icon-wrap">
                                <Icon size={28} strokeWidth={1.5} />
                            </div>
                            <h2 className="home-card__title">{t(titleKey, title)}</h2>
                            <p className="home-card__desc">{t(descKey, description)}</p>
                            <span className="home-card__arrow">→</span>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}

export default HomePage;
