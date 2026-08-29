import type { ComponentType, DragEvent } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Columns, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useLocaleSettings } from '../../hooks/useLocaleSettings';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';
import {
    useVaultViewData,
    type VaultSortInput,
    type VaultViewConfig,
} from '../../hooks/useVaultViewData';
import type { FilterNode, FilterValue } from '../../utils/vaultFilters';
import { VaultBulkActionsBar as LegacyVaultBulkActionsBar } from './VaultBulkActionsBar';
import { VaultViewToolbar } from './VaultViewToolbar';
import { getFieldType, getSchemaFieldNames, resolveViewFilters, resolveViewSorts } from './schemaUtils';
import { useTitlePreview } from './useTitlePreview';
import { isMainView } from './viewConstants';
import { VaultKanbanCard } from './vault-kanban/VaultKanbanCard';
import { VaultKanbanColumn } from './vault-kanban/VaultKanbanColumn';
import {
    buildKanbanColumns,
    EMPTY_KANBAN_BUCKET,
    findKanbanMetadataKey,
    readKanbanCardValue,
    resolveKanbanDropValue,
    type KanbanCardField,
    type KanbanNote,
    type KanbanSchema,
    type KanbanView,
} from './vault-kanban/vaultKanbanModel';


const NON_DRAGGABLE_GROUP_TYPES = new Set([
    'button',
    'created_by',
    'created_time',
    'formula',
    'last_edited_by',
    'last_edited_time',
    'rollup',
    'virtual',
]);


interface KanbanUpdatePatch {
    readonly metadata: Record<string, string | string[]>;
}


export interface VaultKanbanProps {
    readonly activeView?: KanbanView;
    readonly idToTitle?: Readonly<Record<string, string>>;
    readonly isEmbedded?: boolean;
    readonly notes?: readonly KanbanNote[];
    readonly onApplyTemplate?: (selectedIds: Set<string>, templateId: string) => void;
    readonly onCreateRecord?: () => void;
    readonly onDeletePage?: (pageId: string, title: string) => void;
    readonly onDeleteSelected?: (selectedIds: Set<string>) => void;
    readonly onEditSchema?: (section: string) => void;
    readonly onNoteSelect: (noteId: string) => void;
    readonly onUpdateNote?: (pageId: string, patch: KanbanUpdatePatch) => Promise<unknown>;
    readonly schema?: KanbanSchema;
    readonly searchTerm?: string;
    readonly templates?: readonly unknown[];
}


interface BulkActionsProps {
    readonly onApplyTemplate: ((templateId: string) => void) | null;
    readonly onClearSelection: () => void;
    readonly onDeleteSelected: (() => void) | null;
    readonly onSelectAll: () => void;
    readonly selectedIds: ReadonlySet<string>;
    readonly templates: readonly unknown[];
    readonly totalCount: number;
}


interface DragPayload {
    readonly from: string;
    readonly id: string;
}


const VaultBulkActionsBar = LegacyVaultBulkActionsBar as unknown as ComponentType<
    BulkActionsProps
>;
const readFieldNames = getSchemaFieldNames as (schema: KanbanSchema) => string[];
const readFieldType = getFieldType as (schema: KanbanSchema, field: string) => string;
const readFilters = resolveViewFilters as (view: KanbanView) => FilterNode[];
const readSorts = resolveViewSorts as (
    view: KanbanView,
    fallback?: VaultSortInput,
) => VaultSortInput[];


function parseDragPayload(value: string): DragPayload | null {
    try {
        const parsed: unknown = JSON.parse(value || 'null');
        if (!parsed || typeof parsed !== 'object') return null;
        const candidate = parsed as Readonly<Record<string, unknown>>;
        return typeof candidate.id === 'string' && typeof candidate.from === 'string'
            ? { from: candidate.from, id: candidate.id }
            : null;
    } catch {
        return null;
    }
}


