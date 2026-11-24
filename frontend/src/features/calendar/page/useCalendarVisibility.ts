import { useMemo, useState } from 'react';
import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { updateCalendarSelection } from '../../../shared/api/integrations';
import { calendarPrincipalKey, calendarQueryKeys } from '../../../shared/api/useCalendarData';
import { getActiveVaultId } from '../../../shared/api/vault-context';
import { toast } from '../../../shared/notifications/toast';
import type { CalendarConfig } from '../components/calendar-sidebar-right/calendarTypes';
import { calendarVisibility, isCalendarVisible, type CalendarVisibility } from './calendarPageModel';
import type { useCalendarLocalSources } from './useCalendarLocalSources';

const SHOW_ALL = calendarVisibility(undefined);

export function useCalendarVisibility(vaultId: string, calendars: CalendarConfig[],
    { integrations, loading, setIntegrations, settingsAvailable }: ReturnType<typeof useCalendarLocalSources>) {
    const { t } = useTranslation();
    const client = useQueryClient();
    const [confirmed, setConfirmed] = useState<{ vaultId: string; preference: CalendarVisibility } | null>(null);
    const principal = calendarPrincipalKey();
    const mutationKey = ['calendar', vaultId, 'visibility', principal];
    const pendingWrites = { mutationKey, exact: true, status: 'pending' as const };
    const pending = useMutationState({ filters: pendingWrites, select: mutation => calendarVisibility(mutation.state.variables) });
    const preference = pending.at(-1) ?? (confirmed?.vaultId === vaultId ? confirmed.preference : integrations.calendar_selection) ?? SHOW_ALL;
    const selectedCalendars = useMemo(() => new Set(loading ? [] : calendars
        .filter(config => isCalendarVisible(preference, config)).map(config => config.source)), [calendars, loading, preference]);

    const save = useMutation({
        mutationKey,
        // Integration settings have a single calendar selection document.
        scope: { id: 'calendar-visibility' },
        mutationFn: (next: CalendarVisibility) => updateCalendarSelection(next),
        onSuccess: (_result, next) => {
            setIntegrations(previous => ({ ...previous, calendar_selection: next }));
            if (getActiveVaultId() === vaultId && calendarPrincipalKey() === principal) setConfirmed({ vaultId, preference: next });
            const queryKey = calendarQueryKeys.localSources(vaultId, principal);
            if (client.isFetching({ queryKey, exact: true })) {
                void client.invalidateQueries({ queryKey, exact: true });
            }
        },
        onError: () => { toast.error(t('calendar.visibility_save_error')); },
    });

    const toggleCalendar = (source: string) => {
        const config = calendars.find(item => item.source === source);
        if (!config || loading) return;
        if (!settingsAvailable) {
            toast.error(t('calendar.visibility_save_error'));
            return;
        }
        // A second click can arrive before React renders the first pending write.
        const latest = client.getMutationCache().findAll(pendingWrites).at(-1);
        const current = latest ? calendarVisibility(latest.state.variables) : preference;
        const visible = isCalendarVisible(current, config);
        save.mutate({
            default_sources: current.default_sources,
            shown_sources: visible ? current.shown_sources.filter(item => item !== source) : [...current.shown_sources, source],
            hidden_sources: visible ? [...current.hidden_sources, source] : current.hidden_sources.filter(item => item !== source),
        });
    };
    return { selectedCalendars, toggleCalendar };
}
