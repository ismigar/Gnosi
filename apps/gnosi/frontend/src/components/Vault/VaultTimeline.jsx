import React, { useMemo, useState, useRef, useCallback } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { useTitlePreview } from './useTitlePreview';
import { FileText, Calendar, Clock, Link as LinkIcon, CheckSquare, ChevronLeft, ChevronRight, ArrowRight, Plus } from 'lucide-react';
import { useVaultViewData } from '../../hooks/useVaultViewData';
import { VaultViewToolbar } from './VaultViewToolbar';
import { getSchemaFieldEntries, getSchemaFieldNames, getFieldType, getFieldConfig, resolveViewSorts, resolveViewFilters } from './schemaUtils';
import { normalizeOptions, optionColorHex } from './optionCatalogUtils';
import { formatDate, resolveFieldFormat } from './formatUtils';
import i18n from '../../i18n';
import { useLocaleSettings } from '../../hooks/useLocaleSettings';
import { parsePeriod } from './VaultDateProperty';
import {
    addWorkingDuration,
    formatLocalDateTime,
    nextWorkingInstant,
    serializePeriod,
    withPeriodBoundaries,
    workingDurationDays,
} from '../../utils/projectPlanning';
import { usePlugins } from '../../plugins/usePlugins';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';

// `new Date('YYYY-MM-DD')` interprets the date as UTC midnight: in zones
// UTC− the bar is painted (and the round-trip of `handleUpdateDates`, which
// serializes with LOCAL getters, re-saves) the PREVIOUS day. Dates without
// time are parsed as LOCAL by appending 'T00:00:00'.
const parseLocalDate = (v) => {
    const s = String(v ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(v);
};

// ── Jerarquia tasca/subtasca (estil MS Project) ─────────────────────────────
// Folded key (lowercase, no accents or symbols) to match field names.
const foldKey = (k) => String(k ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
// Folded names of RELATION fields that point to the record's parent. We cover
// the vault's native parent_id and the usual aliases from Notion imports
// ("main item" in Tasques, "Parent item"…).
const PARENT_FIELD_ALIASES = new Set([
    'itemprincipal', 'parentitem', 'parent', 'pare', 'mare',
    'tascamare', 'tareapadre', 'tascaprincipal', 'tareaprincipal', 'parenttask',
]);

// A note's parent id: direct parent_id/source_parent_id, or the FIRST id
// of a relation field whose name is a parent alias.
const resolveParentId = (note, schema, getEntriesFn) => {
    const md = note.metadata || {};
    const direct = md.parent_id || note.parent_id || md.source_parent_id;
    if (direct) return String(direct);
    for (const [key, type] of getEntriesFn(schema)) {
        if (type !== 'relation') continue;
        if (!PARENT_FIELD_ALIASES.has(foldKey(key))) continue;
        const v = md[key];
        const first = Array.isArray(v) ? v[0] : v;
        if (first) return String(first);
    }
    return null;
};

export function VaultTimeline({ notes, onNoteSelect, onUpdateNote, schema = {}, idToTitle = {}, activeView = {}, onEditSchema, onCreateRecord, onDeleteSelected, onDeletePage, onApplyTemplate, templates = [], searchTerm: externalSearchTerm }) {
    const { t } = useTranslation();
    const { isEnabled: isPluginEnabled, getPluginSettings } = usePlugins();
    const projectPlanningEnabled = isPluginEnabled('project-planning');
    const projectPlanningSettings = getPluginSettings('project-planning');
    // Content preview when hovering over a row's title (label).
    const titlePreview = useTitlePreview({ onOpenPage: onNoteSelect });
    const scrollContainerRef = useRef(null);

    // Each bar's color from a field (activeView.colorField): uses the color of
    // the matching option (schema palette). Without colorField, a single color.
    const colorField = activeView?.colorField || '';
    const barColorMap = (() => {
        if (!colorField) return null;
        const cfg = getFieldConfig(schema, colorField);
        const opts = Array.isArray(cfg?.options) ? normalizeOptions(cfg.options) : [];
        const m = {};
        opts.forEach(o => { m[o.name] = optionColorHex(o.color); });
        return m;
    })();
    const getBarColor = (note) => {
        if (barColorMap) {
            const v = note?.metadata?.[colorField];
            if (v && barColorMap[v]) return barColorMap[v];
        }
        return 'var(--gnosi-primary)';
    };
    const [zoomLevel, setZoomLevel] = useState('month'); // 'day', 'week', 'month'
    const [selectingPredecessorFor, setSelectingPredecessorFor] = useState(null);
    const [internalSearchTerm, setInternalSearchTerm] = useState('');
    const searchTerm = externalSearchTerm !== undefined ? externalSearchTerm : internalSearchTerm;
    const setSearchTerm = externalSearchTerm !== undefined ? () => { } : setInternalSearchTerm;

    // ---- UNIFIED DATA LOGIC (FILTERS, SORT, SEARCH) ----
    // Sorting is resolved with `resolveViewSorts` (the `sorts` key — the one persisted by
    // the Notion import and the modal — with fallback to the legacy `sort`).
    // Memoized: `resolveViewSorts` always returns a NEW array and without the
    // useMemo the downstream memos (sortedPages, chartData) were recomputed
    // on EVERY render.
    const hasExplicitSorts = useMemo(() => resolveViewSorts(activeView).length > 0, [activeView]);
    const viewConfig = useMemo(() => ({
        filters: resolveViewFilters(activeView),
        sorts: resolveViewSorts(activeView, { field: "last_modified", direction: "desc" }),
        search: searchTerm
    }), [activeView, searchTerm]);

    const { sortedPages: sortedAndFilteredNotes } = useVaultViewData({ pages: notes, schema, view: viewConfig, searchTerm });
    const { selectedIds, isSelected, toggleSelect, selectAll, clearSelection } = useVaultSelection(sortedAndFilteredNotes);

    const handleBulkDelete = useCallback(() => {
        if (selectedIds.size === 0) return;
        if (onDeleteSelected) {
            onDeleteSelected(new Set(selectedIds));
            clearSelection();
        } else if (onDeletePage) {
            const safeNotes = notes || [];
            selectedIds.forEach(id => {
                const note = safeNotes.find(n => n.id === id);
                if (note) onDeletePage(id, note.title);
            });
            clearSelection();
        }
    }, [selectedIds, onDeleteSelected, onDeletePage, notes, clearSelection]);

    useVaultSelectionShortcuts({
        selectedCount: selectedIds.size,
        onClearSelection: clearSelection,
        onDeleteSelection: handleBulkDelete,
    });

    const datePropertyFound = useMemo(() => {
        // Prefers the start field chosen in the view (`dateField`); if there
        // has one, it falls back to the schema's first temporal field. A `period` (range
        // start→end in a single field) is also valid as the start axis.
        if (activeView?.dateField && getSchemaFieldNames(schema).includes(activeView.dateField)) {
            return activeView.dateField;
        }
        const entries = getSchemaFieldEntries(schema);
        return entries.find(([, type]) => type === 'date')?.[0]
            || entries.find(([, type]) => type === 'datetime' || type === 'period')?.[0];
    }, [schema, activeView?.dateField]);

    const endPropertyFound = useMemo(() => {
        // Prioritizes the end field chosen in the view (`endDateField`).
        if (activeView?.endDateField && getSchemaFieldNames(schema).includes(activeView.endDateField)) {
            return activeView.endDateField;
        }
        const endKeys = ['due_date', 'end_date', 'data de venciment', 'venciment'];
        const dateLike = ['date', 'datetime', 'period'];
        // Only treat the field as an end date if it is declared as a date in the
        // schema. This prevents a text field named "end_date" from being parsed as
        // to date in the Gantt.
        return getSchemaFieldNames(schema).find(k => {
            if (!endKeys.includes(k.toLowerCase())) return false;
            return dateLike.includes(getFieldType(schema, k));
        });
    }, [schema, activeView?.endDateField]);

    // Configured date format (Settings) — the same one respected by the table and
    // the cards (gallery/feed/kanban). Without this the Gantt showed dates
    // with `toLocaleDateString()` (the BROWSER's format), ignoring the config.
    const localeSettings = useLocaleSettings();
    const tlDateFmt = useMemo(
        () => resolveFieldFormat(getFieldConfig(schema, datePropertyFound), localeSettings),
        [schema, datePropertyFound, localeSettings]
    );
    const fmtTLDate = useCallback(
        (d) => formatDate(d, { dateFormat: tlDateFmt.dateFormat, type: 'date', locale: tlDateFmt.dateLocale }),
        [tlDateFmt]
    );
    const periodFieldConfig = getFieldConfig(schema, datePropertyFound);
    const enhancedPeriod = projectPlanningEnabled
        && getFieldType(schema, datePropertyFound) === 'period';
    const skipNonWorkingDays = periodFieldConfig.skip_non_working_days !== false;
    const getPeriodValue = useCallback(
        (note) => note?.metadata?.[datePropertyFound] ?? '',
        [datePropertyFound],
    );
    const getPredecessors = useCallback((note) => {
        if (enhancedPeriod) {
            const structured = parsePeriod(getPeriodValue(note));
            if (structured.version === 2) return structured.predecessorIds;
        }
        return note?.metadata?.predecessor_ids || [];
    }, [enhancedPeriod, getPeriodValue]);

    // Data logic for the Gantt
    const { chartData, timeScale } = useMemo(() => {
        const processedNotes = sortedAndFilteredNotes.map(note => {
            let startDateStr = note.last_modified;
            let endDateStr = null;

            if (datePropertyFound) {
                // Normalized keys (no spaces or symbols) so they match
                // `schemaKeyNorm` — with the original keys ("date added") the
                // lookup never matched and the alias was dead code.
                const aliasMap = {
                    dateadded: "created_time",
                    datemodified: "last_edited_time"
                };
                const normalizeKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/gi, '');
                const schemaKeyNorm = normalizeKey(datePropertyFound);
                const targetKeyNorm = aliasMap[schemaKeyNorm] ? normalizeKey(aliasMap[schemaKeyNorm]) : schemaKeyNorm;
                const metaKey = note.metadata ? Object.keys(note.metadata).find(k => normalizeKey(k) === targetKeyNorm) || datePropertyFound : datePropertyFound;

                const rawStart = note.metadata?.[metaKey];
                if (getFieldType(schema, datePropertyFound) === 'period') {
                    // A `period` carries start AND end in a single value ("start/end"):
                    // we decompose it instead of passing it raw to new Date().
                    const { start: ps, end: pe } = parsePeriod(rawStart);
                    if (ps && !isNaN(parseLocalDate(ps).getTime())) startDateStr = ps;
                    if (pe && !isNaN(parseLocalDate(pe).getTime())) endDateStr = pe;
                } else {
                    if (rawStart && !isNaN(parseLocalDate(rawStart).getTime())) {
                        startDateStr = rawStart;
                    }
                    if (endPropertyFound && note.metadata?.[endPropertyFound]) {
                        const rawEnd = note.metadata[endPropertyFound];
                        // The end field could also be a period: we take its end.
                        endDateStr = getFieldType(schema, endPropertyFound) === 'period'
                            ? (parsePeriod(rawEnd).end || parsePeriod(rawEnd).start)
                            : rawEnd;
                    }
                }
            }

            const start = parseLocalDate(startDateStr);
            let end = endDateStr ? parseLocalDate(endDateStr) : new Date(start.getTime() + 24 * 60 * 60 * 1000);
            // Invalid OR inverted end (end < start, corrupt data): one-day bar
            // instead of negative percentages that break the layout.
            if (isNaN(end.getTime()) || end < start) {
                end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
            }

            return { ...note, start, end };
        }).filter(n => !isNaN(n.start.getTime()));

        if (processedNotes.length === 0) return { chartData: [], timeScale: null };

        // Trobar rang total
        const minDate = new Date(Math.min(...processedNotes.map(n => n.start.getTime())));
        const maxDate = new Date(Math.max(...processedNotes.map(n => n.end.getTime())));

        const chartStart = new Date(minDate);
        chartStart.setDate(1);
        const chartEnd = new Date(maxDate);
        chartEnd.setMonth(chartEnd.getMonth() + 2);

        const months = [];
        let curr = new Date(chartStart);
        while (curr <= chartEnd) {
            months.push(new Date(curr));
            curr.setMonth(curr.getMonth() + 1);
        }

        // ── Jerarquia tasca/subtasca (estil MS Project) ──
        // Subtasks (parent_id or an "ítem principal" alias relation…) are
        // drawn indented under their parent, and the parent becomes a SUMMARY bar
        // spanning its children (min start, max end), like MS Project.
        const byId = new Map(processedNotes.map(n => [n.id, n]));
        const childrenOf = new Map();
        const roots = [];
        processedNotes.forEach(n => {
            const pid = resolveParentId(n, schema, getSchemaFieldEntries);
            if (pid && pid !== n.id && byId.has(pid)) {
                if (!childrenOf.has(pid)) childrenOf.set(pid, []);
                childrenOf.get(pid).push(n);
            } else {
                roots.push(n);
            }
        });

        // Summary span of each node (recursive, with a cycle guard).
        const summarize = (n, seen) => {
            if (seen.has(n.id)) return { start: n.start, end: n.end };
            seen.add(n.id);
            let start = n.start;
            let end = n.end;
            for (const kid of childrenOf.get(n.id) || []) {
                const s = summarize(kid, seen);
                if (s.start < start) start = s.start;
                if (s.end > end) end = s.end;
            }
            n.summaryStart = start;
            n.summaryEnd = end;
            n.isParent = (childrenOf.get(n.id) || []).length > 0;
            return { start, end };
        };
        roots.forEach(r => summarize(r, new Set()));

        // Flattens: parent followed by its children (children in chronological order).
        // Root order: the view's, if explicit; otherwise chronological by
        // its summary scope.
        const orderedRoots = hasExplicitSorts ? roots : [...roots].sort((a, b) => (a.summaryStart ?? a.start) - (b.summaryStart ?? b.start));
        const flat = [];
        const pushTree = (n, depth, seen) => {
            if (seen.has(n.id)) return;
            seen.add(n.id);
            flat.push({ ...n, depth });
            const kids = [...(childrenOf.get(n.id) || [])].sort((a, b) => a.start - b.start);
            kids.forEach(k => pushTree(k, depth + 1, seen));
        };
        const seenFlat = new Set();
        orderedRoots.forEach(r => pushTree(r, 0, seenFlat));

        return {
            chartData: flat,
            timeScale: { start: chartStart, end: chartEnd, months }
        };
    }, [sortedAndFilteredNotes, schema, datePropertyFound, endPropertyFound, hasExplicitSorts]);

    const calculatePosition = (date) => {
        if (!timeScale) return 0;
        const totalMs = timeScale.end - timeScale.start;
        const currentMs = date - timeScale.start;
        return (currentMs / totalMs) * 100;
    };

    const handleUpdateDates = async (noteId, newStart, newEnd) => {
        if (!onUpdateNote) return;

        const note = chartData.find(n => n.id === noteId);
        if (!note) return;

        // Serializes a Date in LOCAL time according to the field type. NEVER
        // `toISOString()` (UTC): in a UTC+ zone it would shift the DAY (a
        // `date`: local midnight falls on the previous day in UTC) or the TIME
        // (`datetime`), and would dirty the field with a UTC datetime. Same fix
        // than in the calendar and in the date editor.
        const pad = (n) => String(n).padStart(2, '0');
        const fmtDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const fmtForField = (d, field) =>
            getFieldType(schema, field) === 'datetime'
                ? `${fmtDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
                : fmtDay(d);

        // ONLY the view's date fields: the backend PATCH merges the
        // metadata, so we don't clobber keys edited in between (e.g. the
        // `predecessor_ids` that handleAddPredecessor has just saved and that
        // chartData doesn't yet reflect). A `period` start field carries
        // start and end together and it's reserialized as "start/end" (before it used to write a
        // toISOString() that destroyed the range); an END field of type `period` (an
        // atypical config) is left untouched.
        const buildDateMetadata = (start, end, targetNote) => {
            const md = {};
            if (datePropertyFound) {
                if (getFieldType(schema, datePropertyFound) === 'period') {
                    if (enhancedPeriod) {
                        const current = getPeriodValue(targetNote);
                        const next = parsePeriod(withPeriodBoundaries(
                            current,
                            formatLocalDateTime(start),
                            formatLocalDateTime(end),
                            { startMode: 'manual', endMode: 'manual' },
                        ));
                        if (periodFieldConfig.duration_enabled !== false) {
                            next.durationDays = workingDurationDays(
                                next.start,
                                next.end,
                                projectPlanningSettings,
                                skipNonWorkingDays,
                            );
                        }
                        md[datePropertyFound] = serializePeriod(next);
                    } else {
                        md[datePropertyFound] = `${fmtDay(start)}/${fmtDay(end)}`;
                    }
                } else {
                    md[datePropertyFound] = fmtForField(start, datePropertyFound);
                }
            }
            if (endPropertyFound && getFieldType(schema, endPropertyFound) !== 'period') {
                md[endPropertyFound] = fmtForField(end, endPropertyFound);
            }
            return md;
        };

        // Recursion for successors
        const updatedNotes = recalculateSuccessors(noteId, newStart, newEnd, chartData);

        // We save the ROOT note (previously its metadata was built and
        // never sent: only the successors were moved) and then the affected ones.
        // If the root save fails, stop: don't cascade successor writes off a move
        // the backend rejected (onUpdateNote now rethrows on failure).
        try {
            await onUpdateNote(noteId, { metadata: buildDateMetadata(newStart, newEnd, note) });
            for (const updatedNote of updatedNotes) {
                await onUpdateNote(updatedNote.id, {
                    metadata: buildDateMetadata(updatedNote.start, updatedNote.end, updatedNote),
                });
            }
        } catch (err) {
            console.error('Error updating timeline dates:', err);
        }
    };

    // `visited` breaks dependency CYCLES (A→B→A): without the guard, the
    // recursion pushed the dates forward indefinitely until it blew the
    // stack (RangeError) and crash the view.
    const recalculateSuccessors = (updatedNoteId, newStart, newEnd, allProcessedNotes, visited = new Set([updatedNoteId])) => {
        const affected = [];
        const note = allProcessedNotes.find(n => n.id === updatedNoteId);
        if (!note) return affected;

        const successors = allProcessedNotes.filter(n => getPredecessors(n).includes(updatedNoteId));

        successors.forEach(succ => {
            if (visited.has(succ.id)) return;
            const normalizedStart = enhancedPeriod
                ? nextWorkingInstant(
                    formatLocalDateTime(newEnd),
                    projectPlanningSettings,
                    skipNonWorkingDays,
                )
                : newEnd;
            const minStart = new Date(normalizedStart);
            if (succ.start < minStart) {
                const newSuccStart = new Date(minStart);
                const successorPeriod = parsePeriod(getPeriodValue(succ));
                const scheduledEnd = enhancedPeriod && successorPeriod.durationDays !== null
                    ? addWorkingDuration(
                        normalizedStart,
                        successorPeriod.durationDays,
                        projectPlanningSettings,
                        skipNonWorkingDays,
                    )
                    : '';
                const newSuccEnd = scheduledEnd
                    ? new Date(scheduledEnd)
                    : new Date(minStart.getTime() + (succ.end - succ.start));

                const succCopy = { ...succ, start: newSuccStart, end: newSuccEnd };
                affected.push(succCopy);
                visited.add(succ.id);

                // Recurrence
                const subAffected = recalculateSuccessors(succ.id, newSuccStart, newSuccEnd, allProcessedNotes.map(n => n.id === succ.id ? succCopy : n), visited);
                affected.push(...subAffected);
            }
        });

        // Unique by ID (keep latest update)
        const unique = Array.from(new Map(affected.map(item => [item.id, item])).values());
        return unique;
    };

    // A note's transitive successors: excluded from the predecessor picker
    // because picking one would create a dependency cycle.
    const collectTransitiveSuccessors = (rootId) => {
        const out = new Set();
        const stack = [rootId];
        while (stack.length) {
            const cur = stack.pop();
            chartData.forEach(n => {
                if (!out.has(n.id) && getPredecessors(n).includes(cur)) {
                    out.add(n.id);
                    stack.push(n.id);
                }
            });
        }
        return out;
    };

    const handleAddPredecessor = async (noteId, predId) => {
        const note = notes.find(n => n.id === noteId);
        if (!note || !onUpdateNote) return;

        const predecessors = [...getPredecessors(note)];
        if (!predecessors.includes(predId)) {
            predecessors.push(predId);
            const predNote = chartData.find(n => n.id === predId);
            const currentProcessed = chartData.find(n => n.id === noteId);
            if (enhancedPeriod) {
                const next = parsePeriod(getPeriodValue(note));
                next.predecessorIds = predecessors;
                if ((!next.start || next.startMode === 'auto') && predNote) {
                    next.start = nextWorkingInstant(
                        formatLocalDateTime(predNote.end),
                        projectPlanningSettings,
                        skipNonWorkingDays,
                    );
                    next.startMode = 'auto';
                    if (next.durationDays !== null) {
                        next.end = addWorkingDuration(
                            next.start,
                            next.durationDays,
                            projectPlanningSettings,
                            skipNonWorkingDays,
                        );
                        next.endMode = 'auto';
                    }
                }
                await onUpdateNote(noteId, {
                    metadata: { [datePropertyFound]: serializePeriod(next) },
                });
            } else {
                await onUpdateNote(noteId, {
                    metadata: { ...note.metadata, predecessor_ids: predecessors },
                });
                if (predNote && currentProcessed) {
                    const minStart = new Date(predNote.end);
                    if (currentProcessed.start < minStart) {
                        const duration = currentProcessed.end - currentProcessed.start;
                        const newStart = new Date(minStart);
                        const newEnd = new Date(minStart.getTime() + duration);
                        await handleUpdateDates(noteId, newStart, newEnd);
                    }
                }
            }
        }
        setSelectingPredecessorFor(null);
    };

    const scroll = (direction) => {
        if (scrollContainerRef.current) {
            const amount = direction === 'left' ? -300 : 300;
            scrollContainerRef.current.scrollBy({ left: amount, behavior: 'smooth' });
        }
    };

    // Candidates for ancestor: everyone except the note itself and its
    // successors (direct or transitive) — choosing one would create a cycle.
    const predecessorCandidates = selectingPredecessorFor
        ? (() => {
            const excluded = collectTransitiveSuccessors(selectingPredecessorFor);
            return chartData.filter(n => n.id !== selectingPredecessorFor && !excluded.has(n.id));
        })()
        : [];

    // Scale width from the zoom level: the same time range spread over more
    // pixels = wider bars. Previously `zoomLevel` only styled the button.
    const scaleMinWidth = zoomLevel === 'day' ? '12000px' : zoomLevel === 'week' ? '6000px' : '3000px';

    return (
        <div className="w-full h-full flex flex-col bg-[var(--bg-primary)] overflow-hidden relative">
            {/* Predecessors Selector Overlay */}
            {selectingPredecessorFor && (
                <div className="absolute inset-0 bg-black/60 z-[100] flex items-center justify-center p-4">
                    <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
                        <h3 className="text-lg font-bold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                            <ArrowRight size={20} className="text-[var(--gnosi-primary)]" />
                            {t('timeline.select_predecessor', "Select a Predecessor")}
                        </h3>
                        <p className="text-sm text-[var(--text-secondary)] mb-4">
                            <Trans
                                i18nKey="timeline.predecessor_prompt"
                                defaults="Choose which record must finish before <bold>{{name}}</bold> can start."
                                values={{ name: idToTitle[selectingPredecessorFor] }}
                                components={{ bold: <strong /> }}
                            />
                        </p>
                        <div className="max-h-64 overflow-y-auto border border-[var(--border-primary)] rounded-lg">
                            {predecessorCandidates.map(n => (
                                <button
                                    key={n.id}
                                    onClick={() => handleAddPredecessor(selectingPredecessorFor, n.id)}
                                    className="w-full px-4 py-3 text-left hover:bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] last:border-0 flex items-center justify-between group transition-colors"
                                >
                                    <span className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--gnosi-primary)]">
                                        {n.title || "Sense Títol"}
                                    </span>
                                    <span className="text-[10px] text-[var(--text-tertiary)]">
                                        {t('timeline.until', "Until {{date}}", { date: fmtTLDate(n.end) })}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <div className="mt-6 flex justify-end">
                            <button
                                onClick={() => setSelectingPredecessorFor(null)}
                                className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded-lg transition-colors"
                            >
                                Cancel·lar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* UNIFIED TOOLBAR */}
            {externalSearchTerm === undefined && (
                <VaultViewToolbar
                    search={searchTerm}
                    onSearchChange={setSearchTerm}
                    onToggleFilters={() => onEditSchema?.('filters')}
                    onToggleSorts={() => onEditSchema?.('sorts')}
                    onAddNew={onCreateRecord}
                    activeFiltersCount={resolveViewFilters(activeView).length}
                    activeSortsCount={resolveViewSorts(activeView).length}
                    isEmbedded={false}
                    extraActions={
                        <div className="flex items-center gap-2 ml-4">
                            <button
                                onClick={() => scroll('left')}
                                className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-md text-[var(--text-tertiary)] transition-colors border border-[var(--border-primary)]"
                            >
                                <ChevronLeft size={14} />
                            </button>
                            <button
                                onClick={() => scroll('right')}
                                className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-md text-[var(--text-tertiary)] transition-colors border border-[var(--border-primary)]"
                            >
                                <ChevronRight size={14} />
                            </button>

                            <div className="flex bg-[var(--bg-tertiary)] p-1 rounded-lg border border-[var(--border-primary)] ml-2">
                                {['day', 'week', 'month'].map((level) => (
                                    <button
                                        key={level}
                                        onClick={() => setZoomLevel(level)}
                                        className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded transition-all ${zoomLevel === level
                                            ? 'bg-[var(--bg-primary)] text-[var(--gnosi-primary)] shadow-sm'
                                            : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                                            }`}
                                    >
                                        {level === 'day' ? 'Dia' : level === 'week' ? 'Set' : 'Mes'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    }
                />
            )}

            {selectedIds.size > 0 && (
                <VaultBulkActionsBar
                    selectedIds={selectedIds}
                    totalCount={sortedAndFilteredNotes.length}
                    onSelectAll={() => selectAll(sortedAndFilteredNotes.map(n => n.id))}
                    onClearSelection={clearSelection}
                    onDeleteSelected={(onDeleteSelected || onDeletePage) ? handleBulkDelete : null}
                    templates={templates}
                    onApplyTemplate={onApplyTemplate ? (templateId) => { onApplyTemplate(new Set(selectedIds), templateId); clearSelection(); } : null}
                />
            )}

            {/* Gantt Area */}
            <div className="flex-1 overflow-hidden flex flex-col">
                <div
                    ref={scrollContainerRef}
                    className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar relative bg-[var(--bg-primary)] pt-vault-header-top"
                >
                    {/* Time Scale Header */}
                    <div className="sticky top-0 z-10 flex min-w-full bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] h-10 shadow-sm">
                        <div className="w-64 shrink-0 border-r border-[var(--border-primary)] bg-[var(--bg-secondary)] flex items-center px-4 font-bold text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
                            {t('timeline.col_title', "Record Title")}
                        </div>
                        <div className="flex-1 relative" style={{ minWidth: scaleMinWidth }}>
                            {timeScale?.months.map((month, idx) => {
                                const left = calculatePosition(month);
                                const nextMonth = new Date(month);
                                nextMonth.setMonth(nextMonth.getMonth() + 1);
                                const width = calculatePosition(nextMonth) - left;

                                return (
                                    <div
                                        key={idx}
                                        style={{ left: `${left}%`, width: `${width}%` }}
                                        className="absolute h-full border-r border-[var(--border-primary)] flex items-center px-3 text-[10px] font-bold text-[var(--text-secondary)] truncate bg-[var(--bg-secondary)]"
                                    >
                                        {month.toLocaleString(i18n.language, { month: 'short', year: 'numeric' }).toUpperCase()}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Grid and Rows */}
                    <div className="relative min-w-full min-h-full">
                        {/* Vertical Grid Lines */}
                        <div className="absolute inset-0 flex pointer-events-none">
                            <div className="w-64 shrink-0 border-r border-[var(--border-primary)]" />
                            <div className="flex-1 relative" style={{ minWidth: scaleMinWidth }}>
                                {timeScale?.months.map((month, idx) => (
                                    <div
                                        key={idx}
                                        style={{ left: `${calculatePosition(month)}%` }}
                                        className="absolute h-full border-r border-[var(--border-primary)]"
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Rows */}
                        <div className="relative z-0">
                            {chartData.map((note) => {
                                // Parents are drawn as a SUMMARY bar of their span
                                // (min start → max end of the children), like MS Project.
                                const barStart = note.isParent ? (note.summaryStart ?? note.start) : note.start;
                                const barEnd = note.isParent ? (note.summaryEnd ?? note.end) : note.end;
                                const startPos = calculatePosition(barStart);
                                const endPos = calculatePosition(barEnd);
                                const width = Math.max(endPos - startPos, 0.5);
                                const depth = note.depth || 0;
                                const predecessors = getPredecessors(note);

                                return (
                                    <div
                                        key={note.id}
                                        className="flex border-b border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]/50 transition-colors group h-12"
                                    >
                                        {/* Label Area */}
                                        <div
                                            className={`w-64 shrink-0 border-r border-[var(--border-primary)] pr-4 flex items-center gap-2 cursor-pointer overflow-hidden z-10 sticky left-0 ${isSelected(note.id) ? 'bg-[var(--gnosi-primary)]/10' : 'bg-[var(--bg-primary)]'}`}
                                            style={{ paddingLeft: `${16 + depth * 16}px` }}
                                            onClick={() => onNoteSelect(note.id)}
                                        >
                                            {depth > 0 && (
                                                <span className="shrink-0 text-[var(--text-tertiary)] text-[10px] font-mono select-none" aria-hidden="true">└</span>
                                            )}
                                            <label
                                                className="cursor-pointer inline-flex items-center"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected(note.id)}
                                                    onChange={(e) => toggleSelect(note.id, e)}
                                                    className="w-3.5 h-3.5 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)] cursor-pointer bg-[var(--bg-secondary)]"
                                                />
                                            </label>
                                            <div className="shrink-0 w-6 h-6 rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] flex items-center justify-center text-xs">
                                                <FileText size={14} className="text-[var(--text-tertiary)]" />
                                            </div>
                                            <div className="flex flex-col min-w-0 flex-1">
                                                <span className={`${note.isParent ? 'font-bold' : 'font-semibold'} text-[var(--text-primary)] text-xs truncate group-hover:text-[var(--gnosi-primary)] transition-colors`} {...titlePreview.getTitleProps(note.id)}>
                                                    {note.title || "Sense Títol"}
                                                </span>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[9px] text-[var(--text-tertiary)] font-medium">
                                                        {note.start.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })}
                                                    </span>
                                                </div>
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectingPredecessorFor(note.id);
                                                }}
                                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[var(--gnosi-primary)]/10 rounded text-[var(--gnosi-primary)] transition-all"
                                                title={t('timeline.add_predecessor', "Add predecessor")}
                                            >
                                                <Plus size={12} />
                                            </button>
                                        </div>

                                        {/* Timeline Bar Area */}
                                        <div className="flex-1 relative h-full flex items-center px-0" style={{ minWidth: scaleMinWidth }}>
                                            {/* Draw Dependency Lines (Simple) */}
                                            {predecessors.map(predId => {
                                                const pred = chartData.find(n => n.id === predId);
                                                if (!pred) return null;
                                                const predEndPos = calculatePosition(pred.end);
                                                if (predEndPos > startPos) return null;

                                                return (
                                                    <div
                                                        key={`${note.id}-${predId}`}
                                                        className="absolute h-px bg-indigo-200/50 pointer-events-none"
                                                        style={{
                                                            left: `${predEndPos}%`,
                                                            width: `${startPos - predEndPos}%`,
                                                            top: '50%',
                                                            transform: 'translateY(-50%)'
                                                        }}
                                                    />
                                                );
                                            })}

                                            {note.isParent ? (
                                                // Barra RESUM (estil MS Project): prima i fosca,
                                                // with diamond-shaped caps at the ends; it spans all
                                                // the subtasks.
                                                <div
                                                    onClick={() => onNoteSelect(note.id)}
                                                    className="absolute h-2 rounded-[2px] cursor-pointer group/bar"
                                                    style={{
                                                        left: `${startPos}%`,
                                                        width: `${width}%`,
                                                        minWidth: '24px',
                                                        backgroundColor: 'var(--text-secondary)',
                                                    }}
                                                >
                                                    <span className="absolute -left-[1px] top-[3px] w-2 h-2 rotate-45 bg-[var(--text-secondary)]" aria-hidden="true" />
                                                    <span className="absolute -right-[1px] top-[3px] w-2 h-2 rotate-45 bg-[var(--text-secondary)]" aria-hidden="true" />

                                                    {/* Tooltip on hover */}
                                                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 px-3 py-2 bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded shadow-xl text-[10px] opacity-0 group-hover/bar:opacity-100 z-30 pointer-events-none transition-opacity whitespace-nowrap font-medium border border-[var(--border-primary)]">
                                                        <strong>{note.title}</strong><br />
                                                        {fmtTLDate(barStart)} - {fmtTLDate(barEnd)}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div
                                                    onClick={() => onNoteSelect(note.id)}
                                                    className="absolute h-6 rounded-md border border-black/10 dark:border-white/10 shadow-sm hover:brightness-110 hover:scale-y-105 transition-all cursor-pointer flex items-center px-2 group/bar overflow-hidden"
                                                    style={{
                                                        left: `${startPos}%`,
                                                        width: `${width}%`,
                                                        minWidth: '60px',
                                                        backgroundColor: getBarColor(note),
                                                    }}
                                                >
                                                    <div className="flex items-center gap-1 text-white min-w-0">
                                                        <span className="text-[10px] font-bold whitespace-nowrap truncate">
                                                            {note.title || "Note"}
                                                        </span>
                                                    </div>

                                                    {/* Tooltip on hover */}
                                                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-2 bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded shadow-xl text-[10px] opacity-0 group-hover/bar:opacity-100 z-30 pointer-events-none transition-opacity whitespace-nowrap font-medium border border-[var(--border-primary)]">
                                                        <strong>{note.title}</strong><br />
                                                        {fmtTLDate(note.start)} - {fmtTLDate(note.end)}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {chartData.length === 0 && (
                    <div className="w-full h-64 flex flex-col items-center justify-center text-[var(--text-tertiary)]">
                        <Calendar size={48} className="mb-4 text-[var(--bg-tertiary)]" strokeWidth={1} />
                        <p>{t('timeline.no_data', "No data to show in the timeline.")}</p>
                    </div>
                )}
            </div>

            {/* Legend / Footer */}
            <div className="px-6 py-2 border-t border-[var(--border-primary)] bg-[var(--bg-primary)] flex items-center justify-between text-[10px] font-medium text-[var(--text-tertiary)]">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded bg-[var(--gnosi-primary)]" />
                        <span>{t('timeline.legend_page', "Page / Task")}</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-bold text-[var(--gnosi-primary)]">
                        <ArrowRight size={10} />
                        <span>{t('timeline.active_deps', "Active dependencies ({{count}} records)", { count: chartData.length })}</span>
                    </div>
                </div>
                <div>
                    {t('timeline.footer_hint', "Interactive timeline with automatic dependencies.")}
                </div>
            </div>

            {titlePreview.preview}
        </div>
    );
}
