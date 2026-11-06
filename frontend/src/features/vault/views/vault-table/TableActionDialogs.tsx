import { ProcessResourceModal } from '../../../literature/records/ProcessResourceModal';
import { PublishSocialModal } from '../../../social/publishing/PublishSocialModal';
import { TranslateLanguagesModal } from '../../editor/TranslateLanguagesModal';
import type { TableController } from './useTableController';

export function TableActionDialogs({ model }: { model: Pick<TableController, 'clearSelection' | 'schema' | 'pendingAction' | 'setPendingAction' | 'noteById' | 'onTranslated' | 'setLlmWikiJobs' | 'bulkTranslateIds' | 'setBulkTranslateIds'>; }) {
  const {
    clearSelection,
    schema,
    pendingAction,
    setPendingAction,
    noteById,
    onTranslated,
    setLlmWikiJobs,
    bulkTranslateIds,
    setBulkTranslateIds,
  } = model;
  return <>            {pendingAction && pendingAction.action === 'translate_row' && (
    <TranslateLanguagesModal
      isOpen={true}
      onClose={() => { setPendingAction(null); }}
      noteId={pendingAction.noteId}
      fieldConfig={pendingAction.fieldConfig}
      recordMetadata={noteById.get(pendingAction.noteId)?.metadata || {}}
      schema={schema}
      onTranslated={(data) => { setPendingAction(null); onTranslated?.(data); }}
    />
  )}

    {pendingAction && pendingAction.action === 'publish_social' && (
      <PublishSocialModal
        isOpen={true}
        onClose={() => { setPendingAction(null); }}
        noteId={pendingAction.noteId}
        recordMetadata={noteById.get(pendingAction.noteId)?.metadata || {}}
        onPublished={() => { setPendingAction(null); onTranslated?.({}); }}
      />
    )}

    {pendingAction && pendingAction.action === 'process_resource' && (
      <ProcessResourceModal
        isOpen={true}
        onClose={() => { setPendingAction(null); }}
        noteId={pendingAction.noteId}
        title={noteById.get(pendingAction.noteId)?.title || ''}
        sourceTableId={pendingAction.sourceTableId}
        force={pendingAction.force}
        onJobUpdate={(nextJob) => {
          setLlmWikiJobs((current) => ({
            ...current,
            [pendingAction.sourceTableId ?? 'undefined']: {
              ...(current[pendingAction.sourceTableId ?? 'undefined'] || {}),
              [pendingAction.noteId]: nextJob,
            },
          }));
        }}
        onProcessed={() => { onTranslated?.({}); }}
      />
    )}

    {bulkTranslateIds && bulkTranslateIds.length > 0 && (
      <TranslateLanguagesModal
        isOpen={true}
        mode="bulk"
        noteIds={bulkTranslateIds}
        onClose={() => { setBulkTranslateIds(null); }}
        onTranslated={(data) => {
          setBulkTranslateIds(null);
          clearSelection();
          onTranslated?.(data);
        }}
      />
    )}

  </>;
}
