import type { EventContentArg } from '@fullcalendar/core';
import { calendarEventAppearance } from './calendarEventModel';

export function CalendarEventContent({ event, timeText }: EventContentArg) {
  const { allDay, past } = calendarEventAppearance(event);
  const color = event.backgroundColor || event.borderColor;
  return (
    <div className="fc-event-main-frame flex items-center px-1.5 overflow-hidden h-full rounded border-l-[4px] border-l-current shadow-sm"
      style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)',
        borderLeftColor: color || 'var(--gnosi-action-bg)', minHeight: '1.4rem', fontWeight: past ? '600' : '800' }}>
      {!allDay && <div className="fc-event-time flex-shrink-0 text-[0.65rem] font-black mr-1.5 text-[var(--text-secondary)]">{timeText}</div>}
      <div className="fc-event-title flex-grow truncate text-[0.725rem] py-0.5 tracking-tight">{event.title}</div>
    </div>
  );
}
