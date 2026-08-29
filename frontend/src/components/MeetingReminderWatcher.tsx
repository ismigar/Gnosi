import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Calendar,
  ChevronDown,
  ChevronRight,
  MapPin,
  Sparkles,
  X,
} from 'lucide-react';

import { vaultPath } from '../lib/vaultRouting';
import type { MeetingReminder } from '../shared/api/calendar';
import {
  useDismissMeetingReminder,
  useMeetingReminders,
} from '../shared/api/useCalendarData';


const POLL_MS = 60_000;


type RenderableReminder = MeetingReminder & { id: string };


function hasReminderId(reminder: MeetingReminder): reminder is RenderableReminder {
  return typeof reminder.id === 'string' && reminder.id.length > 0;
}


/** Render upcoming meeting reminders prepared by the backend. */
export default function MeetingReminderWatcher() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const navigate = useNavigate();
  const remindersQuery = useMeetingReminders(POLL_MS);
  const dismissMutation = useDismissMeetingReminder();
  const reminders = (remindersQuery.data?.reminders ?? [])
    .filter(hasReminderId)
    .filter((reminder) => !dismissedIds.has(reminder.id));

  const dismiss = useCallback(async (id: string): Promise<void> => {
    setDismissedIds((current) => new Set([...current, id]));
    try {
      await dismissMutation.mutateAsync(id);
    } catch {
      // The optimistic local dismissal keeps a stale banner from blocking the UI.
    }
  }, [dismissMutation]);

  if (reminders.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[var(--z-notification)] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {reminders.map((reminder) => {
        const minutes = reminder.minutes_until ?? 0;
        const when = minutes <= 0
          ? t('meeting_reminder.now', 'now')
          : t(
              'meeting_reminder.in_minutes',
              'in {{count}} min',
              { count: minutes },
            );
        const isOpen = expanded[reminder.id] === true;

        return (
          <div
            key={reminder.id}
            className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl"
          >
            <div className="flex items-start gap-2 p-3">
              <Bell size={18} className="mt-0.5 shrink-0 text-violet-500" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-violet-600 dark:text-violet-300">
                  {t(
                    'meeting_reminder.meeting_when',
                    'Meeting {{when}}',
                    { when },
                  )}
                </div>
                <div className="truncate font-medium">{reminder.title}</div>
                {reminder.location && (
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                    <MapPin size={12} />
                    <span className="truncate">{reminder.location}</span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => void dismiss(reminder.id)}
                aria-label={t('common.dismiss')}
                className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
              >
                <X size={16} />
              </button>
            </div>

            {reminder.agenda && (
              <div className="px-3 pb-1">
                <button
                  type="button"
                  onClick={() => {
                    setExpanded((current) => ({
                      ...current,
                      [reminder.id]: !current[reminder.id],
                    }));
                  }}
                  className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  {isOpen
                    ? <ChevronDown size={14} />
                    : <ChevronRight size={14} />}
                  <Sparkles size={12} className="text-violet-500" />
                  {t('meeting_reminder.agenda', 'Agenda')}
                </button>
                {isOpen && (
                  <div className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--bg-secondary)] p-2 text-xs">
                    {reminder.agenda}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 border-t border-[var(--border-color)] px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  void navigate(vaultPath('calendar'));
                  void dismiss(reminder.id);
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
              >
                <Calendar size={14} />
                {t('meeting_reminder.view_in_calendar', 'View in calendar')}
              </button>
              <button
                type="button"
                onClick={() => void dismiss(reminder.id)}
                className="rounded-lg px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
              >
                {t('common.dismiss')}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
