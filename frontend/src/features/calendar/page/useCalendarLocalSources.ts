import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fetchIntegrations } from '../../../shared/api/integrations';
import { fetchVaultPages, fetchVaultTables } from '../../../shared/api/vaults';
import { calendarQueryKeys } from '../../../shared/api/useCalendarData';
import { getActiveVaultId } from '../../../shared/api/vault-context';
import { toast } from '../../../shared/notifications/toast';
import { calendarEntry, textValue } from '../components/calendar-sidebar-right/calendarBoundary';
import type { CalendarEntry } from '../components/calendar-sidebar-right/calendarTypes';
import { calendarSettings, type CalendarSettings, type EnabledTable } from './calendarPageModel';

interface CalendarLocalSources {
    pages: CalendarEntry[];
    undatedNotes: CalendarEntry[];
    integrations: CalendarSettings;
    enabledTables: EnabledTable[];
}

const EMPTY_SOURCES: CalendarLocalSources = {
    pages: [], undatedNotes: [], integrations: {}, enabledTables: [],
};

class PartialCalendarSources extends Error {
    constructor(readonly sources: CalendarLocalSources) {
        super('Calendar sources are incomplete');
    }
}

async function readLocalSources(querySignal: AbortSignal): Promise<CalendarLocalSources> {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => {
        controller.abort(new DOMException('Calendar sources read timed out', 'TimeoutError'));
    }, 120_000);
    const abortFromCaller = () => {
        globalThis.clearTimeout(timer);
        controller.abort(querySignal.reason);
    };
    if (querySignal.aborted) abortFromCaller();
    else querySignal.addEventListener('abort', abortFromCaller, { once: true });
    try {
        controller.signal.throwIfAborted();
        return await readLocalSourcesWithSignal(controller.signal);
    } finally {
        globalThis.clearTimeout(timer);
        querySignal.removeEventListener('abort', abortFromCaller);
    }
}

async function readLocalSourcesWithSignal(signal: AbortSignal): Promise<CalendarLocalSources> {
    const [pagesResult, settingsResult, tablesResult] = await Promise.allSettled([
        fetchVaultPages({ only_calendar: true }, signal),
        fetchIntegrations(signal),
        fetchVaultTables(undefined, signal),
    ]);
    signal.throwIfAborted();
    if (pagesResult.status !== 'fulfilled') throw pagesResult.reason;
    const settings = settingsResult.status === 'fulfilled' ? calendarSettings(settingsResult.value) : null;
    const integrations = settings ?? {};
    const enabledTableIds = integrations.vault_calendar?.enabled_tables ?? [];
    const enabledTables: EnabledTable[] = (tablesResult.status === 'fulfilled' ? tablesResult.value : [])
        .filter(table => settings === null || enabledTableIds.includes(textValue(table.id)))
        .map(table => ({ id: textValue(table.id), name: textValue(table.name), type: 'table' }));
    const pages: CalendarEntry[] = [];
    const undatedNotes: CalendarEntry[] = [];
    for (const raw of pagesResult.value) {
        const page = calendarEntry(raw);
        const tableId = page.resolved_table_id || page.metadata.table_id || page.metadata.database_table_id;
        if (tableId && settings !== null && !enabledTableIds.includes(tableId)) continue;
        const source = (page.metadata.source ?? '').trim();
        if (source && source !== 'Gnosi' && source !== 'Gnosi Vault') continue;
        if (page.metadata.date) pages.push(page);
        else {
            const path = page.path || page.abs_path || '';
            if (path.includes('/Calendar/') || path.includes('\\Calendar\\')) undatedNotes.push(page);
        }
    }
    const snapshot = { pages, undatedNotes, integrations, enabledTables };
    // A query error retains the last successful snapshot. On a first partial
    // read the useful pages remain available through the error, never as success.
    if (settingsResult.status !== 'fulfilled' || tablesResult.status !== 'fulfilled') {
        throw new PartialCalendarSources(snapshot);
    }
    return snapshot;
}

export function useCalendarLocalSources(vaultId: string) {
    const { t } = useTranslation();
    const client = useQueryClient();
    const query = useQuery({
        queryKey: calendarQueryKeys.localSources(vaultId),
        queryFn: ({ signal }) => {
            if (getActiveVaultId() !== vaultId) throw new DOMException('The active vault changed', 'AbortError');
            return readLocalSources(signal);
        },
        staleTime: 0,
        retry: false,
    });
    const source = query.data ?? (query.error instanceof PartialCalendarSources ? query.error.sources : EMPTY_SOURCES);
    const [partialEdit, setPartialEdit] = useState<{ vaultId: string; source: CalendarLocalSources; value: CalendarLocalSources } | null>(null);
    const snapshot = partialEdit?.vaultId === vaultId && partialEdit.source === source ? partialEdit.value : source;
    const hasData = source !== EMPTY_SOURCES;
    useEffect(() => {
        if (!query.error) return;
        toast.error(t(query.error instanceof PartialCalendarSources ? 'calendar.partial_data_warning' : 'calendar.error_loading_pages'));
    }, [query.error, t]);

    const updateSnapshot = useCallback((update: (previous: CalendarLocalSources) => CalendarLocalSources) => {
        // Late mutation callbacks belong to their original vault. Updating its
        // successful cache is safe; never apply them to the newly active vault.
        const key = calendarQueryKeys.localSources(vaultId);
        if (client.getQueryData<CalendarLocalSources>(key)) {
            client.setQueryData<CalendarLocalSources>(key, previous => previous ? update(previous) : previous);
        } else if (getActiveVaultId() === vaultId) {
            setPartialEdit(previous => ({
                vaultId, source,
                value: update(previous?.vaultId === vaultId && previous.source === source ? previous.value : source),
            }));
        }
    }, [client, source, vaultId]);
    const setPages = useCallback((update: SetStateAction<CalendarEntry[]>) => {
        updateSnapshot(previous => ({ ...previous, pages: typeof update === 'function' ? update(previous.pages) : update }));
    }, [updateSnapshot]);
    const setIntegrations = useCallback((update: SetStateAction<CalendarSettings>) => {
        updateSnapshot(previous => ({ ...previous, integrations: typeof update === 'function' ? update(previous.integrations) : update }));
    }, [updateSnapshot]);
    const refetch = query.refetch;
    const fetchPages = useCallback(async () => { await refetch({ cancelRefetch: true }); }, [refetch]);
    return {
        ...snapshot, setPages, setIntegrations, fetchPages,
        loading: !hasData && query.isPending,
        refreshing: hasData && query.isFetching,
        localSourcesError: query.error !== null,
    };
}
