import { GlobalSearchModal } from '../../../shared/page-search/GlobalSearchModal';
import TagsModal from '../navigation/TagsModal';
import PresentationMode from '../editor/PresentationMode';
import InlineComments from '../comments/InlineComments';
import WorkspacesModal from '../navigation/WorkspacesModal';
import type { SavedWorkspace } from '../navigation/workspacesModel';
import { MetadataLookupModal } from '../../literature/records/MetadataLookupModal';
import { RecentModal } from '../navigation/RecentModal';
import { TranslateLanguagesModal } from '../editor/TranslateLanguagesModal';
import { ProcessResourceModal } from '../../literature/records/ProcessResourceModal';
import type { DashboardController } from './useDashboardController';
type BrowseDialogsProps = DashboardController & {
  readonly onRestoreWorkspace: (workspace: SavedWorkspace) => Promise<void>;
};
export function BrowseDialogs(dashboard: BrowseDialogsProps) {
  const context = dashboard;
  const {
    activeTabId,
    aliasIndex,
    createSourceTableId,
    currentActiveTab,
    currentOpenPage,
    fetchPages,
    getSchemaFromTableId,
    globalIndex,
    handleCreateFromSource,
    isGlobalSearchOpen,
    isPluginEnabled,
    isPresentOpen,
    isRecentOpen,
    isTagsOpen,
    isWorkspacesOpen,
    loadPage,
    openPageTableId,
    pages,
    refreshTableAfterTranslate,
    registry,
    resourceToProcess,
    setCreateSourceTableId,
    setIsGlobalSearchOpen,
    setIsPresentOpen,
    setIsRecentOpen,
    setIsTagsOpen,
    setIsWorkspacesOpen,
    setLlmWikiJobs,
    setResourceToProcess,
    setTranslatePageModalId,
    tabs,
    translatePageModalId,
    translatePageMode,
    viewMode,
  } = context;
  const noteCallbacks = { onNoteSelect: loadPage };
  return <>
    <GlobalSearchModal
      isOpen={isGlobalSearchOpen}
      onClose={() => { setIsGlobalSearchOpen(false); }}
      allNotes={pages}
      tables={registry.tables}
      globalIndex={globalIndex}
      aliasesById={aliasIndex}
      {...noteCallbacks}
    />

    <TagsModal
      isOpen={isPluginEnabled('tags-page') && isTagsOpen}
      onClose={() => { setIsTagsOpen(false); }}
      allNotes={pages}
      {...noteCallbacks}
    />

    <PresentationMode
      isOpen={isPresentOpen}
      onClose={() => { setIsPresentOpen(false); }}
      markdown={currentActiveTab?.content || ''}
    />

    <InlineComments pageId={(viewMode === 'editor' && currentOpenPage && currentActiveTab && !currentActiveTab.isTable && !currentActiveTab.isPdf) ? activeTabId : null} />

    <WorkspacesModal
      isOpen={isWorkspacesOpen}
      onClose={() => { setIsWorkspacesOpen(false); }}
      currentTabs={tabs}
      currentLayout={{ activeTabId, activeTableId: dashboard.activeTableId, activeViewId: dashboard.activeViewId,
        viewMode, splitTabIds: dashboard.splitTabIds, splitTableIds: dashboard.splitTableIds, paneSizes: dashboard.paneSizes }}
      onRestore={workspace => { void dashboard.onRestoreWorkspace(workspace); }}
    />

    <MetadataLookupModal
      isOpen={!!createSourceTableId}
      mode="create"
      onClose={() => { setCreateSourceTableId(null); }}
      onCreate={(suggested, sourceFile) => {
        const tid = createSourceTableId;
        setCreateSourceTableId(null);
        void handleCreateFromSource(tid, suggested, sourceFile);
      }}
    />

    <RecentModal
      isOpen={isRecentOpen}
      onClose={() => { setIsRecentOpen(false); }}
      allNotes={pages}
      {...noteCallbacks}
    />

    {translatePageModalId && (<TranslateLanguagesModal
      isOpen={true}
      mode={translatePageMode}
      noteId={translatePageModalId}
      recordMetadata={currentOpenPage?.metadata || {}}
      schema={openPageTableId ? getSchemaFromTableId(openPageTableId) : {}}
      onClose={() => { setTranslatePageModalId(null); }}
      onTranslated={(data) => { setTranslatePageModalId(null); void refreshTableAfterTranslate(openPageTableId, data); }}
    />)}

    {resourceToProcess && (<ProcessResourceModal
      isOpen={true}
      onClose={() => { setResourceToProcess(null); }}
      noteId={resourceToProcess.noteId}
      title={resourceToProcess.title}
      sourceTableId={resourceToProcess.sourceTableId}
      force={resourceToProcess.force}
      onJobUpdate={(nextJob) => {
        setLlmWikiJobs((current) => ({
          ...current,
          [resourceToProcess.sourceTableId]: {
            ...(current[resourceToProcess.sourceTableId] || {}),
            [resourceToProcess.noteId]: nextJob,
          },
        }));
      }}
      {...{ onProcessed: fetchPages }}
    />)}


  </>;
}
