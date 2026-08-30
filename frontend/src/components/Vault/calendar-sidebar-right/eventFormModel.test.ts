import { describe, expect, it } from 'vitest';
import { buildDatetime, buildExternalEventData, buildLocalMetadata, padTime, recurrenceText } from './eventFormModel';
import { eventMetadata } from './calendarBoundary';
import { CALENDARS, FIELDS, LOCAL_EVENT } from './calendarTestFixtures';

describe('calendar form model', () => {
    it.each(['FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4', ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4']])('reads supported recurrence shapes: %s', (rule) => {
        expect(recurrenceText(rule)).toBe('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4');
        expect(eventMetadata({rrule: rule}).rrule).toEqual(rule);
    });
    it('normalizes times without inventing dates', () => {
        expect(padTime('9:5')).toBe('09:05');
        expect(buildDatetime('', '09:00', false)).toBeNull();
        expect(buildDatetime('2026-09-02', '09:00', false)).toBe('2026-09-02T09:00:00');
        expect(buildDatetime('2026-09-02', '09:00', true)).toBe('2026-09-02');
    });
    it('keeps inclusive local ends, table fields, exdates and explicit metadata removal', () => {
        const result = buildLocalMetadata({...FIELDS, recurrence: 'WEEKLY', selectedDays: ['MO','WE'], endType: 'count', endCount: '4'}, {eventData: {...LOCAL_EVENT, metadata: {...LOCAL_EVENT.metadata, exdates: ['2026-09-09']}}, calendars: CALENDARS});
        expect(result.metadata).toMatchObject({date: '2026-09-02', end_date: '2026-09-03', source: 'Gnosi', table_id: 'table-calendar', database_table_id: 'table-calendar', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4', exdates: ['2026-09-09']});
        expect(result.removeMetaKeys).toEqual(['location','location_lat','location_lon','travel_time']);
    });
    it('keeps verified coordinates, attendees, reminder, travel time and UNTIL', () => {
        const {metadata, removeMetaKeys} = buildLocalMetadata({...FIELDS, location: ' Room ', locationLat: 41, locationLon: 2, reminder: '15', travelTime: '30', attendees: [{email: 'guest@example.test', name: 'Guest'}], recurrence: 'DAILY', endType: 'until', untilDate: '2026-09-30'}, {eventData: null, calendars: CALENDARS});
        expect(metadata).toMatchObject({location: 'Room', location_lat: 41, location_lon: 2, travel_time: 30, reminder: '15', rrule: 'FREQ=DAILY;UNTIL=20260930T235959Z'});
        expect(removeMetaKeys).toEqual([]);
        expect(metadata.attendees).toHaveLength(1);
    });
    it('clears old coordinates for free-text locations and disables recurrence explicitly', () => {
        const result = buildLocalMetadata({...FIELDS, location: 'https://meeting.example.test'}, {eventData: LOCAL_EVENT, calendars: CALENDARS});
        expect(result.removeMetaKeys).toEqual(['location_lat','location_lon','travel_time']);
        expect(result.metadata.rrule).toBeNull();
    });
    it('writes external all-day ends exclusively and preserves RRULE and attendee wire shapes', () => {
        expect(buildExternalEventData({...FIELDS, recurrence: 'WEEKLY', selectedDays: ['FR'], endType: 'count', endCount: 3, attendees: [{email: 'guest@example.test', name: 'Guest'}]})).toMatchObject({
            start: {date: '2026-09-02'}, end: {date: '2026-09-04'}, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=3'], attendees: [{email: 'guest@example.test', displayName: 'Guest'}],
        });
    });
    it('keeps external timed end fallbacks and time zone', () => {
        const result = buildExternalEventData({...FIELDS, allDay: false, endDate: '', startTime: '09:00', endTime: '10:00'});
        expect(result.start).toEqual({dateTime: '2026-09-02T09:00:00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone});
        expect(result.end).toEqual({dateTime: '2026-09-02T10:00:00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone});
    });
});
