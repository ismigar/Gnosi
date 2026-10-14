import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildExternalDatetime, buildExternalEventData, buildExternalEventTimes, buildLocalMetadata, eventDateFields } from './eventFormModel';
import { CALENDARS, FIELDS, LOCAL_EVENT } from './calendarTestFixtures';

beforeEach(() => { vi.stubEnv('TZ', 'Europe/Madrid'); });
afterEach(() => { vi.unstubAllEnvs(); });

it('shows aware provider timestamps in the browser local time, including date rollover', () => {
    expect(eventDateFields('2026-10-13T10:00:00Z')).toEqual({ date: '2026-10-13', time: '12:00' });
    expect(eventDateFields('2026-10-13T18:00:00-05:00')).toEqual({ date: '2026-10-14', time: '01:00' });
    expect(eventDateFields('2026-12-13T10:00:00Z')).toEqual({ date: '2026-12-13', time: '11:00' });
});

it('keeps the original instant and seconds when another field changes', () => {
    expect(buildExternalDatetime('2026-10-13', '12:00', false, '2026-10-13T10:00:27Z'))
        .toBe('2026-10-13T10:00:27Z');
});

it('distinguishes the two occurrences of the same local time at DST fall-back', () => {
    for (const original of ['2026-10-25T02:30:00+02:00', '2026-10-25T02:30:00+01:00']) {
        expect(eventDateFields(original)).toEqual({ date: '2026-10-25', time: '02:30' });
        expect(buildExternalDatetime('2026-10-25', '02:30', false, original)).toBe(original);
    }
});

it('serializes changed local time with an explicit offset across DST boundaries', () => {
    expect(buildExternalDatetime('2026-03-28', '12:15', false)).toBe('2026-03-28T11:15:00.000Z');
    expect(buildExternalDatetime('2026-03-29', '12:15', false)).toBe('2026-03-29T10:15:00.000Z');
    expect(buildExternalDatetime('2026-10-25', '12:15', false)).toBe('2026-10-25T11:15:00.000Z');
});

it('leaves all-day and floating local dates unchanged', () => {
    expect(eventDateFields('2026-10-25')).toEqual({ date: '2026-10-25', time: '' });
    expect(eventDateFields('2026-10-25T12:15:00')).toEqual({ date: '2026-10-25', time: '12:15' });
    expect(buildExternalDatetime('2026-10-25', '', true)).toBe('2026-10-25');
    expect(buildExternalDatetime('2026-10-25', '12:15', false, '2026-10-25T12:15:27')).toBe('2026-10-25T12:15:27');
    expect(buildExternalDatetime('2026-10-25', '13:15', false, '2026-10-25T12:15:27')).toBe('2026-10-25T13:15:00');
});

it('gives a new timed event with an optional end one hour, including a DST transition', () => {
    const fields = { ...FIELDS, allDay: false, startDate: '2026-03-29', startTime: '01:30', endDate: '', endTime: '' };
    expect(buildExternalEventData(fields)).toMatchObject({
        start: { dateTime: '2026-03-29T00:30:00.000Z', timeZone: 'Europe/Madrid' },
        end: { dateTime: '2026-03-29T01:30:00.000Z', timeZone: 'Europe/Madrid' },
    });
    expect(buildExternalEventTimes(fields, '2026-03-29T01:30:00+01:00', '2026-03-29T03:30:00+02:00'))
        .toEqual({ start: '2026-03-29T01:30:00+01:00', end: '2026-03-29T01:30:00.000Z' });
});

it('preserves aware local reservation timestamps and seconds on unrelated edits', () => {
    const eventData = { ...LOCAL_EVENT, metadata: { ...LOCAL_EVENT.metadata, date: '2026-10-14T10:00:27Z', end_date: '2026-10-14T11:00:27Z', all_day: false } };
    const fields = { ...FIELDS, allDay: false, startDate: '2026-10-14', startTime: '12:00', endDate: '2026-10-14', endTime: '13:00' };
    expect(buildLocalMetadata(fields, { eventData, calendars: CALENDARS }).metadata)
        .toMatchObject({ date: '2026-10-14T10:00:27Z', end_date: '2026-10-14T11:00:27Z' });
    expect(buildLocalMetadata({ ...fields, startTime: '12:15', endTime: '13:15' }, { eventData, calendars: CALENDARS }).metadata)
        .toMatchObject({ date: '2026-10-14T10:15:00.000Z', end_date: '2026-10-14T11:15:00.000Z' });
});

it('retains existing floating local dates when editing their wall time', () => {
    const eventData = { ...LOCAL_EVENT, metadata: { ...LOCAL_EVENT.metadata, date: '2026-10-14T10:00:00', end_date: '2026-10-14T11:00:00', all_day: false } };
    const fields = { ...FIELDS, allDay: false, startDate: '2026-10-14', startTime: '10:15', endDate: '2026-10-14', endTime: '11:15' };
    expect(buildLocalMetadata(fields, { eventData, calendars: CALENDARS }).metadata)
        .toMatchObject({ date: '2026-10-14T10:15:00', end_date: '2026-10-14T11:15:00' });
});
