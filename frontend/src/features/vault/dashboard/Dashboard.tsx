import { VaultShell } from '../navigation/VaultShell';
import { dispatchWindowEvent } from '../../../shared/platform/browser-events';
import { useDashboardController } from './useDashboardController';
import { DashboardSidebar } from './DashboardSidebar';
import { DashboardContent } from './DashboardContent';
import { BrowseDialogs } from './BrowseDialogs';
import { ConfirmationDialogs } from './ConfirmationDialogs';
import { ConfigurationDialogs } from './ConfigurationDialogs';
export default function Dashboard() {
  const dashboard = useDashboardController();
  return <VaultShell
    sidebarContent={<DashboardSidebar {...dashboard} />}
    breadcrumbs={dashboard.breadcrumbs}
    onSearch={() => { dashboard.setIsGlobalSearchOpen(true); }}
    onBack={dashboard.handleNavigationBack}
    onForward={dashboard.handleNavigationForward}
    canGoBack={dashboard.canGoBack}
    canGoForward={dashboard.canGoForward}
    showDocumentControls={(dashboard.viewMode === 'editor' || dashboard.viewMode === 'drawing') && dashboard.tabs.length === 1}
    onNewDocument={() => { dispatchWindowEvent(new Event('gnosi:quick-open-document')); }}
    onCloseDocument={() => {
      if (dashboard.activeTabId)
        dashboard.handleTabClose(dashboard.activeTabId);
    }}
  >
    <DashboardContent {...dashboard} />
    <BrowseDialogs {...dashboard} />
    <ConfirmationDialogs {...dashboard} />
    <ConfigurationDialogs {...dashboard} />
  </VaultShell>;
}
