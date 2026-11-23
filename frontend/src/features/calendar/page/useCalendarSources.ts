import { useCallback, useEffect, useEffectEvent, useMemo, useState, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../../shared/notifications/toast';
import { useQueryClient } from '@tanstack/react-query';
import type { CalendarEvent, CalendarEventsQuery } from '../../../shared/api/calendar';
import { getActiveVaultId } from '../../../shared/api/vault-context';
import { updateCalendarAliases, updateCalendarColors, updateDefaultCalendar } from '../../../shared/api/integrations';
import { calendarQueryKeys, useCalendarEvents, useCalendarList } from '../../../shared/api/useCalendarData';
import type { CalendarEntry } from '../components/calendar-sidebar-right/calendarTypes';
import { availableCalendarSources, calendarConfigsFor, hybridCalendarEntry } from './calendarPageModel';

import { useCalendarLocalSources } from './useCalendarLocalSources';
import { useCalendarVisibility } from './useCalendarVisibility';

const NO_EVENTS: CalendarEntry[] = [];

export function useCalendarSources(searchQuery: string, dateRange: { start: string; end: string } | null,
    { notifyErrors = true, expandInstances = false }: { notifyErrors?: boolean; expandInstances?: boolean } = {}) {
    const { t } = useTranslation();
    const vaultId = getActiveVaultId();
    const client = useQueryClient();
    const local = useCalendarLocalSources(vaultId, notifyErrors);
    const { pages, setPages, integrations, setIntegrations, enabledTables, undatedNotes, loading, refreshing, localSourcesError, fetchPages } = local;
    const [externalSnapshot, setExternalSnapshot] = useState<{ vaultId: string; data: CalendarEvent[] | undefined; events: CalendarEntry[] } | null>(null);
    const calendarListQuery = useCalendarList();
    const externalEventsQueryInput = useMemo<CalendarEventsQuery>(() => ({
        includeVault: false,
        ...(expandInstances ? { expandInstances: true } : {}),
        search: searchQuery || undefined,
        timeMax: dateRange?.end,
        timeMin: dateRange?.start,
    }), [dateRange?.end, dateRange?.start, expandInstances, searchQuery]);
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
    const { selectedCalendars, toggleCalendar } = useCalendarVisibility(vaultId, calendarConfigs, local);

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
    return { pages, setPages, externalEvents, setExternalEvents, undatedNotes, loading, refreshing, localSourcesError,
        settingsAvailable: local.settingsAvailable, calendarListPending: calendarListQuery.isPending,
        calendarListError: calendarListQuery.isError || Boolean(calendarListQuery.data?.authError),
        fetchCalendarList: calendarListQuery.refetch,
        externalRangePending: externalEventsQuery.isPending || externalEventsQuery.isPlaceholderData,
        externalEventsLoading, externalEventsRefreshing, externalSourcesUpdating, externalEventsError, integrations, calendarConfigs,
        defaultCalendarId, colorMap, selectedCalendars, toggleCalendar, renameCalendar, updateColor, setDefaultCalendar, fetchPages, fetchExternalEvents };
}
