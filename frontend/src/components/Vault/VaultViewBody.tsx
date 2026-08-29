import { useMemo, type ComponentType, type ReactNode } from 'react';
import { VaultTable } from './VaultTable';
import { VaultKanban } from './VaultKanban';
import { VaultGallery } from './VaultGallery';
import { VaultTimeline } from './VaultTimeline';
import { VaultFeed } from './VaultFeed';
import { VaultChart } from './VaultChart';
import { DigitalBrainCalendar } from './DigitalBrainCalendar';
import { VaultViewErrorBoundary } from './VaultViewErrorBoundary';
import { useVaultViewData } from '../../hooks/useVaultViewData';
import { resolveViewSorts, resolveViewFilters } from './schemaUtils';
import type {
    VaultViewConfig,
    VaultViewPage,
} from '../../hooks/useVaultViewData';
import type { FilterNode } from '../../utils/vaultFilters';

type RendererProps = Record<string, unknown>;

const TableRenderer = VaultTable as unknown as ComponentType<RendererProps>;
const KanbanRenderer = VaultKanban as unknown as ComponentType<RendererProps>;
const GalleryRenderer = VaultGallery as unknown as ComponentType<RendererProps>;
const TimelineRenderer = VaultTimeline as unknown as ComponentType<RendererProps>;
const FeedRenderer = VaultFeed as unknown as ComponentType<RendererProps>;
const ChartRenderer = VaultChart as unknown as ComponentType<RendererProps>;
const CalendarRenderer = DigitalBrainCalendar as unknown as ComponentType<RendererProps>;

interface VaultBodyView extends VaultViewConfig {
    readonly calendarView?: string;
    readonly dateField?: string;
    readonly endDateField?: string;
    readonly id?: string;
}

export interface VaultViewBodyProps {
    readonly actionRules?: unknown;
    readonly activeView?: VaultBodyView;
    readonly allNotes?: readonly VaultViewPage[];
    readonly feedDensity?: string;
    readonly feedGroupMode?: string;
    readonly functionalities?: unknown;
    readonly idToTitle?: Readonly<Record<string, string>>;
    readonly isEmbedded?: boolean;
    readonly maxHeight?: number | string | null;
    readonly notes?: readonly VaultViewPage[];
    readonly onApplyTemplate?: (selectedIds: Set<string>, templateId: string) => void;
    readonly onCellSaved?: () => void;
    readonly onCreateNotebook?: (resourceIds: readonly string[]) => void;
    readonly onCreateRecord?: () => void;
    readonly onDeletePage?: (pageId: string, title?: string) => void;
    readonly onDeleteSelected?: (selectedIds: Set<string>) => void;
    readonly onEditSchema?: (section?: string) => void;
    readonly onEscape?: () => void;
    readonly onExitBottom?: () => void;
    readonly onExitTop?: () => void;
    readonly onFocusShell?: () => void;
    readonly onNoteSelect?: (noteId: string) => void;
    readonly onOpenParallel?: (noteId: string) => void;
    readonly onRecordFocusRestored?: () => void;
    readonly onSearchChange?: (value: string) => void;
    readonly onTranslated?: () => void;
    readonly onUpdateFieldOptions?: (...args: readonly unknown[]) => unknown;
    readonly onUpdateNote?: (...args: readonly unknown[]) => unknown;
    readonly onUpdateView?: (...args: readonly unknown[]) => unknown;
    readonly registerNavApi?: (api: unknown) => void;
    readonly restoreRecordFocus?: unknown;
    readonly schema?: Readonly<Record<string, unknown>>;
    readonly searchTerm?: string;
    readonly templates?: readonly Readonly<Record<string, unknown>>[];
    readonly type?: string;
}

const readViewFilters = resolveViewFilters as (view: VaultBodyView) => FilterNode[];

/**
 * VaultViewBody — shared render of the BODY of a DB view according to its
 * type (table, list, kanban, gallery, timeline, feed, calendar).
 *
 * Reused both by the full table (VaultDashboard) and by the embedded
 * view (DbViewEmbed) to avoid duplicating the per-type switch and the
 * callback wiring. It does NOT wrap anything in a container: the caller supplies
 * its own (height/scroll/padding). The `graph` type is not handled here (it has no
 * equivalent editable component); the caller deals with it separately.
 *
 * Props: the view's data set (notes, schema, activeView, …) and the
 * action callbacks. Each caller passes its own.
 */
