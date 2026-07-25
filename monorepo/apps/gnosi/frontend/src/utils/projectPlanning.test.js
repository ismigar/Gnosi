import { describe, expect, it } from 'vitest';
import {
    addWorkingDuration,
    dependencySuccessorIds,
    latestPredecessorEnd,
    nextWorkingInstant,
    parsePeriod,
    serializePeriod,
    withPeriodBoundaries,
    workingDurationDays,
    wouldCreateDependencyCycle,
} from './projectPlanning';

const settings = {
    hours_per_day: 8,
    workday_start: '09:00',
    working_weekdays: [1, 2, 3, 4, 5],
    holidays: ['2026-08-03'],
};

describe('project planning periods', () => {
    it('reads legacy ranges without losing compatibility', () => {
        expect(parsePeriod('2026-07-27/2026-07-28')).toMatchObject({
            version: 1,
            start: '2026-07-27',
            end: '2026-07-28',
            durationDays: null,
            predecessorIds: [],
        });
    });

    it('serializes all four enhanced elements', () => {
        expect(serializePeriod({
            start: '2026-07-27T09:00',
            end: '2026-07-27T17:00',
            durationDays: 1,
            predecessorIds: ['task-a'],
        })).toMatchObject({
            version: 2,
            start: '2026-07-27T09:00',
            end: '2026-07-27T17:00',
            durationDays: 1,
            predecessorIds: ['task-a'],
        });
    });

    it('keeps boundary origin unless the caller explicitly changes it', () => {
        const current = {
            start: '2026-07-27T09:00',
            end: '2026-07-27T17:00',
            startMode: 'auto',
            endMode: 'auto',
        };
        expect(withPeriodBoundaries(
            current,
            '2026-07-28T09:00',
            '2026-07-28T17:00',
        )).toMatchObject({ startMode: 'auto', endMode: 'auto' });
        expect(withPeriodBoundaries(
            current,
            '2026-07-28T09:00',
            '2026-07-28T17:00',
            { startMode: 'manual', endMode: 'manual' },
        )).toMatchObject({ startMode: 'manual', endMode: 'manual' });
    });

    it('skips weekends and configured holidays', () => {
        expect(addWorkingDuration('2026-07-31T09:00', 2, settings, true))
            .toBe('2026-08-04T17:00');
    });

    it('supports fractional working days', () => {
        expect(addWorkingDuration('2026-07-27T09:00', 0.5, settings, true))
            .toBe('2026-07-27T13:00');
        expect(workingDurationDays(
            '2026-07-27T09:00',
            '2026-07-27T13:00',
            settings,
            true,
        )).toBe(0.5);
    });

    it('normalizes a predecessor finish at day end to the next work instant', () => {
        expect(nextWorkingInstant('2026-07-31T17:00', settings, true))
            .toBe('2026-08-04T09:00');
    });

    it('falls back to the default work week when persisted settings are empty', () => {
        expect(nextWorkingInstant(
            '2026-07-26T12:00',
            { ...settings, working_weekdays: [] },
            true,
        )).toBe('2026-07-27T09:00');
    });

    it('uses the latest predecessor finish', () => {
        const notes = [
            { id: 'a', metadata: { Window: { end: '2026-07-27T17:00' } } },
            { id: 'b', metadata: { Window: { end: '2026-07-28T13:00' } } },
        ];
        expect(latestPredecessorEnd(
            ['a', 'b'],
            notes,
            (note) => note.metadata.Window,
        )).toBe('2026-07-28T13:00');
    });

    it('rejects direct and transitive dependency cycles', () => {
        const notes = [
            { id: 'a', predecessors: [] },
            { id: 'b', predecessors: ['a'] },
            { id: 'c', predecessors: ['b'] },
        ];
        const getIds = (note) => note.predecessors;
        expect([...dependencySuccessorIds('a', notes, getIds)].sort())
            .toEqual(['a', 'b', 'c']);
        expect(wouldCreateDependencyCycle('a', 'c', notes, getIds)).toBe(true);
        expect(wouldCreateDependencyCycle('c', 'a', notes, getIds)).toBe(false);
    });
});
