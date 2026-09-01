import { CalendarPageHeader } from './page/CalendarPageHeader';
import { CalendarPageWorkspace } from './page/CalendarPageWorkspace';
import { CalendarPageDialogs } from './page/CalendarPageDialogs';
import { useCalendarPage } from './page/useCalendarPage';

export default function CalendarPage() {
    const controller = useCalendarPage();
    return <div className="h-full bg-[var(--bg-primary)] overflow-hidden flex flex-col">
        <CalendarPageHeader controller={controller} />
        <CalendarPageWorkspace controller={controller} />
        <CalendarPageDialogs controller={controller} />
    </div>;
}
