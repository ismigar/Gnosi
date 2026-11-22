import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { getActiveVaultId } from './vault-context';
import { currentRequestContext, type RequestContext } from './request-context';
import { useRequestContext } from '../hooks/useRequestContext';

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

export function calendarPrincipalKey(context: RequestContext = currentRequestContext()): string {
  return JSON.stringify([context.workspaceId, context.userId, context.userEmail]);
}

export const calendarQueryKeys = {
  all: ['calendar'] as const,
  vault: (vaultId = getActiveVaultId()) => ['calendar', vaultId] as const,
  calendars: (email?: string, vaultId = getActiveVaultId(), principal = calendarPrincipalKey()) => ['calendar', vaultId, 'calendars', email ?? '', principal] as const,
  events: (query: CalendarEventsQuery, vaultId = getActiveVaultId(), principal = calendarPrincipalKey()) => ['calendar', vaultId, 'events', query, principal] as const,
  localSources: (vaultId = getActiveVaultId(), principal = calendarPrincipalKey()) => ['calendar', vaultId, 'local-sources', principal] as const,
  reminders: (vaultId = getActiveVaultId()) => ['calendar', vaultId, 'reminders'] as const,
  reminderSettings: (vaultId = getActiveVaultId()) => ['calendar', vaultId, 'reminder-settings'] as const,
};


export function useCalendarList(email?: string) {
  const vaultId = getActiveVaultId();
  const context = useRequestContext();
  return useQuery({
    queryFn: ({ signal }) => readForVault(vaultId, () => fetchCalendarList(email, signal, { ...context, vaultId })),
    queryKey: calendarQueryKeys.calendars(email, vaultId, calendarPrincipalKey(context)),
  });
}


export function useCalendarEvents(query: CalendarEventsQuery, enabled = true) {
  const vaultId = getActiveVaultId();
  const context = useRequestContext();
  const principal = calendarPrincipalKey(context);
  return useQuery<CalendarEvent[]>({
    enabled,
    placeholderData: (data, previousQuery) => (
      previousQuery?.queryKey[1] === vaultId && previousQuery.queryKey[4] === principal ? data : undefined
    ),
    queryFn: ({ signal }) => readForVault(vaultId, () => fetchCalendarEvents(query, signal, { ...context, vaultId })),
    queryKey: calendarQueryKeys.events(query, vaultId, principal),
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
