import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../../shared/notifications/toast';
import { useQueryClient } from '@tanstack/react-query';
import type { CalendarEvent, CalendarEventsQuery } from '../../../shared/api/calendar';
import { getActiveVaultId } from '../../../shared/api/vault-context';
import { updateCalendarAliases, updateCalendarColors, updateCalendarSelection, updateDefaultCalendar } from '../../../shared/api/integrations';
import { calendarQueryKeys, useCalendarEvents, useCalendarList } from '../../../shared/api/useCalendarData';
import type { CalendarEntry } from '../components/calendar-sidebar-right/calendarTypes';
import { availableCalendarSources, calendarConfigsFor, hybridCalendarEntry, type CalendarSettings } from './calendarPageModel';

import { useCalendarLocalSources } from './useCalendarLocalSources';

const NO_EVENTS: CalendarEntry[] = [];
const NO_SELECTION = new Set<string>();

export function useCalendarSources(searchQuery: string, dateRange: { start: string; end: string } | null) {
    const { t } = useTranslation();
    const vaultId = getActiveVaultId();
    const client = useQueryClient();
    const local = useCalendarLocalSources(vaultId);
    const { pages, setPages, integrations, setIntegrations, enabledTables, undatedNotes, loading, refreshing, localSourcesError, fetchPages } = local;
    const [externalSnapshot, setExternalSnapshot] = useState<{ vaultId: string; data: CalendarEvent[] | undefined; events: CalendarEntry[] } | null>(null);
    const [selection, setSelection] = useState<{ vaultId: string; values: Set<string> } | null>(null);
    const selectedCalendars = selection?.vaultId === vaultId ? selection.values : NO_SELECTION;
    const setSelectedCalendars = useCallback((update: SetStateAction<Set<string>>) => {
        setSelection(previous => {
            const values = previous?.vaultId === vaultId ? previous.values : NO_SELECTION;
            return { vaultId, values: typeof update === 'function' ? update(values) : update };
        });
    }, [vaultId]);
    const savedCalendarSelectionRef = useRef<{ vaultId: string; value: Set<string> | null | undefined; settings: CalendarSettings | null; manual: boolean }>({ vaultId, value: undefined, settings: null, manual: false });
    const calendarListQuery = useCalendarList();
    const externalEventsQueryInput = useMemo<CalendarEventsQuery>(() => ({
        includeVault: false,
        search: searchQuery || undefined,
        timeMax: dateRange?.end,
        timeMin: dateRange?.start,
    }), [dateRange?.end, dateRange?.start, searchQuery]);
    const externalEventsQuery = useCalendarEvents(externalEventsQueryInput, dateRange !== null);
    const receivedExternalEvents = useMemo(() => externalEventsQuery.data?.map(hybridCalendarEntry), [externalEventsQuery.data]);
    // Use a completed query synchronously on remount. The editable snapshot only
    // overrides that exact response, and can never bridge two vaults.
    const externalEvents = externalSnapshot?.vaultId === vaultId
        && (externalSnapshot.data === externalEventsQuery.data || !externalEventsQuery.data)
        ? externalSnapshot.events : receivedExternalEvents ?? NO_EVENTS;
    const setExternalEvents = useCallback((update: SetStateAction<CalendarEntry[]>) => {
        void client.invalidateQueries({ queryKey: [...calendarQueryKeys.vault(vaultId), 'events'], refetchType: 'none' });
        if (getActiveVaultId() !== vaultId) return;
        setExternalSnapshot(previous => {
            const events = previous?.vaultId === vaultId
                && (previous.data === externalEventsQuery.data || !externalEventsQuery.data)
                ? previous.events : receivedExternalEvents ?? NO_EVENTS;
            return { vaultId, data: externalEventsQuery.data, events: typeof update === 'function' ? update(events) : update };
        });
    }, [client, externalEventsQuery.data, receivedExternalEvents, vaultId]);
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
        if (savedCalendarSelectionRef.current.vaultId !== vaultId) {
            savedCalendarSelectionRef.current = { vaultId, value: undefined, settings: null, manual: false };
        }
        if (calendarConfigs.length === 0) return;
        // Early external results must not select calendars before the saved
        // visibility settings arrive. Failed local reads retain the fallback.
        if (loading && savedCalendarSelectionRef.current.value === undefined) return;

        // Reconcile refreshed saved settings, unless the user has made an
        // explicit selection in this mounted calendar.
        const restoreSettings = !savedCalendarSelectionRef.current.manual
            && savedCalendarSelectionRef.current.settings !== integrations;
        if (restoreSettings) {
            savedCalendarSelectionRef.current.settings = integrations;
            const raw = integrations.calendar_selection;
            if (Array.isArray(raw) && raw.length > 0) {
                savedCalendarSelectionRef.current.value = new Set(raw);
            } else if (!Array.isArray(raw) && raw?.selection && raw.selection.length > 0) {
                savedCalendarSelectionRef.current.value = new Set(raw.selection);
            } else {
                savedCalendarSelectionRef.current.value = null; // null = no saved selection → show everything
            }
        }

        const savedSet = savedCalendarSelectionRef.current.value;

        // Add sources that should be selected but aren't yet
        setSelectedCalendars(prev => {
            const next = restoreSettings ? new Set<string>() : new Set(prev);
            const additions: string[] = [];
            calendarConfigs.forEach(cfg => {
                if (!next.has(cfg.source)) {
                    const inheritedFromAccount = cfg.account !== null
                        && Boolean(savedSet?.has(cfg.account));
                    // Add if: there's no saved selection (show everything) or it was in the saved selection
                    if (savedSet === null || savedSet === undefined || savedSet.has(cfg.source) || inheritedFromAccount) {
                        next.add(cfg.source);
                        additions.push(cfg.source);
                    }
                    // If it was explicitly hidden (not in savedSet) → don't add
                }
            });
            return additions.length || restoreSettings ? next : prev;
        });
        });
        return () => { active = false; };
    }, [calendarConfigs, integrations, loading, setSelectedCalendars, vaultId]);


    const rememberExternalEvents = useEffectEvent(() => {
        if (!externalEventsQuery.data || externalEventsQuery.isPlaceholderData || !receivedExternalEvents) return;
        setExternalSnapshot(previous => previous?.vaultId === vaultId && previous.data === externalEventsQuery.data
            ? previous : { vaultId, data: externalEventsQuery.data, events: receivedExternalEvents });
    });
    useEffect(() => {
        let active = true;
        queueMicrotask(() => { if (active) rememberExternalEvents(); });
        return () => { active = false; };
    }, [externalEventsQuery.data, externalEventsQuery.isPlaceholderData, vaultId]);

    const refetchExternalEvents = externalEventsQuery.refetch;
    const fetchExternalEvents = useCallback(async () => {
        await refetchExternalEvents({ cancelRefetch: true });
    }, [refetchExternalEvents]);

    const toggleCalendar = (source: string) => {
        const next = new Set(selectedCalendars);
        if (next.has(source)) next.delete(source); else next.add(source);
        setSelectedCalendars(next);
        savedCalendarSelectionRef.current = { vaultId, value: new Set(next), settings: integrations, manual: true };
        void updateCalendarSelection({ selection: [...next] }).then(() => {
            setIntegrations(previous => ({ ...previous, calendar_selection: [...next] }));
        }).catch(() => {});
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
    const externalEventsLoading = dateRange !== null
        && externalEventsQuery.isFetching
        && !externalEventsQuery.data && externalEvents.length === 0;
    const externalEventsRefreshing = dateRange !== null && externalEventsQuery.isFetching && !externalEventsLoading;
    const externalSourcesUpdating = calendarListQuery.isFetching || (dateRange !== null && externalEventsQuery.isFetching);
    const externalEventsError = externalEventsQuery.isError;
    return { pages, setPages, externalEvents, setExternalEvents, undatedNotes, loading, refreshing, localSourcesError, externalEventsLoading, externalEventsRefreshing, externalSourcesUpdating, externalEventsError, integrations, calendarConfigs, defaultCalendarId, colorMap, selectedCalendars, toggleCalendar, renameCalendar, updateColor, setDefaultCalendar, fetchPages, fetchExternalEvents };
}
