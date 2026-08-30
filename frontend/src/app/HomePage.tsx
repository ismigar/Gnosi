import type { MouseEvent as ReactMouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    BookOpen,
    Calendar,
    CalendarRange,
    FileText,
    Gauge,
    Image as ImageIcon,
    Inbox,
    Network,
    NotebookTabs,
    Settings,
    Share2,
    Users,
    type LucideIcon,
} from 'lucide-react';

import { useActiveVaultName } from '../shared/hooks/useActiveVaultName';
import { usePlugins } from '../plugins/usePlugins';
import { emitAppEvent } from '../shared/platform/app-events';
import { legacyBrowserPathToCanonical } from '../lib/vaultRouting';

interface HomeModule {
    readonly descKey: string;
    readonly description: string;
    readonly icon: LucideIcon;
    readonly id?: 'settings';
    readonly pluginId?: string;
    readonly title: string;
    readonly titleKey: string;
    readonly to?: string;
}

const MODULES: readonly HomeModule[] = [
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
        pluginId: 'contacts',
    },
    {
        to: '/mail',
        icon: Inbox,
        titleKey: 'home.module_mail_title',
        title: 'Mail (Inbox)',
        descKey: 'home.module_mail_desc',
        description: 'Process your incoming mail.',
        pluginId: 'mail',
    },
    {
        to: '/calendar',
        icon: Calendar,
        titleKey: 'sidebar.nav_calendar',
        title: 'Calendar',
        descKey: 'home.module_calendar_desc',
        description: 'View and manage your events.',
        pluginId: 'calendar',
    },
    {
        to: '/reader',
        icon: BookOpen,
        titleKey: 'home.module_reader_title',
        title: 'Feed Reader',
        descKey: 'home.module_reader_desc',
        description: 'Read and listen to the latest news with AI podcasts.',
        pluginId: 'feeds-reader',
    },
    {
        to: '/social-dashboard',
        icon: Share2,
        titleKey: 'home.module_social_title',
        title: 'Social Media',
        descKey: 'home.module_social_desc',
        description: 'Manage your social networks from one place.',
        pluginId: 'social-publishing',
    },
    {
        to: '/media',
        icon: ImageIcon,
        titleKey: 'home.module_media_title',
        title: 'Photos and Media',
        descKey: 'home.module_media_desc',
        description: 'Explore your media library.',
        pluginId: 'social-publishing',
    },
    {
        to: '/planning',
        icon: CalendarRange,
        titleKey: 'sidebar.nav_planning',
        title: 'Planning',
        descKey: 'home.module_planning_desc',
        description: 'Plan projects, dependencies, resources, and work calendars.',
        pluginId: 'project-planning',
    },
    {
        to: '/notebooks',
        icon: NotebookTabs,
        titleKey: 'sidebar.nav_notebooks',
        title: 'Notebooks',
        descKey: 'home.module_notebooks_desc',
        description: 'Ask grounded questions over selected reference sources.',
        pluginId: 'grounded-notebooks',
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
    const { isEnabled } = usePlugins();
    const activeVaultName = useActiveVaultName();
    const handleSettingsClick = (
        event: ReactMouseEvent<HTMLButtonElement>,
    ) => {
        event.preventDefault();
        emitAppEvent('open-settings', null);
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
                {MODULES.filter(({ pluginId }) => !pluginId || isEnabled(pluginId)).map(({ to, id, icon: Icon, titleKey, title, descKey, description }) => {
                    if (id === 'settings') {
                        return (
                            <button key={id} onClick={handleSettingsClick} className="home-card" data-testid="home-settings-card">
                                <div className="home-card__icon-wrap">
                                    <Icon size={28} strokeWidth={1.5} />
                                </div>
                                <h2 className="home-card__title">{t(titleKey, title)}</h2>
                                <p className="home-card__desc">{t(descKey, description)}</p>
                                <span className="home-card__arrow">→</span>
                            </button>
                        );
                    }
                    if (!to) return null;
                    return (
                        <Link key={to} to={legacyBrowserPathToCanonical(to)} className="home-card">
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
