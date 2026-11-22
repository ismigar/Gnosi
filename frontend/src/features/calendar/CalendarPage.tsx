import { CalendarPageHeader } from './page/CalendarPageHeader';
import { CalendarPageWorkspace } from './page/CalendarPageWorkspace';
import { CalendarPageDialogs } from './page/CalendarPageDialogs';
import { useCalendarPage } from './page/useCalendarPage';
import { useLocation } from 'react-router-dom';
import { useRequestContext } from '../../shared/hooks/useRequestContext';

export default function CalendarPage() {
    const context = useRequestContext();
    const { pathname, search } = useLocation();
    return <CalendarPageContent key={JSON.stringify([context, pathname, search])} />;
}

function CalendarPageContent() {
    const controller = useCalendarPage();
    return <div className="h-full bg-[var(--bg-primary)] overflow-hidden flex flex-col">
        <CalendarPageHeader controller={controller} />
        <CalendarPageWorkspace controller={controller} />
        <CalendarPageDialogs controller={controller} />
    </div>;
}
