import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { getActiveVaultId } from './vault-context';

import {
  dismissMeetingReminder,
  fetchCalendarEvents,
  fetchCalendarList,
  fetchMeetingReminderSettings,
  fetchMeetingReminders,
  updateMeetingReminderSettings,
  type CalendarEvent,
  type CalendarEventsQuery,
} from './calendar';

function readForVault<T>(vaultId: string, read: () => Promise<T>): Promise<T> {
  if (getActiveVaultId() !== vaultId) {
    return Promise.reject(new DOMException('The active vault changed', 'AbortError'));
  }
  return read();
}

export const calendarQueryKeys = {
  all: ['calendar'] as const,
  vault: (vaultId = getActiveVaultId()) => ['calendar', vaultId] as const,
  calendars: (email?: string, vaultId = getActiveVaultId()) => ['calendar', vaultId, 'calendars', email ?? ''] as const,
  events: (query: CalendarEventsQuery, vaultId = getActiveVaultId()) => ['calendar', vaultId, 'events', query] as const,
  localSources: (vaultId = getActiveVaultId()) => ['calendar', vaultId, 'local-sources'] as const,
  reminders: (vaultId = getActiveVaultId()) => ['calendar', vaultId, 'reminders'] as const,
  reminderSettings: (vaultId = getActiveVaultId()) => ['calendar', vaultId, 'reminder-settings'] as const,
};


export function useCalendarList(email?: string) {
  const vaultId = getActiveVaultId();
  return useQuery({
    queryFn: () => readForVault(vaultId, () => fetchCalendarList(email)),
    queryKey: calendarQueryKeys.calendars(email, vaultId),
  });
}


export function useCalendarEvents(query: CalendarEventsQuery, enabled = true) {
  const vaultId = getActiveVaultId();
  return useQuery<CalendarEvent[]>({
    enabled,
    placeholderData: (data, previousQuery) => (
      previousQuery?.queryKey[1] === vaultId ? data : undefined
    ),
    queryFn: ({ signal }) => readForVault(vaultId, () => fetchCalendarEvents(query, signal)),
    queryKey: calendarQueryKeys.events(query, vaultId),
    staleTime: 30_000,
  });
}


export function useMeetingReminders(refetchInterval = 30_000) {
  const vaultId = getActiveVaultId();
  return useQuery({
    queryFn: () => readForVault(vaultId, fetchMeetingReminders),
    queryKey: calendarQueryKeys.reminders(vaultId),
    refetchInterval,
  });
}


export function useMeetingReminderSettings(enabled = true) {
  const vaultId = getActiveVaultId();
  return useQuery({
    enabled,
    queryFn: () => readForVault(vaultId, fetchMeetingReminderSettings),
    queryKey: calendarQueryKeys.reminderSettings(vaultId),
  });
}


export function useDismissMeetingReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: dismissMeetingReminder,
    onMutate: () => ({ vaultId: getActiveVaultId() }),
    onSuccess: async (_result, _variables, context) => {
      await queryClient.invalidateQueries({ queryKey: calendarQueryKeys.reminders(context.vaultId) });
    },
  });
}


export function useUpdateMeetingReminderSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMeetingReminderSettings,
    onMutate: () => ({ vaultId: getActiveVaultId() }),
    onSuccess: async (settings, _variables, context) => {
      queryClient.setQueryData(calendarQueryKeys.reminderSettings(context.vaultId), settings);
      await queryClient.invalidateQueries({ queryKey: calendarQueryKeys.reminders(context.vaultId) });
    },
  });
}
