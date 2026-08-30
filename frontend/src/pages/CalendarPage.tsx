import { CalendarPageHeader } from './calendar-page/CalendarPageHeader';
import { CalendarPageWorkspace } from './calendar-page/CalendarPageWorkspace';
import { CalendarPageDialogs } from './calendar-page/CalendarPageDialogs';
import { useCalendarPage } from './calendar-page/useCalendarPage';

export default function CalendarPage() {
    const controller = useCalendarPage();
    return <div className="h-full bg-[var(--bg-primary)] overflow-hidden flex flex-col">
        <CalendarPageHeader controller={controller} />
        <CalendarPageWorkspace controller={controller} />
        <CalendarPageDialogs controller={controller} />
    </div>;
}
