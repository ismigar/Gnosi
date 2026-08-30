import type { RefObject } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import rrulePlugin from '@fullcalendar/rrule';
import multiMonthPlugin from '@fullcalendar/multimonth';
import caLocale from '@fullcalendar/core/locales/ca';
import esLocale from '@fullcalendar/core/locales/es';
import { CalendarEventContent } from './CalendarEventContent';
import type { DigitalBrainCalendarController } from './useDigitalBrainCalendar';

const PLUGINS = [dayGridPlugin, timeGridPlugin, interactionPlugin, rrulePlugin, multiMonthPlugin];
const LOCALES = [caLocale, esLocale];
const TIME_FORMAT = { hour: '2-digit', minute: '2-digit', meridiem: false, hour12: false } as const;
const VIEWS = { multiMonthYear: { multiMonthMinWidth: 150, multiMonthMaxColumns: 4,
  fixedWeekCount: false, showNonCurrentDates: false, eventDisplay: 'none' } };

interface Props {
  readonly calendarRef: RefObject<FullCalendar | null>;
  readonly controller: DigitalBrainCalendarController;
}

export function CalendarCanvas({ calendarRef, controller: c }: Props) {
  return <div className={`calendar-container flex-1 ${c.showHeaderToolbar ? 'min-h-[34rem]' : ''}`}>
    <FullCalendar ref={calendarRef} plugins={PLUGINS} initialView={c.initialView}
      eventDisplay="block" fixedWeekCount={false} multiMonthMaxColumns={4} views={VIEWS}
      headerToolbar={false} dayMaxEvents={4}
      moreLinkContent={(arg) => `+ ${arg.shortText} ${c.t('calendar.more_suffix', 'more')}`}
      locales={LOCALES} locale={c.language} events={c.events}
      editable droppable selectable eventResizableFromStart={false}
      eventClick={c.handleEventClick} eventMouseEnter={c.handleEventMouseEnter}
      eventMouseLeave={c.handleEventMouseLeave} eventDidMount={c.handleEventDidMount}
      eventDrop={(info) => { c.handleChange(info, 'move'); }}
      eventResize={(info) => { c.handleChange(info, 'resize'); }}
      height={c.showHeaderToolbar ? 'auto' : '100%'}
      eventTimeFormat={TIME_FORMAT} slotLabelFormat={TIME_FORMAT}
      eventClassNames={c.eventClassNames} eventContent={CalendarEventContent}
      dateClick={c.handleDateClick} datesSet={c.handleDatesSet}
      select={(info) => { c.props.onSelection?.({ start: info.start, end: info.end,
        allDay: info.allDay, startStr: info.startStr, endStr: info.endStr }); }}
    />
  </div>;
}
