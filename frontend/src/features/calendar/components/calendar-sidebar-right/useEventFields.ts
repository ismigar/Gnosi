import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { exclusiveToInclusiveAllDayEnd } from '../../../../shared/dates/calendarUtils';
import type { CalendarAttendee, CalendarGeocodeResult } from '../../../../shared/api/calendar';
import type { EventAttendee, EventFormProps, EventFields } from './calendarTypes';
import { recurrenceText } from './eventFormModel';
export function useEventFields({mode, eventData, initialDate, calendars, defaultCalendarId = ''}: EventFormProps) {
    const titleRef = useRef<HTMLInputElement>(null);
    // Function to normalize times to the HH:mm format
    const padTime = (timeStr: string) => {
        if (!timeStr) return '';
        const parts = timeStr.split(':');
        if (parts.length !== 2) return timeStr;
        const hours = (parts[0] || '').padStart(2, '0');
        const minutes = (parts[1] || '').padStart(2, '0');
        return `${hours}:${minutes}`;
    };

    const [title, setTitle] = useState('');
    const [allDay, setAllDay] = useState(true);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime] = useState('');
    const [calendarId, setCalendarId] = useState('');
    const [location, setLocation] = useState('');
    const [locationLat, setLocationLat] = useState<number | null>(null);
    const [locationLon, setLocationLon] = useState<number | null>(null);
    const [locationSuggestions, setLocationSuggestions] = useState<CalendarGeocodeResult[]>([]);
    const [locationLoading, setLocationLoading] = useState(false);
    const [locationHighlight, setLocationHighlight] = useState(-1);
    const locationSuggestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const locationBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [reminder, setReminder] = useState('');
    const [travelTime, setTravelTime] = useState('');
    const [recurrence, setRecurrence] = useState('');
    const [selectedDays, setSelectedDays] = useState<string[]>([]);
    const [endType, setEndType] = useState('never');
    const [endCount, setEndCount] = useState<string | number>(10);
    const [untilDate, setUntilDate] = useState('');
    const [description, setDescription] = useState('');

    const [attendees, setAttendees] = useState<EventAttendee[]>([]);
    const [attendeeInput, setAttendeeInput] = useState('');
    const [attendeeSuggestions, setAttendeeSuggestions] = useState<CalendarAttendee[]>([]);
    const attendeeSuggestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const originalAttendeesRef = useRef<string[]>([]);

    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const isInitializingRef = useRef(true);
    const lastSavedDataRef = useRef<string | null>(null);
    const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // In 'create' mode the appointment is NOT created until there's a title. createdIdRef stores
    // the id once created so that subsequent autosaves do a PATCH (not duplicate it).
    // createdId is the reactive equivalent for the UI (header and Delete button).
    const createdIdRef = useRef<string | null>(null);
    const isCreatingRef = useRef(false);
    const [createdId, setCreatedId] = useState<string | null>(null);
    // When the appointment is created in a Google calendar, we store the Google event id
    // (+ account and calendar_id) so that subsequent changes PATCH Google, not the Vault.
    const googleRef = useRef<{id: string; account: string; calendar_id: string} | null>(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [isRecurrenceDeleteOpen, setIsRecurrenceDeleteOpen] = useState(false);
    const [isRecurrenceModifyOpen, setIsRecurrenceModifyOpen] = useState(false);

    // Populate fields
    const populateFields = useEffectEvent(() => {
        isInitializingRef.current = true;
        lastSavedDataRef.current = null;
        createdIdRef.current = null;
        isCreatingRef.current = false;
        googleRef.current = null;
        setCreatedId(null);

        if ((mode === 'edit' || mode === 'view') && eventData) {
            const meta = eventData.metadata;
            setTitle(eventData.title || meta.title || '');

            const rawDate = meta.date || meta.start_time || meta.due_date || '';
            if (rawDate.includes('T')) {
                setStartDate(rawDate.split('T')[0] || '');
                setStartTime(padTime(rawDate.split('T')[1]?.substring(0, 5) || ''));
                setAllDay(false);
            } else {
                setStartDate(rawDate);
                setStartTime('');
                setAllDay(true);
            }

            const rawEnd = meta.end_date || meta.end_time || '';
            if (rawEnd.includes('T')) {
                setEndDate(rawEnd.split('T')[0] || '');
                setEndTime(padTime(rawEnd.split('T')[1]?.substring(0, 5) || ''));
            } else {
                setEndDate(meta._end_exclusive ? exclusiveToInclusiveAllDayEnd(rawEnd) : rawEnd);
                setEndTime('');
            }

            const tableId = eventData.resolved_table_id || meta.table_id || meta.database_table_id || '';
            const hasCalendarOption = calendars.some(c => c.id === tableId);
            const fallbackCalId = defaultCalendarId || calendars[0]?.id || '';
            setCalendarId(hasCalendarOption ? tableId : fallbackCalId);
            setLocation(meta.location || '');
            setLocationLat(meta.location_lat ?? null);
            setLocationLon(meta.location_lon ?? null);
            setReminder(meta.reminder || '');
            setTravelTime(meta.travel_time != null ? String(meta.travel_time) : '');

            // Re-populate RRULE
            const rawRrule = recurrenceText(meta.rrule || meta.recurrence);
            if (rawRrule) {
                const parts = rawRrule.split(';');
                const freqPart = parts.find(p => p.startsWith('FREQ='));
                const byDayPart = parts.find(p => p.startsWith('BYDAY='));
                const countPart = parts.find(p => p.startsWith('COUNT='));
                const untilPart = parts.find(p => p.startsWith('UNTIL='));

                setRecurrence(freqPart?.split('=')[1] || '');
                setSelectedDays(byDayPart ? (byDayPart.split('=')[1] || '').split(',') : []);

                if (countPart) {
                    setEndType('count');
                    setEndCount(parseInt(countPart.split('=')[1] || ''));
                } else if (untilPart) {
                    setEndType('until');
                    const uVal = untilPart.split('=')[1] || '';
                    // Format YYYYMMDDTHHMMSSZ -> YYYY-MM-DD
                    setUntilDate(`${uVal.substring(0, 4)}-${uVal.substring(4, 6)}-${uVal.substring(6, 8)}`);
                } else {
                    setEndType('never');
                }
            } else {
                setRecurrence('');
                setSelectedDays([]);
                setEndType('never');
            }

            setDescription(eventData.content || '');

            const loadedAttendees = Array.isArray(meta.attendees) ? meta.attendees : [];
            setAttendees(loadedAttendees);
            originalAttendeesRef.current = loadedAttendees.map(a => a.email);
        } else {
            setTitle('');
            // initialDate can come as "YYYY-MM-DD" (all day) or with a time
            // ("YYYY-MM-DDTHH:mm[:ss]") if a time slot was clicked.
            const rawInit = initialDate || '';
            if (rawInit.includes('T')) {
                setStartDate(rawInit.split('T')[0] || '');
                setStartTime(padTime(rawInit.split('T')[1]?.substring(0, 5) || ''));
                setAllDay(false);
            } else {
                setStartDate(rawInit);
                setStartTime('');
                setAllDay(true);
            }
            setEndDate('');
            setEndTime('');

            // Default calendar (configured by the user or the first available one)
            const defCalId = defaultCalendarId || calendars.find(c => c.is_default)?.id || calendars[0]?.id || '';
            setCalendarId(defCalId);

            setLocation('');
            setLocationLat(null);
            setLocationLon(null);
            setReminder('');
            setTravelTime('');
            setRecurrence('');
            setSelectedDays([]);
            setEndType('never');
            setDescription('');
            setAttendees([]);
            originalAttendeesRef.current = [];
        }
        setAttendeeInput('');
        setAttendeeSuggestions([]);
        setLocationSuggestions([]);
        setLocationHighlight(-1);


        setTimeout(() => {
            titleRef.current?.focus();
            isInitializingRef.current = false;
        }, 150);
    });
    useEffect(() => {
        let active = true;
        queueMicrotask(() => { if (active) populateFields(); });
        return () => { active = false; };
    }, [mode, eventData, initialDate]);


    const fields: EventFields = { title, allDay, startDate, endDate, startTime, endTime, calendarId, location, locationLat, locationLon, reminder, recurrence, selectedDays, endType, endCount, untilDate, description, attendees, travelTime };
    return { fields, titleRef, title, setTitle, allDay, setAllDay, startDate, setStartDate, endDate, setEndDate, startTime, setStartTime, endTime, setEndTime, calendarId, setCalendarId, location, setLocation, locationLat, setLocationLat, locationLon, setLocationLon, locationSuggestions, setLocationSuggestions, locationLoading, setLocationLoading, locationHighlight, setLocationHighlight, reminder, setReminder, travelTime, setTravelTime, recurrence, setRecurrence, selectedDays, setSelectedDays, endType, setEndType, endCount, setEndCount, untilDate, setUntilDate, description, setDescription, attendees, setAttendees, attendeeInput, setAttendeeInput, attendeeSuggestions, setAttendeeSuggestions, saving, setSaving, deleting, setDeleting, saveError, setSaveError, createdId, setCreatedId, isDeleteConfirmOpen, setIsDeleteConfirmOpen, isRecurrenceDeleteOpen, setIsRecurrenceDeleteOpen, isRecurrenceModifyOpen, setIsRecurrenceModifyOpen, locationSuggestTimeoutRef, locationBlurTimeoutRef, attendeeSuggestTimeoutRef, originalAttendeesRef, isInitializingRef, lastSavedDataRef, autoSaveTimeoutRef, createdIdRef, isCreatingRef, googleRef };
}
export type EventFieldState = ReturnType<typeof useEventFields>;
