import React from 'react';
import { Link } from 'react-router-dom';
import { Network, BookOpen, Gauge, Share2, FileText, Calendar, Inbox, Settings } from 'lucide-react';

const modules = [
    {
        to: '/vault',
        icon: FileText,
        title: 'Vault',
        description: 'Escriu i organitza les teves notes i documents.',
        gradient: 'home-card--graph',
    },
    {
        to: '/graph',
        icon: Network,
        title: 'Graf de Coneixement',
        description: 'Explora les connexions entre les teves idees i recursos.',
        gradient: 'home-card--graph',
    },
    {
        to: '/mail',
        icon: Inbox,
        title: 'Correu (Inbox)',
        description: 'Processa el teu correu entrant.',
        gradient: 'home-card--social',
    },
    {
        to: '/calendar',
        icon: Calendar,
        title: 'Calendari',
        description: 'Visualitza i gestiona els teus esdeveniments.',
        gradient: 'home-card--reader',
    },
    {
        to: '/reader',
        icon: BookOpen,
        title: 'Lector de Feeds',
        description: 'Llegeix i escolta les darreres notícies amb podcast IA.',
        gradient: 'home-card--reader',
    },
    {
        to: '/social-dashboard',
        icon: Share2,
        title: 'Social Media',
        description: 'Gestiona les teves xarxes socials des d\'un sol lloc.',
        gradient: 'home-card--social',
    },
    {
        to: '/dashboard',
        icon: Gauge,
        title: 'Control Center',
        description: 'Monitoritza l\'estat del sistema i aprova eines.',
        gradient: 'home-card--dashboard',
    },
    {
        id: 'settings',
        icon: Settings,
        title: 'Configuració',
        description: 'Gestiona els paràmetres del teu ecosistema.',
        gradient: 'home-card--dashboard',
    },
];

function HomePage() {
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
                <h1 className="home-page__title">Gnosi</h1>
                <p className="home-page__subtitle">
                    El teu ecosistema de coneixement personal
                </p>
            </header>

            {/* Cards Grid */}
            <div className="home-page__grid">
                {modules.map(({ to, id, icon: Icon, title, description, gradient }) => {
                    if (id === 'settings') {
                        return (
                            <button key={id} onClick={handleSettingsClick} className={`home-card ${gradient} text-left w-full border-none cursor-pointer`}>
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
                        <Link key={to} to={to} className={`home-card ${gradient}`}>
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
