import { useEffect, useRef } from 'react';
import type { SavedView } from '../../../view-config/page-view-modal/types';
import type { ViewEditingBlock } from './types';
import { CoverPicker } from '../../CoverPicker';
import { IconPicker } from '../../IconPicker';
import { InsertContentModal } from '../../../content/InsertContentModal';
import { MetadataLookupModal } from '../../../../literature/records/MetadataLookupModal';
import PageHistory from '../../PageHistory';
import { PageViewModal } from '../../../view-config/PageViewModal';
import { buildImageValue } from '../../../../../shared/resources/fileResource';
import { parseImageField } from '../../../../../shared/resources/fileResource';
import { servedUrlToVaultPath } from '../../../../../shared/resources/fileResource';
import type { PageEditorController } from './usePageEditorController';
import { NoteComposerModal } from './NoteComposerModal';
export function PageModals({ context }: { context: PageEditorController }) {
  const { noteFilename, isHistoryOpen, setIsHistoryOpen, isPageViewModalOpen, setIsPageViewModalOpen, pageViewEditingBlock, setPageViewPreselectedTable, setPageViewEditingBlock, applyViewSectionRef, setViewSectionNonce, onRefreshNotes, allTables, pageViewPreselectedTable, isIconPickerOpen, setIsIconPickerOpen, handleMetaChange, propertyMetadata: metadata, iconTriggerRef, isCoverPickerOpen, setIsCoverPickerOpen, coverTriggerRef, isMetadataLookupOpen, setIsMetadataLookupOpen, imagePickerProp, rawTableId, setImagePickerProp } = context;
  const savedBlock = useRef<ViewEditingBlock | null>(null);
  useEffect(() => { savedBlock.current = null; }, [isPageViewModalOpen, noteFilename]);
  const applySavedView = async (section: SavedView) => {
    const block = applyViewSectionRef.current?.(section, savedBlock.current || pageViewEditingBlock);
    if (!block) throw new Error(context.t('errors.save_view', 'Error saving the view'));
    savedBlock.current = block;
    if (!await context.flushPageContent()) throw new Error(context.t('errors.save_view', 'Error saving the view'));
    setViewSectionNonce(n => n + 1);
    onRefreshNotes();
  };
  return (<>{context.composerOpen && <NoteComposerModal sourceId={noteFilename} idToTitle={context.idToTitle}
    flush={context.flushForComposer} onFlushed={context.lockComposer} onClose={context.closeComposer} onApplied={context.finishComposition} />}
    <PageHistory pageId={noteFilename} open={isHistoryOpen} onClose={() => { setIsHistoryOpen(false); }} onRestore={() => { window.location.reload(); }} />
    <PageViewModal
      isOpen={isPageViewModalOpen}
      onSave={applySavedView}
      onClose={() => {
        setIsPageViewModalOpen(false);
        setPageViewPreselectedTable('');
        setPageViewEditingBlock(null);
      }}
      pageId={noteFilename}
      allTables={allTables}
      preselectedTableId={pageViewPreselectedTable}
      editingBlock={context.modalEditingBlock}
    />

    {/* Pickers Portals */}
    <IconPicker
      isOpen={isIconPickerOpen}
      onClose={() => { setIsIconPickerOpen(false); }}
      onSelectIcon={(icon) => { handleMetaChange('icon', icon); }}
      currentIcon={metadata.icon}
      triggerRef={iconTriggerRef}
    />
    <CoverPicker
      isOpen={isCoverPickerOpen}
      onClose={() => { setIsCoverPickerOpen(false); }}
      onSelectCover={(cover) => { handleMetaChange('cover', cover); }}
      currentCover={metadata.cover}
      triggerRef={coverTriggerRef}
    />
    <MetadataLookupModal
      isOpen={isMetadataLookupOpen}
      onClose={() => { setIsMetadataLookupOpen(false); }}
      currentMetadata={metadata}
      onApply={(patch) => {
        // Applies field by field via handleMetaChange — triggers the
        // save debounce and updates the UI at the same time.
        Object.entries(patch).forEach(([k, v]) => {
          handleMetaChange(k, v);
        });
      }}
    />
    {/* Image picker for image fields (by name) in the properties
                panel. Same modal and contract as the table cell: single
                value (replaces) and the path relative to the vault is saved. */}
    <InsertContentModal
      open={Boolean(imagePickerProp)}
      tableId={rawTableId || ''}
      fileField={null}
      rowMetadata={metadata}
      imageField={Boolean(imagePickerProp)}
      initialImageMeta={imagePickerProp ? parseImageField(metadata[imagePickerProp]) : null}
      onClose={() => { setImagePickerProp(null); }}
      onInsert={(result) => {
        if (!imagePickerProp) return;
        // Metadata only: keeps the field's current src.
        if (result.metadataOnly) {
          const currentSrc = parseImageField(metadata[imagePickerProp]).src;
          if (currentSrc) handleMetaChange(imagePickerProp, buildImageValue(currentSrc, result.imageMeta || {}));
          setImagePickerProp(null);
          return;
        }
        const newPath = servedUrlToVaultPath(result.url || '');
        if (newPath) handleMetaChange(imagePickerProp, buildImageValue(newPath, result.imageMeta || {}));
        setImagePickerProp(null);
      }}
    />
  </>);
}
