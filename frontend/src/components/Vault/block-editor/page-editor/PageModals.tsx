import { CoverPicker } from '../../CoverPicker';
import { IconPicker } from '../../IconPicker';
import { InsertContentModal } from '../../InsertContentModal';
import { MetadataLookupModal } from '../../MetadataLookupModal';
import PageHistory from '../../PageHistory';
import { PageViewModal } from '../../PageViewModal';
import { buildImageValue } from '../../../../lib/fileResource';
import { parseImageField } from '../../../../lib/fileResource';
import { servedUrlToVaultPath } from '../../../../lib/fileResource';
import type { PageEditorController } from './usePageEditorController';
export function PageModals({ context }: { context: PageEditorController }) {
  const { noteFilename, isHistoryOpen, setIsHistoryOpen, isPageViewModalOpen, setIsPageViewModalOpen, pageViewEditingBlock, setPageViewPreselectedTable, setPageViewEditingBlock, applyViewSectionRef, setViewSectionNonce, onRefreshNotes, allTables, pageViewPreselectedTable, isIconPickerOpen, setIsIconPickerOpen, handleMetaChange, metadata, iconTriggerRef, isCoverPickerOpen, setIsCoverPickerOpen, coverTriggerRef, isMetadataLookupOpen, setIsMetadataLookupOpen, imagePickerProp, rawTableId, setImagePickerProp } = context;
  return (<><PageHistory pageId={noteFilename} open={isHistoryOpen} onClose={() => { setIsHistoryOpen(false); }} onRestore={() => { window.location.reload(); }} />
    <PageViewModal
      isOpen={isPageViewModalOpen}
      onClose={(changed, sectionData) => {
        setIsPageViewModalOpen(false);
        // Captures editingBlock before clearing it so
        // applyViewSectionRef can distinguish insert vs update.
        const editing = pageViewEditingBlock;
        setPageViewPreselectedTable('');
        setPageViewEditingBlock(null);
        if (!changed) return;
        if (sectionData) {
          applyViewSectionRef.current?.(sectionData, editing);
        }
        // Asks the page's DbViewEmbed instances to re-read the
        // section that was just saved (card size, preview,
        // grouping…). Without this, editing the size of a gallery
        // embedded had no effect until reloading.
        setViewSectionNonce(n => n + 1);
        onRefreshNotes();
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
