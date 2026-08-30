import { FileText } from 'lucide-react';
import type { ChangeEvent } from 'react';

import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { VaultFeedList } from './VaultFeedList';
import { VaultFeedOverlays } from './VaultFeedOverlays';
import { VaultFeedReadingPane } from './VaultFeedReadingPane';
import { getFieldConfig, getFieldType } from './schemaUtils';
import { normalizeOptions } from './optionCatalogUtils';
import type { VaultFeedProps } from './vaultFeedTypes';
import { useVaultFeedController } from './useVaultFeedController';


export function VaultFeed(props: VaultFeedProps) {
  const controller = useVaultFeedController(props);
  const {
    applyBulkField,
    buildPills,
    density,
    dockReadingPane,
    groupMode,
    handleBulkDelete,
    isEmbedded,
    lastRecordId,
    onApplyTemplate,
    onClearSearch,
    onCreateRecord,
    onDeletePage,
    onDeleteSelected,
    onOpenConfig,
    openFeedRecord,
    paneWidth,
    previewNote,
    readIds,
    resetKey,
    returnToLastRecord,
    searchTerm,
    selection,
    settings,
    sortedNotes,
    t,
    templates,
    titlePreview,
  } = controller;

  if (sortedNotes.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[var(--bg-primary)] p-10 text-[var(--text-tertiary)]">
        <FileText
          size={48}
          className="mb-4 text-[var(--bg-tertiary)]"
          strokeWidth={1}
        />
        <p className="font-medium">
          {searchTerm
            ? t('feed.empty_search', 'No records match this search.')
            : t('feed.empty', 'No posts in the feed.')}
        </p>
        <p className="mt-1 text-center text-sm">
          {searchTerm
            ? t('feed.empty_search_hint', 'Try fewer words or clear the search.')
            : t('feed.empty_hint', 'Create the first record or adjust the view filters.')}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {searchTerm && (
            <button type="button" onClick={onClearSearch} className="btn-gnosi btn-gnosi-secondary !text-xs">
              {t('feed.clear_search', 'Clear search')}
            </button>
          )}
          {onOpenConfig && (
            <button type="button" onClick={onOpenConfig} className="btn-gnosi btn-gnosi-secondary !text-xs">
              {t('feed.adjust_view', 'Adjust view')}
            </button>
          )}
          {onCreateRecord && (
            <button type="button" onClick={onCreateRecord} className="btn-gnosi btn-gnosi-primary !text-xs">
              {t('feed.create_record', 'Create record')}
            </button>
          )}
        </div>
      </div>
    );
  }

  const selectBulkField = (event: ChangeEvent<HTMLSelectElement>): void => {
    const [field = '', value = ''] = event.target.value.split('::');
    if (field && value) {
      applyBulkField(field, value, getFieldType(props.schema, field) === 'multi_select');
    }
    event.target.value = '';
  };

  return (
    <div
      className={`vault-feed flex h-full w-full flex-col items-center overflow-y-auto bg-[var(--bg-primary)] custom-scrollbar ${isEmbedded ? 'pb-4' : 'px-4 pb-4 pt-vault-header-top md:px-6 md:pb-6'} ${settings.feedFocus ? 'is-focus' : ''} ${previewNote && dockReadingPane ? 'has-docked-pane' : ''}`}
      style={previewNote && dockReadingPane
        ? { paddingRight: `calc(${String(paneWidth)}px + 1.5rem)` }
        : undefined}
    >
      {selection.selectedIds.size > 0 && (
        <VaultBulkActionsBar
          selectedIds={selection.selectedIds}
          totalCount={sortedNotes.length}
          onSelectAll={() => { selection.selectAll(sortedNotes.map((note) => note.id)); }}
          onClearSelection={selection.clearSelection}
          onDeleteSelected={onDeleteSelected || onDeletePage ? handleBulkDelete : null}
          templates={templates}
          onApplyTemplate={onApplyTemplate ? (templateId) => {
            onApplyTemplate(new Set(selection.selectedIds), templateId);
            selection.clearSelection();
          } : null}
          extraActions={controller.bulkSelectFields.length > 0 ? (
            <select
              className="min-h-8 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-secondary)]"
              defaultValue=""
              onChange={selectBulkField}
              aria-label={t('feed.apply_field_to_selection', 'Apply a field to the selection')}
            >
              <option value="">{t('feed.batch_update', 'Update selected…')}</option>
              {controller.bulkSelectFields.flatMap(([field]) => (
                normalizeOptions(getFieldConfig(props.schema, field).options).map((option) => (
                  <option key={`${field}-${option.name}`} value={`${field}::${option.name}`}>
                    {field}: {option.name}
                  </option>
                ))
              ))}
            </select>
          ) : undefined}
        />
      )}
      <VaultFeedOverlays controller={controller} />
      {lastRecordId && sortedNotes.some((note) => note.id === lastRecordId) && (
        <button type="button" className="vault-feed-return" onClick={returnToLastRecord}>
          {t('feed.return_to_last_record')}
        </button>
      )}
      <VaultFeedList
        key={resetKey}
        notes={sortedNotes}
        buildPills={buildPills}
        isSelected={selection.isSelected}
        selectionActive={selection.selectedIds.size > 0}
        onToggleSelect={selection.toggleSelect}
        onOpen={openFeedRecord}
        onPreview={controller.setPreviewId}
        getTitleProps={titlePreview.getTitleProps}
        searchTerm={searchTerm}
        readIds={readIds}
        density={density}
        groupMode={groupMode}
        pillLimit={settings.pillLimit}
        excerptLines={settings.excerptLines}
      />
      {titlePreview.preview}
      <VaultFeedReadingPane controller={controller} />
    </div>
  );
}
