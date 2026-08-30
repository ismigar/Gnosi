import { createVaultDatabase } from '../../shared/api/vaults';
import { deleteVaultDatabase } from '../../shared/api/vaults';
import { deleteVaultTable } from '../../shared/api/vaults';
import { renameVaultTable } from '../../shared/api/vaults';
import { toast } from '../../lib/toast';
import { VaultSidebar } from '../../components/Vault/VaultSidebar';
import { getTableIdFromTab } from './tab-model';
import type { DashboardController } from './useDashboardController';
export function DashboardSidebar(dashboard: DashboardController) {
  const context = dashboard;
  const {
    activeTabId,
    activeTableId,
    favoritePages,
    fetchRegistry,
    handleCreateRecordForTable,
    handleDeletePage,
    handleDuplicatePage,
    handleMovePage,
    handleOpenCreatePrompt,
    handleOpenDailyNote,
    handleOpenParallel,
    handleOpenTableAsTab,
    handleOpenTableParallel,
    handleRenamePage,
    handleTabClose,
    handleTableSelect,
    handleToggleFavorite,
    isPluginEnabled,
    isRegistryLoading,
    loadPage,
    pages,
    registry,
    setActiveTabId,
    setActiveTableId,
    setIsGlobalSearchOpen,
    setIsRecentOpen,
    setPromptModal,
    setSplitTableIds,
    setViewMode,
    sidebarViews,
    t,
    tabs,
    viewMode,
  } = context;
  return (<VaultSidebar
    pages={pages}
    activePageId={activeTabId}
    favoritePages={favoritePages}
    isRegistryLoading={isRegistryLoading}
    onPageSelect={loadPage}
    onOpenParallel={handleOpenParallel}
    onCreatePage={(parentId) => { handleOpenCreatePrompt(parentId, false); }}
    onCreateDashboardPage={(parentId) => { handleOpenCreatePrompt(parentId, false, false, true); }}
    onSearch={() => { setIsGlobalSearchOpen(true); }}
    onOpenRecent={() => { setIsRecentOpen(true); }}
    onOpenDaily={isPluginEnabled('daily-notes') ? handleOpenDailyNote : undefined}
    showTagsView={isPluginEnabled('tags-page')}
    onNavigate={(view: 'editor' | 'drawing' | 'tags' | 'trash') => {
      setViewMode(view);
      if (view !== 'editor')
        setActiveTabId(null);
    }}
    onDeletePage={handleDeletePage}
    onDuplicatePage={handleDuplicatePage}
    onRenamePage={handleRenamePage}
    onToggleFavorite={handleToggleFavorite}
    onMovePage={handleMovePage}
    currentView={viewMode}
    databases={registry.databases}
    tables={registry.tables}
    views={sidebarViews}
    onTableSelect={(tableId, viewId?: string | null, fromHistory = false) => {
      return handleTableSelect(tableId, viewId || null, fromHistory);
    }}
    onOpenTable={handleOpenTableAsTab}
    onOpenTableParallel={handleOpenTableParallel}
    onRenameDatabase={async (dbId, newName) => {
      try {
        const db = registry.databases.find(d => d.id === dbId);
        if (db) {
          await createVaultDatabase({ ...db, name: newName });
          void fetchRegistry();
          toast.success(t('success.db_updated'));
        }
      }
      catch {
        toast.error(t('errors.rename_db'));
      }
    }}
    onDeleteDatabase={async (dbId) => {
      try {
        await deleteVaultDatabase(dbId);
        void fetchRegistry();
        if (activeTabId === dbId || activeTableId === dbId) {
          setActiveTabId(null);
          setActiveTableId(null);
          setViewMode('editor');
        }
        handleTabClose(dbId);
        toast.success(t('success.db_deleted'));
      }
      catch {
        toast.error(t('errors.delete_db'));
      }
    }}
    onRenameTable={async (tableId, newName) => {
      try {
        await renameVaultTable(tableId, { name: newName });
        void fetchRegistry();
        toast.success(t('success.table_updated'));
      }
      catch {
        toast.error(t('errors.rename_table'));
      }
    }}
    onDeleteTable={async (tableId) => {
      try {
        await deleteVaultTable(tableId);
        setSplitTableIds(prev => prev.filter(id => id !== tableId));
        void fetchRegistry();
        if (activeTableId === tableId) {
          setActiveTableId(null);
          setViewMode('editor');
        }
        const tableTab = tabs.find(tab => tab.isTable && getTableIdFromTab(tab) === tableId);
        if (tableTab) {
          handleTabClose(tableTab.id);
        }
        toast.success(t('success.table_deleted'));
      }
      catch {
        toast.error(t('errors.delete_table'));
      }
    }}
    onCreateDatabaseGroup={() => {
      setPromptModal({
        isOpen: true,
        defaultTitle: t('common.new_app'),
        parentId: null,
        isDatabase: false,
        isApp: true,
        isDrawing: false,
        isView: false,
        inputValue: t('common.new_app'),
        isLoading: false
      });
    }}
    onCreateTable={(databaseId) => {
      setPromptModal({
        isOpen: true,
        defaultTitle: t('common.new_table'),
        parentId: null,
        isDatabase: true,
        isDrawing: false,
        isView: false,
        inputValue: t('common.new_table'),
        isLoading: false,
        databaseId: databaseId // Meta to know which db it belongs to
      });
    }}
    onCreateTableRecord={(tableId) => handleCreateRecordForTable(tableId)}
    onCreateDrawing={() => { handleOpenCreatePrompt(null, false, true); }}
  />);
}
