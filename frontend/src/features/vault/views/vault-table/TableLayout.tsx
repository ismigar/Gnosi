import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { NotebookTabs } from 'lucide-react';
import { VaultBulkActionsBar } from '../../../../shared/record-views/VaultBulkActionsBar';
import { FileDeleteDialog } from './FileDeleteDialog';
import { InfiniteLoadSentinel } from './InfiniteLoadSentinel';
import { TableActionDialogs } from './TableActionDialogs';
import { TableBody } from './TableBody';
import { TableFooter } from './TableFooter';
import { TableHeader } from './TableHeader';
import { TableMediaDialog } from './TableMediaDialog';
import type { TableController } from './useTableController';

export function TableLayout({ model }: { model: TableController; }) {
  const {
    maxHeight,
    isEmbedded,
    selectedIds,
    sortedNotes,
    selectAll,
    clearSelection,
    onDeleteSelected,
    onDeletePage,
    handleBulkDelete,
    templates,
    onApplyTemplate,
    handleApplyTemplate,
    onCreateNotebook,
    t,
    tableContainerRef,
    claimKeyboard,
    activeCell,
    isListView,
    columnDndSensors,
    handleColumnDragEnd,
    suppressNextHeaderClick,
    columnSortableIds,
    groupByField,
    visibleRowsCount,
    ROWS_BATCH_SIZE,
    handleLoadMoreRows,
    titlePreview,
  } = model;
  return (
    <div className={`w-full ${maxHeight ? '' : 'h-full overflow-hidden'} ${isEmbedded ? '' : 'bg-[var(--bg-primary)]'}`}>
      <div className={`w-full ${maxHeight ? '' : 'h-full'} flex flex-col`}>
        {selectedIds.size > 0 && (
          <VaultBulkActionsBar
            selectedIds={selectedIds}
            totalCount={sortedNotes.length}
            onSelectAll={() => { selectAll(sortedNotes.map(n => n.id)); }}
            onClearSelection={clearSelection}
            onDeleteSelected={(onDeleteSelected || onDeletePage) ? handleBulkDelete : null}
            templates={templates}
            onApplyTemplate={onApplyTemplate ? handleApplyTemplate : null}
            extraActions={onCreateNotebook ? (
              <button
                type="button"
                onClick={() => { onCreateNotebook(new Set(selectedIds)); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                title={t('notebooks.create_from_selection', 'Create notebook from selection')}
              >
                <NotebookTabs size={13} />
                {t('notebooks.create_action', 'Create notebook')}
              </button>
            ) : null}
          />
        )}

        {/* `maxHeight`: adaptive mode (embed). The scroller takes the height
                    of the content and only scrolls once it exceeds the maximum —
                    virtualization keeps working because max-height is a real
                    bound. Without `maxHeight` (full-screen table)
                    `flex-1` is used to fill the parent's height. */}
        <div
          ref={tableContainerRef}
          data-vault-table-scroll
          onPointerDownCapture={claimKeyboard}
          style={maxHeight ? { maxHeight } : undefined}
          className={`bg-[var(--bg-primary)] overflow-auto custom-scrollbar ${maxHeight ? '' : 'flex-1'} ${isEmbedded ? `${activeCell ? 'ring-1 ring-[var(--gnosi-primary)]/30' : ''} transition-all` : 'border-none shadow-none'} ${isListView ? 'border-none shadow-none' : ''}`}>

          {/* DndContext/SortableContext render no DOM: the table markup
                        stays valid. Only the header cells register as sortables;
                        the native HTML5 drag of the rows (application/gnosi-note)
                        is untouched because dnd-kit sensors only listen on the
                        header handles. */}
          <DndContext
            sensors={columnDndSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleColumnDragEnd}
            onDragCancel={suppressNextHeaderClick}
          >
            <SortableContext items={columnSortableIds} strategy={horizontalListSortingStrategy}>
              <table className="text-left text-sm text-[var(--text-secondary)] whitespace-nowrap" style={{ tableLayout: 'fixed', width: 'max-content' }}>
                {!isListView && (
                  <TableHeader model={model} />
                )}
                <TableBody model={model} />
                {!isListView && (
                  <TableFooter model={model} />
                )}
              </table>
            </SortableContext>
          </DndContext>

          {sortedNotes.length === 0 && (
            <div className="p-8 text-center text-[var(--text-tertiary)] bg-[var(--bg-primary)]">
              {t('table.no_notes')}
            </div>
          )}

          {!groupByField && sortedNotes.length > visibleRowsCount && (
            <InfiniteLoadSentinel
              visibleCount={visibleRowsCount}
              total={sortedNotes.length}
              batchSize={ROWS_BATCH_SIZE}
              onLoadMore={handleLoadMoreRows}
              label={t('table.showing_records', { count: visibleRowsCount, total: sortedNotes.length })}
            />
          )}
        </div>
      </div>

      <TableActionDialogs model={model} />            <TableMediaDialog model={model} />

      <FileDeleteDialog model={model} />

      {titlePreview.preview}
    </div>
  );
}
