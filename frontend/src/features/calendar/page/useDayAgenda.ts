import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { buildCalendarEvents } from '../components/digital-brain-calendar/calendarEventModel';
import { appointmentsForDay, localDayRange } from './dayAgenda';
import { useCalendarSources } from './useCalendarSources';

export function useDayAgenda(now: Date) {
    const { t } = useTranslation();
    const { start, end, day } = localDayRange(now);
    const sources = useCalendarSources('', { start, end }, { notifyErrors: false, expandInstances: true });
    const { pages, externalEvents, selectedCalendars, calendarConfigs, colorMap, settingsAvailable } = sources;
    const items = useMemo(() => {
        if (!settingsAvailable) return [];
        return appointmentsForDay(buildCalendarEvents([...pages, ...externalEvents], {
            selectedCalendars, calendarConfigs, colorMap, untitled: t('common.untitled', 'Untitled'),
        }), { start, end, day });
    }, [calendarConfigs, colorMap, day, end, externalEvents, pages, selectedCalendars, settingsAvailable, start, t]);
    return {
        day, items, hasVisibleCalendars: selectedCalendars.size > 0,
        loading: sources.loading || sources.externalRangePending || (!selectedCalendars.size && sources.calendarListPending),
        error: sources.localSourcesError || sources.externalEventsError || sources.calendarListError,
        refresh: () => Promise.all([sources.fetchPages(), sources.fetchExternalEvents(), sources.fetchCalendarList()]),
    };
}
