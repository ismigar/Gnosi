import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../../shared/notifications/toast';
import { fetchCalendarEvents } from '../../../shared/api/calendar';
import { fetchIntegrations, updateCalendarAliases, updateCalendarColors, updateCalendarSelection, updateDefaultCalendar } from '../../../shared/api/integrations';
import { fetchVaultPages, fetchVaultTables } from '../../../shared/api/vaults';
import { useCalendarList } from '../../../shared/api/useCalendarData';
import { calendarEntry, textValue } from '../components/calendar-sidebar-right/calendarBoundary';
import type { CalendarEntry } from '../components/calendar-sidebar-right/calendarTypes';
import { availableCalendarSources, calendarConfigsFor, calendarSettings, hybridCalendarEntry, type CalendarSettings, type EnabledTable } from './calendarPageModel';

export function useCalendarSources(searchQuery: string, dateRange: { start: string; end: string } | null) {
    const { t } = useTranslation();
    const [pages, setPages] = useState<CalendarEntry[]>([]);
    const [externalEvents, setExternalEvents] = useState<CalendarEntry[]>([]);
    const [undatedNotes, setUndatedNotes] = useState<CalendarEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [integrations, setIntegrations] = useState<CalendarSettings>({});
    const [enabledTables, setEnabledTables] = useState<EnabledTable[]>([]);
    const [selectedCalendars, setSelectedCalendars] = useState(new Set<string>());
    const savedCalendarSelectionRef = useRef<Set<string> | null | undefined>(undefined);
    const [, setPartialData] = useState(false);
    const calendarListQuery = useCalendarList();
    const calendarConfigs = useMemo(() => calendarConfigsFor(availableCalendarSources(pages, externalEvents, enabledTables, integrations), integrations, enabledTables, calendarListQuery.data?.items ?? []), [pages, externalEvents, enabledTables, integrations, calendarListQuery.data]);
    const defaultCalendarId = calendarConfigs.find((config) => config.source === integrations.default_calendar)?.id || calendarConfigs[0]?.id || '';
    const colorMap = useMemo(() => {
        const map: Record<string, string> = Object.fromEntries(calendarConfigs.map((config) => [config.source, config.color]));
        const vaultColor = integrations.vault_calendar?.color || 'var(--gnosi-primary)';
        map.Gnosi ||= vaultColor;
        map['Gnosi Vault'] ||= vaultColor;
        return map;
    }, [calendarConfigs, integrations.vault_calendar?.color]);
    // Initial selection: restores the saved visibility, even for async sources (sub-calendars)
    useEffect(() => {
        let active = true;
        queueMicrotask(() => {
        if (!active) return;
        if (calendarConfigs.length === 0) return;

        // Initialize the ref with the saved selection (only the first time integrations has data)
        if (savedCalendarSelectionRef.current === undefined && Object.keys(integrations).length > 0) {
            const raw = integrations.calendar_selection;
            if (Array.isArray(raw) && raw.length > 0) {
                savedCalendarSelectionRef.current = new Set(raw);
            } else if (!Array.isArray(raw) && raw?.selection && raw.selection.length > 0) {
                savedCalendarSelectionRef.current = new Set(raw.selection);
            } else {
                savedCalendarSelectionRef.current = null; // null = no saved selection → show everything
            }
        }

        const savedSet = savedCalendarSelectionRef.current;

        // Add sources that should be selected but aren't yet
        setSelectedCalendars(prev => {
            const next = new Set(prev);
            const additions: string[] = [];
            calendarConfigs.forEach(cfg => {
                if (!next.has(cfg.source)) {
                    // Add if: there's no saved selection (show everything) or it was in the saved selection
                    if (savedSet === null || savedSet === undefined || savedSet.has(cfg.source)) {
                        next.add(cfg.source);
                        additions.push(cfg.source);
                    }
                    // If it was explicitly hidden (not in savedSet) → don't add
                }
            });
            return additions.length ? next : prev;
        });
        });
        return () => { active = false; };
    }, [calendarConfigs, integrations]);


    // Fetch external events (Google Calendar / CalDAV) for the visible range.
    // If the range/search changes while a request is in flight, the
    // previous one to prevent setExternalEvents from receiving stale data (race).
    const externalEventsAbortRef = useRef<AbortController | null>(null);
    const fetchExternalEvents = useCallback(async (timeMin: string, timeMax: string, search = '') => {
        if (externalEventsAbortRef.current) {
            externalEventsAbortRef.current.abort();
        }
        const controller = new AbortController();
        externalEventsAbortRef.current = controller;
        try {
            const events = await fetchCalendarEvents({
                includeVault: false,
                search: search || undefined,
                timeMax: timeMax || undefined,
                timeMin: timeMin || undefined,
            }, controller.signal);
            if (controller.signal.aborted) return;
            const converted = events.map(hybridCalendarEntry);
            setExternalEvents(converted);
        } catch (err) {
            if (
                controller.signal.aborted
                || (err instanceof Error && ['AbortError', 'CanceledError'].includes(err.name))
            ) return;
        } finally {
            if (externalEventsAbortRef.current === controller) {
                externalEventsAbortRef.current = null;
            }
        }
    }, []);

    const fetchPages = useCallback(async () => {
        setLoading(true);
        try {
            const timeout = 120000;
            const signal = AbortSignal.timeout(timeout);
            const [pagesRes, integrationsRes, tablesRes] = await Promise.allSettled([
                fetchVaultPages({ only_calendar: true }, signal),
                fetchIntegrations(signal),
                fetchVaultTables(undefined, signal),
            ]);

            if (pagesRes.status !== 'fulfilled') throw pagesRes.reason;

            const integrationsData = integrationsRes.status === 'fulfilled'
                ? calendarSettings(integrationsRes.value) : null;
            const hasIntegrations = integrationsData !== null;
            const safeIntegrations: CalendarSettings = integrationsData || {};
            setIntegrations(safeIntegrations);

            const enabledTableIds = safeIntegrations.vault_calendar?.enabled_tables || [];
            const allTables = tablesRes.status === 'fulfilled' ? tablesRes.value : [];
            const tables = allTables
                .filter(tbl => !hasIntegrations || enabledTableIds.includes(textValue(tbl.id)))
                .map(tbl => ({ id: textValue(tbl.id), name: textValue(tbl.name), type: 'table' as const }));
            setEnabledTables(tables);

            const allData = pagesRes.value.map(calendarEntry);
            const dated: CalendarEntry[] = [];
            const undated: CalendarEntry[] = [];

            allData.forEach(page => {
                const tableId = page.resolved_table_id || page.metadata.table_id || page.metadata.database_table_id;
                if (tableId && hasIntegrations && !enabledTableIds.includes(tableId)) return;

                const hasDate = page.metadata.date;
                const source = (page.metadata.source || '').trim();
                // Exclude events from external providers (now they come from the hybrid API)
                if (source && source !== 'Gnosi' && source !== 'Gnosi Vault') return;

                if (hasDate) {
                    dated.push(page);
                } else {
                    const path = page.path || page.abs_path || '';
                    if (path.includes('/Calendar/') || path.includes('\\Calendar\\')) {
                        undated.push(page);
                    }
                }
            });

            setPages(dated);
            setUndatedNotes(undated);
            setPartialData(integrationsRes.status !== 'fulfilled' || tablesRes.status !== 'fulfilled');

            if (integrationsRes.status !== 'fulfilled' || tablesRes.status !== 'fulfilled') {
                toast.error(t('calendar.partial_data_warning'));
            }
        } catch {
            toast.error(t('calendar.error_loading_pages'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    const loadInitial = useEffectEvent(() => { void fetchPages(); });
    useEffect(() => {
        let active = true;
        queueMicrotask(() => { if (active) loadInitial(); });
        return () => { active = false; };
    }, []);

    // Abort the external events request if the component unmounts.
    useEffect(() => {
        return () => {
            if (externalEventsAbortRef.current) {
                externalEventsAbortRef.current.abort();
                externalEventsAbortRef.current = null;
            }
        };
    }, []);

    // Re-fetch external events when the date range or the search changes
    useEffect(() => {
        let active = true;
        queueMicrotask(() => { if (active && dateRange) void fetchExternalEvents(dateRange.start, dateRange.end, searchQuery); });
        return () => { active = false; };
    }, [dateRange, searchQuery, fetchExternalEvents]);


    const toggleCalendar = (source: string) => {
        const next = new Set(selectedCalendars);
        if (next.has(source)) next.delete(source); else next.add(source);
        setSelectedCalendars(next);
        savedCalendarSelectionRef.current = new Set(next);
        void updateCalendarSelection({ selection: [...next] }).catch(() => {});
    };
    const renameCalendar = async (source: string, name: string) => {
        const aliases = Object.fromEntries(Object.entries(integrations.calendar_aliases ?? {}).filter(([key]) => key !== source));
        if (name.trim()) aliases[source] = name.trim();
        try {
            await updateCalendarAliases(aliases);
            setIntegrations({ ...integrations, calendar_aliases: aliases });
            toast.success(t('calendar.calendar_renamed_success'));
        } catch { toast.error(t('calendar.calendar_rename_error')); }
    };
    const updateColor = async (source: string, color: string) => {
        const colors = { ...integrations.calendar_colors, [source]: color };
        try {
            await updateCalendarColors(colors);
            setIntegrations({ ...integrations, calendar_colors: colors });
            toast.success(t('calendar.calendar_color_updated_success'));
        } catch { toast.error(t('calendar.calendar_color_update_error')); }
    };
    const setDefaultCalendar = async (source: string) => {
        try { await updateDefaultCalendar(source); setIntegrations((previous) => ({ ...previous, default_calendar: source })); } catch { /* Selection remains usable offline. */ }
    };
    return { pages, setPages, externalEvents, setExternalEvents, undatedNotes, loading, integrations, calendarConfigs, defaultCalendarId, colorMap, selectedCalendars, toggleCalendar, renameCalendar, updateColor, setDefaultCalendar, fetchPages, fetchExternalEvents };
}
