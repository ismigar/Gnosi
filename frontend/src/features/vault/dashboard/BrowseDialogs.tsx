import { GlobalSearchModal } from '../../../shared/page-search/GlobalSearchModal';
import TagsModal from '../navigation/TagsModal';
import PresentationMode from '../editor/PresentationMode';
import InlineComments from '../comments/InlineComments';
import WorkspacesModal from '../navigation/WorkspacesModal';
import { MetadataLookupModal } from '../../literature/records/MetadataLookupModal';
import { RecentModal } from '../navigation/RecentModal';
import { TranslateLanguagesModal } from '../editor/TranslateLanguagesModal';
import { ProcessResourceModal } from '../../literature/records/ProcessResourceModal';
import type { DashboardController } from './useDashboardController';
export function BrowseDialogs(dashboard: DashboardController) {
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
    handleTableSelect,
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
    setBackgroundLlmWikiJobs,
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
      onRestore={(savedTabs) => {
        savedTabs.forEach((t) => {
          if (t.isTable)
            void handleTableSelect(t.id);
          else
            void loadPage(t.id);
        });
      }}
    />

    <MetadataLookupModal
      isOpen={!!createSourceTableId}
      mode="create"
      onClose={() => { setCreateSourceTableId(null); }}
      onCreate={(suggested) => {
        const tid = createSourceTableId;
        setCreateSourceTableId(null);
        void handleCreateFromSource(tid, suggested);
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
      onContinueInBackground={(job) => {
        if (typeof job.job_id !== 'string' || !job.job_id) return;
        const jobId = job.job_id;
        setBackgroundLlmWikiJobs((current) => ({
          ...current,
          [jobId]: job,
        }));
      }}
    />)}


  </>;
}
