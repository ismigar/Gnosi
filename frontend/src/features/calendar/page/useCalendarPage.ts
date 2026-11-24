import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type FullCalendar from '@fullcalendar/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMediaQuery } from '../../../shared/hooks/useMediaQuery';
import { usePlugins } from '../../../shared/plugins/usePlugins';
import { toast } from '../../../shared/notifications/toast';
import { useMeetingReminderSettings, useUpdateMeetingReminderSettings } from '../../../shared/api/useCalendarData';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { useCalendarSources } from './useCalendarSources';
import { useCalendarEventActions } from './useCalendarEventActions';
import { useCalendarRecurrence } from './useCalendarRecurrence';
import { readCalendarDayLink } from './calendarDayLink';

export function useCalendarPage() {
    const { t } = useTranslation();
    const { isEnabled } = usePlugins();
    const aiMeetingsEnabled = isEnabled('ai-platform');
    const navigate = useNavigate();
    const location = useLocation();
    const { date: initialDate, eventId, source, instance } = readCalendarDayLink(location.pathname, location.search);
    const isCompact = useMediaQuery('(max-width: 1023px)');
    const calendarRef = useRef<FullCalendar | null>(null);
    const [dateRange, setDateRange] = useState<{start: string; end: string} | null>(null);
    const [currentTitle, setCurrentTitle] = useState('');
    const [activeView, setActiveView] = useState(() => isCompact || initialDate ? 'timeGridDay' : 'dayGridMonth');
    const [searchQuery, setSearchQuery] = useState('');
    const [showLeftSidebar, setShowLeftSidebar] = useState(true);
    const [showRightSidebar, setShowRightSidebar] = useState(false);
    const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
    const [remindersEnabled, setRemindersEnabled] = useState(false);
    const [remindersLead, setRemindersLead] = useState(10);
    const reminderSettingsQuery = useMeetingReminderSettings(aiMeetingsEnabled);
    const updateReminderSettingsMutation = useUpdateMeetingReminderSettings();
    const isDayRange = dateRange !== null && Date.parse(dateRange.end) - Date.parse(dateRange.start) <= 25 * 3_600_000;
    const sources = useCalendarSources(searchQuery, dateRange, { expandInstances: Boolean(initialDate) && isDayRange });
    const actions = useCalendarEventActions(sources, setShowRightSidebar, dateRange);
    const recurrence = useCalendarRecurrence(sources, actions);
    const openedFromLink = useRef(false);
    const openLinkedEvent = useEffectEvent(() => {
        if (!eventId || openedFromLink.current) return;
        const external = sources.externalEvents.some(event => event.id === eventId && (!source || event.metadata.source === source)
            && (!instance || event.metadata.date === instance));
        if (!external && (source || !sources.pages.some(page => page.id === eventId))) return;
        openedFromLink.current = true;
        void actions.handleEventClick(eventId, null, null, { source, instance });
    });
    useEffect(() => {
        let active = true;
        queueMicrotask(() => { if (active) openLinkedEvent(); });
        return () => { active = false; };
    }, [eventId, instance, source, sources.externalEvents, sources.pages]);
    useEffect(() => {
        if (!isCompact) return;
        let active = true;
        queueMicrotask(() => { if (active) { setShowLeftSidebar(false); setShowRightSidebar(false); } });
        return () => { active = false; };
    }, [isCompact]);
    useEffect(() => subscribeWindowEvent('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
            event.preventDefault(); setIsGlobalSearchOpen((open) => !open);
        }
        if (event.key === '.') setShowRightSidebar((open) => !open);
        if (event.key === ',') calendarRef.current?.getApi().today();
    }), []);
    const applyReminders = useEffectEvent(() => {
        const settings = reminderSettingsQuery.data;
        if (!aiMeetingsEnabled || !settings) return;
        setRemindersEnabled(settings.enabled);
        if (settings.lead_minutes) setRemindersLead(settings.lead_minutes);
    });
    useEffect(() => {
        let active = true;
        queueMicrotask(() => { if (active) applyReminders(); });
        return () => { active = false; };
    }, [aiMeetingsEnabled, reminderSettingsQuery.data]);
    const saveReminderSettings = async (patch: {enabled?: boolean; lead_minutes?: number}) => {
        const next = {enabled: patch.enabled ?? remindersEnabled, lead_minutes: patch.lead_minutes ?? remindersLead};
        setRemindersEnabled(next.enabled); setRemindersLead(next.lead_minutes);
        try {
            await updateReminderSettingsMutation.mutateAsync(next);
            toast.success(next.enabled ? t('calendar.reminders_on', 'Meeting reminders enabled') : t('calendar.reminders_off', 'Meeting reminders disabled'));
        } catch { toast.error(t('calendar.reminders_error', "Couldn't save the reminder settings")); }
    };
    const handlePrev = () => calendarRef.current?.getApi().prev();
    const handleNext = () => calendarRef.current?.getApi().next();
    const handleToday = () => calendarRef.current?.getApi().today();
    const handleViewChange = (view: string) => { calendarRef.current?.getApi().changeView(view); setActiveView(view); };
    return { ...sources, ...actions, ...recurrence, t, navigate, aiMeetingsEnabled, isCompact, calendarRef, initialDate, dateRange, setDateRange, currentTitle, setCurrentTitle, activeView, searchQuery, setSearchQuery, showLeftSidebar, setShowLeftSidebar, showRightSidebar, setShowRightSidebar, isGlobalSearchOpen, setIsGlobalSearchOpen, remindersEnabled, remindersLead, saveReminderSettings, handlePrev, handleNext, handleToday, handleViewChange };
}
export type CalendarPageController = ReturnType<typeof useCalendarPage>;
