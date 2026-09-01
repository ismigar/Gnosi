import { describe, expect, it } from 'vitest';
import { availableCalendarSources, calendarConfigsFor, calendarSettings, hybridCalendarEntry } from './calendarPageModel';
import { calendarSearchNote } from './calendarSearchModel';
import { externalEvent, LOCAL_EVENT } from '../components/calendar-sidebar-right/calendarTestFixtures';

describe('calendar page source model', () => {
    it('preserves provider metadata, recurrence, exclusive ends and readonly state', () => {
        const source = {...externalEvent('caldav'), recurrence: ['RRULE:FREQ=DAILY'], is_read_only: true};
        expect(hybridCalendarEntry(source)).toMatchObject({id: 'caldav-event', metadata: {_provider: 'caldav', _account: 'caldav@example.test', _end_exclusive: true, readonly: true, rrule: ['RRULE:FREQ=DAILY']}});
        expect(hybridCalendarEntry(externalEvent('vault')).metadata._end_exclusive).toBe(false);
    });
    it('keeps empty integrations distinct from a saved selection and accepts both selection shapes', () => {
        expect(calendarSettings({})).toEqual({});
        expect(calendarSettings({calendar_selection: ['Appointments']})).toMatchObject({calendar_selection: ['Appointments']});
        expect(calendarSettings({calendar_selection: {selection: ['caldav@example.test']}})).toMatchObject({calendar_selection: {selection: ['caldav@example.test']}});
    });
    it('retains aliases, colors, CalDAV and Google sub-calendars without OneDrive assumptions', () => {
        const settings = calendarSettings({calendars: [{email: 'caldav@example.test'}, {email: 'google@example.test'}], calendar_aliases: {Appointments: 'Visits'}, calendar_colors: {Appointments: '#123456'}, default_calendar: 'Appointments'});
        const tables = [{id: 'table-calendar', name: 'Appointments', type: 'table' as const}];
        const events = [hybridCalendarEntry(externalEvent()), hybridCalendarEntry({...externalEvent('google'), source: 'google@example.test - Work'})];
        const sources = availableCalendarSources([LOCAL_EVENT], events, tables, settings);
        const configs = calendarConfigsFor(sources, settings, tables, [
            {id: 'dav-work', account: 'caldav@example.test', name: 'CalDAV', primary: true, provider: 'caldav'},
            {id: 'google-work', account: 'google@example.test', name: 'Work', provider: 'google'},
        ]);
        expect(configs).toEqual(expect.arrayContaining([
            expect.objectContaining({id: 'table-calendar', name: 'Visits', color: '#123456', kind: 'table'}),
            expect.objectContaining({provider: 'caldav', google_calendar_id: 'dav-work'}),
            expect.objectContaining({provider: 'google', google_calendar_id: 'google-work'}),
        ]));
    });
    it('preserves nested search metadata and navigation fields', () => {
        const note = {...LOCAL_EVENT, path: '/Calendar/local.md', metadata: {...LOCAL_EVENT.metadata, tags: ['medicine'], custom: {enabled: true, value: 2}}};
        expect(calendarSearchNote(note)).toEqual(note);
    });
});
