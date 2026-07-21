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
        title: 'Coneixement',
        descKey: 'home.module_vault_desc',
        description: 'Escriu i organitza les teves notes i documents.',
    },
    {
        to: '/graph',
        icon: Network,
        titleKey: 'home.module_graph_title',
        title: 'Graf de Coneixement',
        descKey: 'home.module_graph_desc',
        description: 'Explora les connexions entre les teves idees i recursos.',
    },
    {
        to: '/contacts',
        icon: Users,
        titleKey: 'sidebar.nav_contacts',
        title: 'Contactes',
        descKey: 'home.module_contacts_desc',
        description: 'Gestiona els teus contactes i perfils.',
    },
    {
        to: '/mail',
        icon: Inbox,
        titleKey: 'home.module_mail_title',
        title: 'Correu (Inbox)',
        descKey: 'home.module_mail_desc',
        description: 'Processa el teu correu entrant.',
    },
    {
        to: '/calendar',
        icon: Calendar,
        titleKey: 'sidebar.nav_calendar',
        title: 'Calendari',
        descKey: 'home.module_calendar_desc',
        description: 'Visualitza i gestiona els teus esdeveniments.',
    },
    {
        to: '/reader',
        icon: BookOpen,
        titleKey: 'home.module_reader_title',
        title: 'Lector de Feeds',
        descKey: 'home.module_reader_desc',
        description: 'Llegeix i escolta les darreres notícies amb podcast IA.',
    },
    {
        to: '/social-dashboard',
        icon: Share2,
        titleKey: 'home.module_social_title',
        title: 'Social Media',
        descKey: 'home.module_social_desc',
        description: 'Gestiona les teves xarxes socials des d\'un sol lloc.',
    },
    {
        to: '/media',
        icon: ImageIcon,
        titleKey: 'home.module_media_title',
        title: 'Fotos i Media',
        descKey: 'home.module_media_desc',
        description: 'Explora la teva biblioteca de mitjans.',
    },
    {
        to: '/dashboard',
        icon: Gauge,
        titleKey: 'home.module_dashboard_title',
        title: 'Control Center',
        descKey: 'home.module_dashboard_desc',
        description: 'Monitoritza l\'estat del sistema i aprova eines.',
    },
    {
        id: 'settings',
        icon: Settings,
        titleKey: 'sidebar.nav_settings',
        title: 'Configuració',
        descKey: 'home.module_settings_desc',
        description: 'Gestiona els paràmetres del teu ecosistema.',
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
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', justifyContent: 'center' }}>
                    <h1 className="home-page__title" style={{ margin: 0 }}>Gnosi</h1>
                    <span style={{
                        fontSize: '0.85rem',
                        fontWeight: 500,
                        color: 'var(--text-tertiary)',
                        backgroundColor: 'var(--bg-secondary)',
                        padding: '4px 10px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-primary)'
                    }}>
                        Vault: {activeVaultName || '…'}
                    </span>
                </div>
                <p className="home-page__subtitle" style={{ marginTop: '8px' }}>
                    {t('home.subtitle', 'El teu ecosistema de coneixement personal')}
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
