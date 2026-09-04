import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  dismissMeetingReminder,
  fetchCalendarEvents,
  fetchCalendarList,
  fetchMeetingReminderSettings,
  fetchMeetingReminders,
  updateMeetingReminderSettings,
  type CalendarEventsQuery,
} from './calendar';


export const calendarQueryKeys = {
  all: ['calendar'] as const,
  calendars: (email?: string) => ['calendar', 'calendars', email ?? ''] as const,
  events: (query: CalendarEventsQuery) => ['calendar', 'events', query] as const,
  reminders: ['calendar', 'reminders'] as const,
  reminderSettings: ['calendar', 'reminder-settings'] as const,
};


export function useCalendarList(email?: string) {
  return useQuery({
    queryFn: () => fetchCalendarList(email),
    queryKey: calendarQueryKeys.calendars(email),
  });
}


export function useCalendarEvents(query: CalendarEventsQuery, enabled = true) {
  return useQuery({
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchCalendarEvents(query, signal),
    queryKey: calendarQueryKeys.events(query),
    staleTime: 30_000,
  });
}


export function useMeetingReminders(refetchInterval = 30_000) {
  return useQuery({
    queryFn: fetchMeetingReminders,
    queryKey: calendarQueryKeys.reminders,
    refetchInterval,
  });
}


export function useMeetingReminderSettings(enabled = true) {
  return useQuery({
    enabled,
    queryFn: fetchMeetingReminderSettings,
    queryKey: calendarQueryKeys.reminderSettings,
  });
}


export function useDismissMeetingReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: dismissMeetingReminder,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: calendarQueryKeys.reminders });
    },
  });
}


export function useUpdateMeetingReminderSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMeetingReminderSettings,
    onSuccess: async (settings) => {
      queryClient.setQueryData(calendarQueryKeys.reminderSettings, settings);
      await queryClient.invalidateQueries({ queryKey: calendarQueryKeys.reminders });
    },
  });
}
