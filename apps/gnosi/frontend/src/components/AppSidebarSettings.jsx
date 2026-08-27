import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, PanelLeft, Pin, PinOff, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function AppSidebarSettings({ items, pinnedRoutes, onTogglePinned, onMovePinned }) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filteredItems = useMemo(() => items.filter((item) => (
        !normalizedQuery || t(item.labelKey).toLocaleLowerCase().includes(normalizedQuery)
    )), [items, normalizedQuery, t]);

    return (
        <section className="app-menu-settings" aria-labelledby="app-menu-settings-title">
            <header className="app-menu-settings__header">
                <span className="settings-section-icon-wrap" aria-hidden="true">
                    <PanelLeft size={20} strokeWidth={2} />
                </span>
                <div>
                    <h2 id="app-menu-settings-title">{t('settings.menu.title', 'Application menu')}</h2>
                    <p>{t('settings.menu.description', 'Choose which applications stay pinned and arrange their order. Every enabled application remains available from Quick access.')}</p>
                </div>
            </header>

            <label className="app-menu-settings__search">
                <Search size={17} aria-hidden="true" />
                <span className="sr-only">{t('sidebar.search_applications', 'Search applications')}</span>
                <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('sidebar.search_applications', 'Search applications')}
                />
            </label>

            <div className="app-menu-settings__list">
                {filteredItems.map(({ to, icon: Icon, labelKey }) => {
                    const label = t(labelKey);
                    const pinnedIndex = pinnedRoutes.indexOf(to);
                    const pinned = pinnedIndex >= 0;
                    return (
                        <div className="app-menu-settings__row" key={to}>
                            <span className="app-menu-settings__identity">
                                <span className="app-menu-settings__icon"><Icon size={18} strokeWidth={1.6} /></span>
                                <span>{label}</span>
                            </span>
                            <span className="app-menu-settings__status">
                                {pinned
                                    ? t('settings.menu.pinned', 'Pinned')
                                    : t('settings.menu.quick_access_only', 'Quick access')}
                            </span>
                            <span className="app-menu-settings__actions">
                                {pinned && (
                                    <>
                                        <button type="button" onClick={() => onMovePinned(to, -1)} disabled={pinnedIndex === 0} aria-label={t('sidebar.move_application_up', 'Move {{application}} up', { application: label })}>
                                            <ChevronUp size={17} />
                                        </button>
                                        <button type="button" onClick={() => onMovePinned(to, 1)} disabled={pinnedIndex === pinnedRoutes.length - 1} aria-label={t('sidebar.move_application_down', 'Move {{application}} down', { application: label })}>
                                            <ChevronDown size={17} />
                                        </button>
                                    </>
                                )}
                                <button type="button" onClick={() => onTogglePinned(to)} aria-pressed={pinned} aria-label={pinned ? t('sidebar.unpin_application', 'Unpin {{application}}', { application: label }) : t('sidebar.pin_application', 'Pin {{application}}', { application: label })}>
                                    {pinned ? <PinOff size={17} /> : <Pin size={17} />}
                                </button>
                            </span>
                        </div>
                    );
                })}
                {filteredItems.length === 0 && (
                    <p className="app-menu-settings__empty">{t('sidebar.no_matching_applications', 'No matching applications.')}</p>
                )}
            </div>
        </section>
    );
}

export default AppSidebarSettings;
