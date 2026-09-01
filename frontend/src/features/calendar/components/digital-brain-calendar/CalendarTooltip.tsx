import { AlignLeft, Bell, Clock, MapPin, Navigation, Users } from 'lucide-react';
import type { CalendarHoveredEvent } from './calendarTypes';
import type { DigitalBrainCalendarController } from './useDigitalBrainCalendar';

interface Props {
  readonly event: CalendarHoveredEvent;
  readonly language: string;
  readonly t: DigitalBrainCalendarController['t'];
}

function reminderLabel(value: string): string {
  const minutes = Number.parseInt(value);
  if (minutes % 1440 === 0) return `${String(minutes / 1440)} d`;
  if (minutes % 60 === 0) return `${String(minutes / 60)} h`;
  return `${String(minutes)} min`;
}

export function CalendarTooltip({ event, language, t }: Props) {
  const time = (date: Date | null): string => date?.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' }) ?? '';
  return (
    <div className="fixed z-[var(--z-popover)] pointer-events-none transition-all duration-200 flex flex-col"
      style={{ left: Math.min(event.x + 15, window.innerWidth - 340), top: event.y, width: '320px',
        transform: event.y > window.innerHeight / 2 ? 'translateY(-105%)' : 'translateY(15px)' }}>
      <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl overflow-hidden backdrop-blur-2xl bg-opacity-95 dark:bg-opacity-90 max-h-[70vh] flex flex-col border-opacity-50">
        <div className="h-1.5 w-full shrink-0" style={{ backgroundColor: event.color || 'var(--gnosi-primary)' }} />
        <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar">
          <h4 className="font-bold text-[0.9rem] text-[var(--text-primary)] leading-snug">{event.title}</h4>
          <div className="space-y-3 text-[0.8rem]">
            <div className="flex items-center text-[var(--text-secondary)]">
              <Clock className="w-4 h-4 mr-3 opacity-70 shrink-0" />
              <span>{event.allDay ? t('calendar.all_day', 'All day') : `${time(event.start)}${event.end ? ' - ' + time(event.end) : ''}`}</span>
            </div>
            {event.location && <div className="flex items-start text-[var(--text-secondary)]">
              <MapPin className="w-4 h-4 mr-3 opacity-70 shrink-0 mt-0.5" /><span className="leading-relaxed break-words">{event.location}</span>
            </div>}
            {event.travelTime && <div className="flex items-center text-[var(--text-secondary)]">
              <Navigation className="w-4 h-4 mr-3 opacity-70 shrink-0" /><span>{t('calendar.travel_time', 'Travel time')}: {event.travelTime} min</span>
            </div>}
            {event.reminder && <div className="flex items-center text-[var(--text-secondary)]">
              <Bell className="w-4 h-4 mr-3 opacity-70 shrink-0" /><span>{t('calendar.reminder_before', 'Reminder {{value}} before', { value: reminderLabel(event.reminder) })}</span>
            </div>}
            {event.attendees.length > 0 && <div className="flex items-start text-[var(--text-secondary)]">
              <Users className="w-4 h-4 mr-3 opacity-70 shrink-0 mt-0.5" />
              <span className="leading-relaxed break-words">{event.attendees.slice(0, 5).join(', ')}{event.attendees.length > 5 ? ` +${String(event.attendees.length - 5)}` : ''}</span>
            </div>}
            {event.description && <div className="flex items-start text-[var(--text-tertiary)] pt-3 border-t border-[var(--border-primary)] border-opacity-30 mt-2">
              <AlignLeft className="w-4 h-4 mr-3 mt-1 opacity-70 shrink-0" /><div className="leading-relaxed italic whitespace-pre-wrap break-words opacity-90">{event.description}</div>
            </div>}
          </div>
        </div>
      </div>
    </div>
  );
}
