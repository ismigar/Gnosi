import React from 'react';
import { Link } from 'react-router-dom';
import { Network, BookOpen, Gauge, Share2, FileText, Calendar, Inbox, Settings, Users, Image as ImageIcon } from 'lucide-react';
import { useActiveVaultName } from '../hooks/useActiveVaultName';

const modules = [
    {
        to: '/vault',
        icon: FileText,
        title: 'Coneixement',
        description: 'Escriu i organitza les teves notes i documents.',
    },
    {
        to: '/graph',
        icon: Network,
        title: 'Graf de Coneixement',
        description: 'Explora les connexions entre les teves idees i recursos.',
    },
    {
        to: '/contacts',
        icon: Users,
        title: 'Contactes',
        description: 'Gestiona els teus contactes i perfils.',
    },
    {
        to: '/mail',
        icon: Inbox,
        title: 'Correu (Inbox)',
        description: 'Processa el teu correu entrant.',
    },
    {
        to: '/calendar',
        icon: Calendar,
        title: 'Calendari',
        description: 'Visualitza i gestiona els teus esdeveniments.',
    },
    {
        to: '/reader',
        icon: BookOpen,
        title: 'Lector de Feeds',
        description: 'Llegeix i escolta les darreres notícies amb podcast IA.',
    },
    {
        to: '/social-dashboard',
        icon: Share2,
        title: 'Social Media',
        description: 'Gestiona les teves xarxes socials des d\'un sol lloc.',
    },
    {
        to: '/media',
        icon: ImageIcon,
        title: 'Fotos i Media',
        description: 'Explora la teva biblioteca de mitjans.',
    },
    {
        to: '/dashboard',
        icon: Gauge,
        title: 'Control Center',
        description: 'Monitoritza l\'estat del sistema i aprova eines.',
    },
    {
        id: 'settings',
        icon: Settings,
        title: 'Configuració',
        description: 'Gestiona els paràmetres del teu ecosistema.',
    },
];

function HomePage() {
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
                    El teu ecosistema de coneixement personal
                </p>
            </header>

            {/* Cards Grid */}
            <div className="home-page__grid">
                {modules.map(({ to, id, icon: Icon, title, description }) => {
                    if (id === 'settings') {
                        return (
                            <button key={id} onClick={handleSettingsClick} className="home-card">
                                <div className="home-card__icon-wrap">
                                    <Icon size={28} strokeWidth={1.5} />
                                </div>
                                <h2 className="home-card__title">{title}</h2>
                                <p className="home-card__desc">{description}</p>
                                <span className="home-card__arrow">→</span>
                            </button>
                        );
                    }
                    return (
                        <Link key={to} to={to} className="home-card">
                            <div className="home-card__icon-wrap">
                                <Icon size={28} strokeWidth={1.5} />
                            </div>
                            <h2 className="home-card__title">{title}</h2>
                            <p className="home-card__desc">{description}</p>
                            <span className="home-card__arrow">→</span>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}

export default HomePage;
