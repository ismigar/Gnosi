import type { RefObject } from 'react';
import type FullCalendar from '@fullcalendar/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DigitalBrainCalendarController } from './useDigitalBrainCalendar';

const VIEWS = [
  { id: 'multiMonthYear', labelKey: 'calendar.view_year', fallback: 'Any' },
  { id: 'dayGridMonth', labelKey: 'calendar.view_month', fallback: 'Mes' },
  { id: 'timeGridWeek', labelKey: 'calendar.view_week', fallback: 'Setmana' },
  { id: 'timeGridDay', labelKey: 'calendar.view_day', fallback: 'Dia' },
];

interface Props {
  readonly calendarRef: RefObject<FullCalendar | null>;
  readonly toolbar: DigitalBrainCalendarController['toolbar'];
  readonly t: DigitalBrainCalendarController['t'];
}

/** Keep navigation outside FullCalendar: its native toolbar caused custom-rendering loops. */
export function CalendarToolbar({ calendarRef, toolbar, t }: Props) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-primary)]">
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => { calendarRef.current?.getApi().prev(); }}
          className="p-1.5 rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
          title={t('calendar.prev', 'Previous')}><ChevronLeft size={14} /></button>
        <button type="button" onClick={() => { calendarRef.current?.getApi().next(); }}
          className="p-1.5 rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
          title={t('calendar.next', 'Next')}><ChevronRight size={14} /></button>
        <button type="button" onClick={() => { calendarRef.current?.getApi().today(); }}
          className="ml-1 px-2.5 py-1 rounded-md border border-[var(--border-primary)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors">
          {t('calendar.today', 'Today')}
        </button>
      </div>
      <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{toolbar.title}</div>
      <div className="flex bg-[var(--bg-tertiary)] p-0.5 rounded-lg border border-[var(--border-primary)]">
        {VIEWS.map((view) => <button key={view.id} type="button"
          onClick={() => { calendarRef.current?.getApi().changeView(view.id); }}
          className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all ${toolbar.view === view.id
            ? 'bg-[var(--bg-primary)] text-[var(--gnosi-primary)] shadow-sm'
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}>
          {t(view.labelKey, view.fallback)}
        </button>)}
      </div>
    </div>
  );
}
