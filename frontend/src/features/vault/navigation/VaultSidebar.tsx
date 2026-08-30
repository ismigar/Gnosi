import { DashboardSection } from './vault-sidebar/DashboardSection';
import { DatabaseSection } from './vault-sidebar/DatabaseSection';
import { FavoritesSection } from './vault-sidebar/FavoritesSection';
import { RegistryDialogs } from './vault-sidebar/RegistryDialogs';
import { SidebarNavigation } from './vault-sidebar/SidebarNavigation';
import { WikiSection } from './vault-sidebar/WikiSection';
import type { VaultSidebarProps } from './vault-sidebar/types';
import { useSidebarController } from './vault-sidebar/useSidebarController';

export const VaultSidebar = (props: VaultSidebarProps) => {
    const { wikiViewportRef, ...view } = useSidebarController(props);
    return (
        <div ref={wikiViewportRef}
            onScroll={event => { if (view.wikiVirtualizationEnabled) view.setWikiScrollTop(event.currentTarget.scrollTop); }}
            className="vault-sidebar flex flex-col h-full select-none overflow-y-auto custom-scrollbar pb-8 bg-[var(--bg-primary)]">
            <SidebarNavigation view={view} />
            <FavoritesSection view={view} />
            <DashboardSection view={view} />
            <DatabaseSection view={view} />
            <WikiSection view={view} />
            <RegistryDialogs view={view} />
        </div>
    );
};
