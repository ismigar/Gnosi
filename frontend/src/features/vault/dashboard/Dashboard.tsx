import { lazy, Suspense } from 'react';
import { VaultShell } from '../navigation/VaultShell';
import { dispatchWindowEvent } from '../../../shared/platform/browser-events';
import { useDashboardController } from './useDashboardController';
import { DashboardSidebar } from './DashboardSidebar';
import { DashboardContent } from './DashboardContent';

const BrowseDialogs = lazy(() => import('./BrowseDialogs').then(module => ({ default: module.BrowseDialogs })));
const ConfirmationDialogs = lazy(() => import('./ConfirmationDialogs').then(module => ({ default: module.ConfirmationDialogs })));
const ConfigurationDialogs = lazy(() => import('./ConfigurationDialogs').then(module => ({ default: module.ConfigurationDialogs })));

export default function Dashboard() {
  const dashboard = useDashboardController();
  const hasBrowseDialog = dashboard.isGlobalSearchOpen
    || dashboard.isPresentOpen
    || dashboard.isRecentOpen
    || dashboard.isTagsOpen
    || dashboard.isWorkspacesOpen
    || Boolean(dashboard.createSourceTableId)
    || Boolean(dashboard.translatePageModalId)
    || Boolean(dashboard.resourceToProcess)
    || (dashboard.viewMode === 'editor'
      && Boolean(dashboard.currentOpenPage)
      && Boolean(dashboard.currentActiveTab)
      && !dashboard.currentActiveTab?.isTable
      && !dashboard.currentActiveTab?.isPdf);
  const hasConfirmationDialog = Boolean(dashboard.viewToDelete)
    || Boolean(dashboard.templateToDelete)
    || dashboard.promptModal.isOpen;
  const hasConfigurationDialog = (dashboard.isSchemaModalOpen && Boolean(dashboard.activeTableId))
    || (dashboard.isViewConfigOpen && Boolean(dashboard.viewToConfigure))
    || (dashboard.commentsOpen && Boolean(dashboard.currentOpenPage))
    || (dashboard.shareOpen && Boolean(dashboard.currentOpenPage));
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
    <Suspense fallback={null}>
      {hasBrowseDialog && <BrowseDialogs {...dashboard} />}
      {hasConfirmationDialog && <ConfirmationDialogs {...dashboard} />}
      {hasConfigurationDialog && <ConfigurationDialogs {...dashboard} />}
    </Suspense>
  </VaultShell>;
}