export function VaultKanban({
    activeView = {},
    idToTitle = {},
    isEmbedded = false,
    notes = [],
    onApplyTemplate,
    onCreateRecord,
    onDeletePage,
    onDeleteSelected,
    onEditSchema,
    onNoteSelect,
    onUpdateNote,
    schema = {},
    searchTerm: externalSearchTerm,
    templates = [],
}: VaultKanbanProps) {
    const { t } = useTranslation();
    const localeSettings = useLocaleSettings();
    const titlePreview = useTitlePreview({ onOpenPage: onNoteSelect });
    const [internalSearchTerm, setInternalSearchTerm] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [pendingMoves, setPendingMoves] = useState<ReadonlyMap<string, FilterValue>>(
        () => new Map(),
    );
    const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
    const searchTerm = externalSearchTerm ?? internalSearchTerm;
    const view = useMemo<VaultViewConfig>(() => ({
        filters: readFilters(activeView),
        search: searchTerm,
        sorts: readSorts(activeView, { direction: 'desc', field: 'last_modified' }),
    }), [activeView, searchTerm]);
    const { sortedPages } = useVaultViewData({ pages: notes, schema, searchTerm, view });
    const visibleNotes = sortedPages as KanbanNote[];
    const selection = useVaultSelection(visibleNotes);
    const groupBy = activeView.groupBy ?? activeView.group_by ?? 'status';
    const groupByType = readFieldType(schema, groupBy);
    const canDrag = Boolean(onUpdateNote) && !NON_DRAGGABLE_GROUP_TYPES.has(groupByType);
    const configuredProperties = activeView.visibleProperties?.length
        ? [...activeView.visibleProperties]
        : isMainView(activeView)
            ? readFieldNames(schema)
            : readFieldNames(schema).slice(0, 3);
    const fields = configuredProperties
        .map((field): KanbanCardField => ({ field, type: readFieldType(schema, field) }))
        .filter(({ type }) => Boolean(type) && type !== 'title');
    const columns = useMemo(() => buildKanbanColumns(
        visibleNotes,
        schema,
        activeView,
        pendingMoves,
        idToTitle,
    ), [activeView, idToTitle, pendingMoves, schema, visibleNotes]);

    const handleBulkDelete = useCallback((): void => {
        if (selection.selectedIds.size === 0) return;
        if (onDeleteSelected) onDeleteSelected(new Set(selection.selectedIds));
        else if (onDeletePage) selection.selectedIds.forEach((id) => {
            const note = notes.find((candidate) => candidate.id === id);
            if (note) onDeletePage(id, note.title);
        });
        selection.clearSelection();
    }, [notes, onDeletePage, onDeleteSelected, selection]);

    useVaultSelectionShortcuts({
        clearSelection: selection.clearSelection,
        onDeleteSelected: handleBulkDelete,
        selectAll: () => { selection.selectAll(visibleNotes.map(({ id }) => id)); },
    });

    const handleDrop = useCallback(async (
        event: DragEvent<HTMLDivElement>,
        targetStatus: string,
    ): Promise<void> => {
        event.preventDefault();
        setDragOverStatus(null);
        if (!onUpdateNote || !canDrag) return;
        const payload = parseDragPayload(event.dataTransfer.getData('text/plain'));
        if (!payload || payload.from === targetStatus) return;
        const note = visibleNotes.find(({ id }) => id === payload.id);
        if (!note) return;
        const currentValue = pendingMoves.get(note.id)
            ?? readKanbanCardValue(note, groupBy).value;
        const nextValue = resolveKanbanDropValue(
            currentValue,
            payload.from,
            targetStatus,
        );
        const metadataKey = findKanbanMetadataKey(note, groupBy);
        setPendingMoves((previous) => new Map(previous).set(note.id, nextValue));
        try {
            await onUpdateNote(note.id, { metadata: { [metadataKey]: nextValue } });
        } catch {
            setPendingMoves((previous) => {
                const next = new Map(previous);
                next.delete(note.id);
                return next;
            });
        }
    }, [canDrag, groupBy, onUpdateNote, pendingMoves, visibleNotes]);

    return <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--bg-primary)]">
        {externalSearchTerm === undefined ? <div className="flex items-center justify-between gap-2">
            <VaultViewToolbar
                activeFiltersCount={readFilters(activeView).length}
                activeSortsCount={readSorts(activeView).length}
                onOpenFilters={() => { onEditSchema?.('filters'); }}
                onOpenSort={() => { onEditSchema?.('sorts'); }}
                searchTerm={searchTerm}
                setSearchTerm={setInternalSearchTerm}
                setShowSearch={setShowSearch}
                showSearch={showSearch}
            />
            {onCreateRecord ? <button
                className="btn-gnosi inline-flex items-center gap-1.5"
                onClick={onCreateRecord}
                type="button"
            >
                <Plus size={14} />
                {t('view.add_record', { defaultValue: 'Add record' })}
            </button> : null}
        </div> : null}
        {selection.selectedIds.size > 0 ? <VaultBulkActionsBar
            onApplyTemplate={onApplyTemplate ? (templateId) => {
                onApplyTemplate(new Set(selection.selectedIds), templateId);
                selection.clearSelection();
            } : null}
            onClearSelection={selection.clearSelection}
            onDeleteSelected={onDeleteSelected || onDeletePage ? handleBulkDelete : null}
            onSelectAll={() => { selection.selectAll(visibleNotes.map(({ id }) => id)); }}
            selectedIds={selection.selectedIds}
            templates={templates}
            totalCount={visibleNotes.length}
        /> : null}
        <div className={`custom-scrollbar flex-1 overflow-x-auto overflow-y-auto ${isEmbedded ? '' : 'px-4 pb-4 pt-vault-header-top md:px-6 md:pb-6'}`}>
            {!isEmbedded ? <h1 className="sticky left-0 mb-6 flex items-center gap-3 text-2xl font-bold text-[var(--text-primary)]">
                <Columns className="text-[var(--gnosi-primary)]" size={24} />
                {typeof activeView.name === 'string'
                    ? activeView.name
                    : t('kanban.default_title', 'Kanban board')}
                <span className="ml-2 rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-sm font-normal text-[var(--text-tertiary)]">
                    {t('kanban.records_count', {
                        count: visibleNotes.length,
                        defaultValue: '{{count}} records',
                    })}
                </span>
            </h1> : null}
            <div className="flex min-w-max items-start gap-6 pb-8">
                {columns.map((column) => <VaultKanbanColumn
                    canDrag={canDrag}
                    column={column}
                    dragOverStatus={dragOverStatus}
                    emptyGroupLabel={t('kanban.no_status', 'No status')}
                    key={column.status}
                    noRecordsLabel={t('kanban.no_records', 'No records')}
                    onDragOverStatus={setDragOverStatus}
                    onDrop={(event, status) => { void handleDrop(event, status); }}
                    renderCards={() => column.notes.map((note) => <VaultKanbanCard
                        canDrag={canDrag}
                        fields={fields}
                        fromStatus={column.status}
                        idToTitle={idToTitle}
                        isSelected={selection.isSelected(note.id)}
                        key={note.id}
                        localeSettings={localeSettings}
                        note={note}
                        onDragEnd={() => { setDragOverStatus(null); }}
                        onNoteSelect={onNoteSelect}
                        onToggleSelect={selection.toggleSelect}
                        onUpdateNote={onUpdateNote}
                        schema={schema}
                        selectedCount={selection.selectedIds.size}
                        titlePreviewProps={titlePreview.getTitleProps(note.id)}
                        untitledLabel={t('common.untitled', 'Untitled')}
                    />)}
                />)}
            </div>
        </div>
        {titlePreview.preview}
    </div>;
}
