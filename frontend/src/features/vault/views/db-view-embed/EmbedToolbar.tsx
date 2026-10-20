import { Heading } from './Heading';
import { ReferenceImportExport } from '../../../literature/records/ReferenceImportExport';
import { BrainTools } from '../../../agent/inbox/BrainTools';
import { ViewActionsBar } from './ViewActionsBar';
import type { EmbedModel } from './useEmbedController';
export function EmbedToolbar({ model }: { model: EmbedModel ;}) {
    const { displayHeading, displayLevel, t, rows, ctx, tableId, reload, handleCreate, handleAddView, templates, handleOpenConfig, searchTerm, setSearchTerm, showSearch, setShowSearch, feedDensity, viewType, toggleFeedDensity, activeFilterCount, quickPresets, saveQuickPreset, applyQuickPreset, renameQuickPreset, deleteQuickPreset, exportQuickPresets, setIsImportQuickPresetOpen, feedGroupMode, toggleFeedGroupMode, loadDuration } = model;
    const { onOpenPageViewModal } = ctx;
    return (<div className="vault-view-toolbar flex items-center justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2 min-w-0">
            {displayHeading && <Heading level={displayLevel}>{displayHeading}</Heading>}
            <span className="text-[11px] text-[var(--text-tertiary)] font-medium whitespace-nowrap">
                {t('views_header.records_count', { count: rows.length })}
            </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
            {tableId && ctx.brainTableId === tableId && (
                <BrainTools key={tableId} tableId={tableId} onChanged={reload} />
            )}
            {ctx.referenceTableId === tableId && (
                <ReferenceImportExport tableId={tableId} onImported={reload} />
            )}
            <ViewActionsBar
                onCreate={tableId ? handleCreate : null}
                onCreateTemplate={tableId ? () => ctx.onCreateTemplate?.(tableId) : null}
                onCreateFromSource={ctx.referenceTableId === tableId ? () => ctx.onCreateFromSource?.(tableId) : null}
                onAddView={tableId ? () => { handleAddView('table'); } : null}
                templates={templates}
                onOpenConfig={onOpenPageViewModal && tableId ? handleOpenConfig : null}
                searchTerm={searchTerm}
                searchScope={model.searchScope}
                setSearchScope={model.setSearchScope}
                setSearchTerm={setSearchTerm}
                showSearch={showSearch}
                setShowSearch={setShowSearch}
                density={feedDensity}
                onToggleDensity={viewType === 'feed' ? toggleFeedDensity : null}
                activeFilterCount={activeFilterCount}
                resultCount={rows.length}
                totalCount={model.tableRecords.length}
                presets={quickPresets}
                onSavePreset={saveQuickPreset}
                onApplyPreset={applyQuickPreset}
                onRenamePreset={renameQuickPreset}
                onDeletePreset={deleteQuickPreset}
                onExportPresets={exportQuickPresets}
                onImportPresets={() => { setIsImportQuickPresetOpen(true); }}
                groupMode={feedGroupMode}
                onToggleGroup={viewType === 'feed' ? toggleFeedGroupMode : null}
                loadDuration={loadDuration}
            />
        </div>
    </div>);
}
