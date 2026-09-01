import { useCallback, type KeyboardEvent } from 'react';
import { geocodeCalendarLocation, searchCalendarAttendees, type CalendarAttendee, type CalendarGeocodeResult } from '../../../../shared/api/calendar';
import type { EventFieldState } from './useEventFields';
export function useEventSuggestions(state: EventFieldState) {
 const {setLocation, setLocationLat, setLocationLon, locationSuggestions, setLocationSuggestions, setLocationLoading, locationHighlight, setLocationHighlight, setAttendees, attendeeInput, setAttendeeInput, setAttendeeSuggestions, locationSuggestTimeoutRef, attendeeSuggestTimeoutRef} = state;
    // ─── Attendees helpers ────────────────────────────────────────────────────
    const handleAttendeeInputChange = useCallback((val: string) => {
        setAttendeeInput(val);
        setAttendeeSuggestions([]);
        if (attendeeSuggestTimeoutRef.current) clearTimeout(attendeeSuggestTimeoutRef.current);
        if (val.trim().length < 2) return;
        attendeeSuggestTimeoutRef.current = setTimeout(() => { void (async () => {
            try {
                setAttendeeSuggestions(await searchCalendarAttendees(val.trim()));
            } catch {
                setAttendeeSuggestions([]);
            }
        })(); }, 300);
    }, [attendeeSuggestTimeoutRef, setAttendeeInput, setAttendeeSuggestions]);

    const addAttendee = useCallback((contact: CalendarAttendee) => {
        const email = (contact.email || '').trim().toLowerCase();
        if (!email || !email.includes('@')) return;
        setAttendees(prev => prev.some(a => a.email.toLowerCase() === email)
            ? prev
            : [...prev, { email, name: contact.name || '', rsvp: 'needsAction' }]
        );
        setAttendeeInput('');
        setAttendeeSuggestions([]);
    }, [setAttendeeInput, setAttendeeSuggestions, setAttendees]);

    const addAttendeeFromInput = useCallback(() => {
        addAttendee({ email: attendeeInput, name: '' });
    }, [attendeeInput, addAttendee]);

    const removeAttendee = useCallback((email: string) => {
        setAttendees(prev => prev.filter(a => a.email !== email));
    }, [setAttendees]);

    // ─── Location geocoding (OpenStreetMap / Photon) ─────────────────────────
    const fetchLocationSuggestions = useCallback((val: string) => {
        const query = (val || '').trim();
        // No geocodifiquem URLs ni consultes massa curtes
        if (query.length < 3 || /^(https?:\/\/|www\.)/i.test(query)) {
            setLocationSuggestions([]);
            setLocationLoading(false);
            return;
        }
        setLocationLoading(true);
        locationSuggestTimeoutRef.current = setTimeout(() => { void (async () => {
            try {
                setLocationSuggestions(await geocodeCalendarLocation(query));
                setLocationHighlight(-1);
            } catch {
                setLocationSuggestions([]);
            } finally {
                setLocationLoading(false);
            }
        })(); }, 350);
    }, [locationSuggestTimeoutRef, setLocationHighlight, setLocationLoading, setLocationSuggestions]);

    const handleLocationChange = useCallback((val: string) => {
        setLocation(val);
        // Manual editing invalidates the prior verification (coordinates)
        setLocationLat(null);
        setLocationLon(null);
        if (locationSuggestTimeoutRef.current) clearTimeout(locationSuggestTimeoutRef.current);
        fetchLocationSuggestions(val);
    }, [fetchLocationSuggestions, locationSuggestTimeoutRef, setLocation, setLocationLat, setLocationLon]);

    const selectLocationSuggestion = useCallback((sug: CalendarGeocodeResult | undefined) => {
        if (!sug) return;
        setLocation(sug.label);
        setLocationLat(typeof sug.lat === 'number' ? sug.lat : null);
        setLocationLon(typeof sug.lon === 'number' ? sug.lon : null);
        setLocationSuggestions([]);
        setLocationHighlight(-1);
        if (locationSuggestTimeoutRef.current) clearTimeout(locationSuggestTimeoutRef.current);
    }, [locationSuggestTimeoutRef, setLocation, setLocationHighlight, setLocationLat, setLocationLon, setLocationSuggestions]);

    const handleLocationKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        if (locationSuggestions.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setLocationHighlight((i) => Math.min(i + 1, locationSuggestions.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setLocationHighlight((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (locationHighlight >= 0) selectLocationSuggestion(locationSuggestions[locationHighlight]);
        } else if (e.key === 'Escape') {
            // Closes only the dropdown, not the whole panel
            e.preventDefault();
            e.stopPropagation();
            setLocationSuggestions([]);
            setLocationHighlight(-1);
        }
    }, [locationSuggestions, locationHighlight, selectLocationSuggestion, setLocationHighlight, setLocationSuggestions]);


 return {handleAttendeeInputChange, addAttendee, addAttendeeFromInput, removeAttendee, fetchLocationSuggestions, handleLocationChange, selectLocationSuggestion, handleLocationKeyDown};
}
