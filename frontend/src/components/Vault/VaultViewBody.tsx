import { useMemo, type ReactNode } from 'react';
import { VaultTable } from './VaultTable';
import { VaultKanban } from './VaultKanban';
import { VaultGallery } from './VaultGallery';
import { VaultTimeline } from './VaultTimeline';
import { VaultFeed } from './VaultFeed';
import { VaultChart } from './VaultChart';
import { DigitalBrainCalendar } from './DigitalBrainCalendar';
import type { BulkActionTemplate } from './VaultBulkActionsBar';
import { VaultViewErrorBoundary } from './VaultViewErrorBoundary';
import { useVaultViewData } from '../../hooks/useVaultViewData';
import { resolveViewSorts, resolveViewFilters } from './schemaUtils';
import type {
    VaultViewConfig,
    VaultViewPage,
} from '../../hooks/useVaultViewData';
import { requireFilterNodes } from '../../utils/filterContracts';
import { tableNotes, tableRecordFocus, tableTemplates, tableView } from './vault-view-body/table-contract';

function isCalendarTemplate(value: Readonly<Record<string, unknown>>): value is BulkActionTemplate {
    return typeof value.id === 'string'
        && (value.title === undefined || value.title === null || typeof value.title === 'string');
}

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
    readonly onDeletePage?: (pageId: string, title?: VaultViewPage['title']) => void;
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

const ignoreNoteSelect = (): void => {};

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
    const tableTemplateOptions = useMemo(() => tableTemplates(templates), [templates]);

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
        templates: tableTemplateOptions,
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
        filters: requireFilterNodes(resolveViewFilters(activeView)),
        sorts: resolveViewSorts(activeView, { field: 'last_modified', direction: 'desc' }),
        search: searchTerm,
    }), [activeView, searchTerm]);
    const { sortedPages: viewFilteredNotes } = useVaultViewData({
        pages: notes,
        schema,
        view: filteredViewConfig,
        searchTerm,
    });
    const calendarNotes = useMemo(() => viewFilteredNotes.map((note) => ({
        ...note, title: note.title == null ? note.title : String(note.title),
    })), [viewFilteredNotes]);
    // Keep each normalization keyed to its own input: focus/view changes must
    // not recreate page arrays that needed normalization (e.g. scalar titles).
    const tablePages = useMemo(() => tableNotes(notes), [notes]);
    const tableAllPages = useMemo(() => tableNotes(allNotes), [allNotes]);
    const tableActiveView = useMemo(() => tableView(activeView), [activeView]);
    const tableFocusRequest = useMemo(() => tableRecordFocus(restoreRecordFocus), [restoreRecordFocus]);

    let body: ReactNode;
    if (t === 'board') {
        // `onUpdateNote` enables drag & drop of cards between columns
        // (writes the record's grouping field on drop).
        body = <VaultKanban {...common} isEmbedded={isEmbedded} onUpdateNote={onUpdateNote} />;
    } else if (t === 'gallery') {
        body = (
            <VaultGallery
                {...common}
                registerNavApi={registerNavApi}
                onExitTop={onExitTop}
                onExitBottom={onExitBottom}
                onFocusShell={onFocusShell}
                onOpenParallel={onOpenParallel}
            />
        );
    } else if (t === 'timeline') {
        body = <VaultTimeline {...common} onUpdateNote={onUpdateNote} />;
    } else if (t === 'chart') {
        body = <VaultChart notes={viewFilteredNotes} schema={schema} activeView={activeView} />;
    } else if (t === 'feed') {
        body = (
            <VaultFeed
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
                templates={tableTemplateOptions}
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
            <DigitalBrainCalendar
                // `key`: FullCalendar only reads initialView on mount; changing
                // the "initial view" in the modal with the calendar open did nothing
                // until you left and came back. Remounting is cheap here.
                key={activeView.calendarView || 'dayGridMonth'}
                allNotes={calendarNotes}
                onNoteSelect={onNoteSelect}
                onDeletePage={onDeletePage ? (id, title) => { onDeletePage(id, title ?? undefined); } : undefined}
                onDeleteSelected={onDeleteSelected}
                onApplyTemplate={onApplyTemplate}
                templates={templates.filter(isCalendarTemplate)}
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
            <VaultTable
                notes={tablePages}
                allNotes={tableAllPages}
                activeView={tableActiveView}
                templates={tableTemplateOptions}
                restoreRecordFocus={tableFocusRequest}
                schema={schema}
                idToTitle={idToTitle}
                searchTerm={searchTerm}
                onNoteSelect={onNoteSelect ?? ignoreNoteSelect}
                onCreateRecord={onCreateRecord}
                onDeletePage={onDeletePage}
                onDeleteSelected={onDeleteSelected}
                onApplyTemplate={onApplyTemplate}
                onCreateNotebook={onCreateNotebook ? ids => { onCreateNotebook(Array.from(ids)); } : undefined}
                onUpdateView={onUpdateView}
                isEmbedded={isEmbedded}
                maxHeight={maxHeight}
                isListView={t === 'list'}
                onOpenParallel={onOpenParallel}
                onCellSaved={onCellSaved}
                onTranslated={onTranslated}
                onUpdateFieldOptions={onUpdateFieldOptions}
                actionRules={actionRules}
                functionalities={functionalities}
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