export function VaultViewBody({
    type = 'table',
    notes = [],
    templates = [],
    schema = {},
    idToTitle = {},
    allNotes = [],
    activeView = {},
    isEmbedded = false,
    maxHeight = null,
    searchTerm = '',
    actionRules,
    functionalities,
    onNoteSelect,
    restoreRecordFocus,
    onRecordFocusRestored,
    onOpenParallel,
    onUpdateView,
    onEditSchema,
    onCreateRecord,
    onDeletePage,
    onDeleteSelected,
    onApplyTemplate,
    onCreateNotebook,
    onCellSaved,
    onTranslated,
    onUpdateFieldOptions,
    onUpdateNote,
    onSearchChange,
    registerNavApi,
    onExitTop,
    onExitBottom,
    onEscape,
    onFocusShell,
    feedDensity = 'comfortable',
    feedGroupMode = 'none',
}: VaultViewBodyProps) {
    const t = type.toLowerCase();

    // Props common to components that share the same signature.
    const common = {
        notes,
        schema,
        idToTitle,
        allNotes,
        activeView,
        searchTerm,
        onSearchChange,
        onNoteSelect,
        onCreateRecord,
        onDeletePage,
        onDeleteSelected,
        onApplyTemplate,
        templates,
        onEditSchema,
        onUpdateView,
        onUpdateNote,
    };

    // Notes filtered/sorted according to the view. The calendar receives `allNotes` and does not
    // apply the view's filters itself, so we apply them here with
    // the same engine as the rest of the views (it used to ignore them entirely).
    // The order is resolved with `resolveViewSorts` (key `sorts` — Notion import and
    // modal — with a fallback to the legacy `sort`). Memoized because the resolvers
    // return new arrays on each call.
    const filteredViewConfig = useMemo(() => ({
        filters: readViewFilters(activeView),
        sorts: resolveViewSorts(activeView, { field: 'last_modified', direction: 'desc' }),
        search: searchTerm,
    }), [activeView, searchTerm]);
    const { sortedPages: viewFilteredNotes } = useVaultViewData({
        pages: notes,
        schema,
        view: filteredViewConfig,
        searchTerm,
    });

    let body: ReactNode;
    if (t === 'board') {
        // `onUpdateNote` enables drag & drop of cards between columns
        // (writes the record's grouping field on drop).
        body = <KanbanRenderer {...common} isEmbedded={isEmbedded} onUpdateNote={onUpdateNote} />;
    } else if (t === 'gallery') {
        body = (
            <GalleryRenderer
                {...common}
                registerNavApi={registerNavApi}
                onExitTop={onExitTop}
                onExitBottom={onExitBottom}
                onFocusShell={onFocusShell}
                onOpenParallel={onOpenParallel}
            />
        );
    } else if (t === 'timeline') {
        body = <TimelineRenderer {...common} onUpdateNote={onUpdateNote} />;
    } else if (t === 'chart') {
        body = <ChartRenderer notes={viewFilteredNotes} schema={schema} activeView={activeView} />;
    } else if (t === 'feed') {
        body = (
            <FeedRenderer
                key={activeView.id || 'default'}
                notes={notes}
                schema={schema}
                idToTitle={idToTitle}
                allNotes={allNotes}
                activeView={activeView}
                searchTerm={searchTerm}
                onSearchChange={onSearchChange}
                onNoteSelect={onNoteSelect}
                onDeletePage={onDeletePage}
                onDeleteSelected={onDeleteSelected}
                onApplyTemplate={onApplyTemplate}
                onCreateNotebook={onCreateNotebook}
                templates={templates}
                onUpdateNote={onUpdateNote}
                onCreateRecord={onCreateRecord}
                onOpenConfig={() => onEditSchema?.('filters')}
                onClearSearch={() => onSearchChange?.('')}
                density={feedDensity}
                groupMode={feedGroupMode}
                isEmbedded={isEmbedded}
            />
        );
    } else if (t === 'calendar') {
        body = (
            <CalendarRenderer
                // `key`: FullCalendar only reads initialView on mount; changing
                // the "initial view" in the modal with the calendar open did nothing
                // until you left and came back. Remounting is cheap here.
                key={activeView.calendarView || 'dayGridMonth'}
                allNotes={viewFilteredNotes}
                onNoteSelect={onNoteSelect}
                onDeletePage={onDeletePage}
                onDeleteSelected={onDeleteSelected}
                onApplyTemplate={onApplyTemplate}
                templates={templates}
                dateField={activeView.dateField || ''}
                endDateField={activeView.endDateField || ''}
                initialView={activeView.calendarView || 'dayGridMonth'}
                // Forward the row-refresh callback so a drag/resize re-fetches
                // the parent's notes; otherwise the event snaps back to its old
                // date from the stale allNotes prop even though the save succeeded.
                onRefresh={onCellSaved}
                ignoreCalendarFilter
                showHeaderToolbar
            />
        );
    } else {
        // table / list
        body = (
            <TableRenderer
                {...common}
                templates={templates}
                isEmbedded={isEmbedded}
                maxHeight={maxHeight}
                isListView={t === 'list'}
                onOpenParallel={onOpenParallel}
                onCellSaved={onCellSaved}
                onTranslated={onTranslated}
                onUpdateFieldOptions={onUpdateFieldOptions}
                actionRules={actionRules}
                functionalities={functionalities}
                restoreRecordFocus={restoreRecordFocus}
                onRecordFocusRestored={onRecordFocusRestored}
                registerNavApi={registerNavApi}
                onExitTop={onExitTop}
                onExitBottom={onExitBottom}
                onEscape={onEscape}
            />
        );
    }

    // Safety net: a transient render throw during the bootstrap in
    // cold (data/schema/registry still loading) or an actual error in a cell
    // must not take down the view. The boundary shows a discreet fallback and
    // auto-recovers when the data changes (resetKeys). The keys include the
    // `schema`/`notes` references (which change when the data arrives) and the
    // view/type identity (view or table change).
    return (
        <VaultViewErrorBoundary resetKeys={[t, activeView.id, schema, notes, allNotes, isEmbedded]}>
            {body}
        </VaultViewErrorBoundary>
    );
}

export default VaultViewBody;
