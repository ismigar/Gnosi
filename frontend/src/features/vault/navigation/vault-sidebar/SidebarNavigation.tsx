import { CalendarDays, Clock, Hash, LocateFixed, Palette, Plus, Search, Trash2 } from 'lucide-react';
import { NavItem } from './NavigationRows';
import type { SidebarController } from './useSidebarController';
export function SidebarNavigation({ view }: { view: SidebarController; }) {
    const { t, activeVaultName, locateActivePage, activePageId, onSearch, globalSearchShortcut, onOpenRecent, onOpenDaily, currentView, onNavigate, onCreateDrawing, isEditor, showTagsView, isAdmin } = view;
    return (<>
        <div className="vault-sidebar__identity px-3 pt-4 mb-2 flex items-center justify-between group cursor-pointer hover:bg-[var(--bg-secondary)] rounded mx-2 py-1.5 transition-colors">
            <div className="flex min-w-0 items-center gap-2">
                <div className="w-5 h-5 bg-gnosi/10 rounded flex items-center justify-center text-gnosi font-bold text-[10px]">G</div>
                <span className="vault-sidebar__navigation-row truncate font-semibold text-[var(--text-primary)]">{t('common.vault_label', 'Vault')}: {activeVaultName || '…'}</span>
            </div>
            <button
                type="button"
                onClick={locateActivePage}
                disabled={!activePageId}
                className="vault-sidebar-icon-action rounded-md text-[var(--text-secondary)] disabled:opacity-30"
                title={t('sidebar.locate_active_page')}
                aria-label={t('sidebar.locate_active_page')}
            >
                <LocateFixed size={14} />
            </button>
        </div>

        <div className="vault-sidebar__navigation-list px-2">
            <NavItem
                icon={Search}
                label={t('sidebar.search')}
                onClick={onSearch}
                rightElement={<span className="text-[10px] font-semibold text-[var(--text-secondary)] border border-[var(--border-primary)] bg-[var(--bg-secondary)] rounded px-1.5 py-0.5">{t('sidebar.search_shortcut', { shortcut: globalSearchShortcut })}</span>}
            />
            <NavItem icon={Clock} label={t('sidebar.recent')} onClick={onOpenRecent} />
            {onOpenDaily && (
                <NavItem
                    icon={CalendarDays}
                    label={t('sidebar.daily_note', "Daily note")}
                    onClick={() => onOpenDaily()}
                    colorClass="text-emerald-500"
                />
            )}
            <div
                className={`vault-sidebar__navigation-row group relative w-full flex items-center gap-2 px-3 rounded-md transition-colors ${currentView === 'drawing' ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                onClick={() => onNavigate('drawing')}
            >
                <Palette size={16} className={currentView === 'drawing' ? 'text-gnosi' : 'text-amber-500'} />
                <span className="truncate flex-1 text-left text-[var(--text-primary)]">{t('sidebar.drawings')}</span>
                {onCreateDrawing && isEditor && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onCreateDrawing(); }}
                        className="vault-sidebar-icon-action absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded transition-all"
                        title={t('sidebar.add_drawing')}
                        aria-label={t('sidebar.add_drawing')}
                    >
                        <Plus size={14} />
                    </button>
                )}
            </div>
            {showTagsView && (
                <NavItem
                    icon={Hash}
                    label={t('sidebar.tags', "Tags")}
                    onClick={() => onNavigate('tags')}
                    isActive={currentView === 'tags'}
                    colorClass="text-amber-500"
                />
            )}
            {isAdmin && (
                <NavItem
                    icon={Trash2}
                    label={t('sidebar.trash', "Trash")}
                    onClick={() => onNavigate('trash')}
                    isActive={currentView === 'trash'}
                    colorClass="text-[var(--text-secondary)]"
                />
            )}
        </div>
    </>);
}
