import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
    addPeriodDuration,
    addWorkingDuration,
    dependencySuccessorIds,
    latestPredecessorEnd,
    nextWorkingInstant,
    parsePeriod,
    periodBoundary,
    periodDurationFromBoundaries,
    periodDurationToWorkingDays,
    serializePeriod,
    withPeriodBoundaries,
    workingDurationDays,
    wouldCreateDependencyCycle,
} from './projectPlanning';

const settings: Readonly<{
    holidays: string[];
    hours_per_day: number;
    workday_start: string;
    working_weekdays: number[];
}> = {
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
            version: 3,
            start: '2026-07-27T09:00',
            end: '2026-07-27T17:00',
            durationDays: 1,
            predecessorIds: ['task-a'],
            dependencies: [{ predecessorId: 'task-a', type: 'FS', lagMinutes: 0 }],
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

    it('reads backend automatic modes without converting them to manual', () => {
        expect(parsePeriod({ startMode: 'automatic', endMode: 'automatic' }))
            .toMatchObject({ startMode: 'auto', endMode: 'auto' });
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

    it('preserves signed years in planning boundaries', () => {
        expect(nextWorkingInstant('-0044-03-15T09:00', settings, false))
            .toBe('-0044-03-15T09:00');
        expect(addWorkingDuration('-0044-03-15T09:00', 1, settings, false))
            .toBe('-0044-03-15T17:00');
    });

    it('adds exact calendar years and retains the configured duration unit', () => {
        expect(addPeriodDuration('2026-01-01T09:00', 8, 'years', settings, true))
            .toBe('2034-01-01T09:00');
        expect(addPeriodDuration('-0044-01-01T09:00', 8, 'years', settings, true))
            .toBe('-0036-01-01T09:00');
        expect(periodDurationFromBoundaries(
            '2026-01-01T09:00',
            '2034-01-01T09:00',
            'years',
            settings,
            true,
        )).toBe(8);
        expect(periodDurationToWorkingDays(8, 'years', settings)).toBe(2920);
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
        const getIds = (note: { predecessors: string[] }): string[] =>
            note.predecessors;
        expect([...dependencySuccessorIds('a', notes, getIds)].sort())
            .toEqual(['a', 'b', 'c']);
        expect(wouldCreateDependencyCycle('a', 'c', notes, getIds)).toBe(true);
        expect(wouldCreateDependencyCycle('c', 'a', notes, getIds)).toBe(false);
    });
});

describe('unknown calendar data boundaries', () => {
    it('preserves legacy scalar and array coercions and signed boundaries', () => {
        const values: readonly unknown[] = [null, undefined, false, 0, true, 42, 12n,
            Symbol('date'), ['-0044-03-15', '-0043-03-15']];
        for (const value of values) {
            const text: unknown = value || '';
            const [start = '', end = ''] = String(text).split('/');
            expect(parsePeriod(value)).toMatchObject({ version: 1, start, end });
        }
        const legacy: unknown = '-0044-03-15/-0043-03-15';
        expect(periodBoundary(legacy, 'start')).toBe('-0044-03-15');
        expect(periodBoundary(legacy, 'end')).toBe('-0043-03-15');
        expect(periodBoundary({ start: '-0044-03-15' }, 'end')).toBe('-0044-03-15');
    });

    it('returns the identical opaque value without a boundary and retains its type', () => {
        const opaque = { plugin: new Map([['date', new Date(0)]]), nested: [{ a: 1 }] };
        const array = [opaque];
        expect(periodBoundary(opaque)).toBe(opaque);
        expect(periodBoundary(opaque, null)).toBe(opaque);
        expect(periodBoundary(opaque, '')).toBe(opaque);
        expect(periodBoundary(array)).toBe(array);
        expectTypeOf(periodBoundary(opaque)).toEqualTypeOf(opaque);
        expectTypeOf(periodBoundary(opaque, '')).toEqualTypeOf(opaque);
        expectTypeOf(periodBoundary(opaque, 'start')).toEqualTypeOf<string>();
    });

    it('reads imported coercible fields without changing metadata or extensions', () => {
        const extension = new Map([['plugin', { retained: true }]]);
        const predecessor = { toString: () => ' task-a ' };
        const opaqueDependency = Object.freeze({
            predecessorId: predecessor, type: ['ss'], lagMinutes: ['30'], extension,
        });
        const raw = Object.freeze({
            start: { toString: () => '-0044-03-15T09:00' },
            end: { toString: () => '-0044-03-15T17:00' },
            durationDays: { valueOf: () => 1 },
            durationValue: ['8'], durationUnit: 'hours',
            predecessorIds: [predecessor, 'task-a', 0, false, null, ['task-b']],
            dependencies: Object.freeze([
                opaqueDependency,
                { predecessorId: 'task-a', type: 'FF', lagMinutes: 10 },
                { predecessorId: ['task-b'], type: 'invalid', lagMinutes: 'bad' },
            ]),
            percentComplete: { valueOf: () => 110 },
            constraintType: ['snet'], constraintDate: '-0044-03-15T09:00',
            actualStart: '-0044-03-14T09:00', actualEnd: '', deadline: '-0044-03-16T17:00',
            startMode: 'automatic', endMode: 'auto', mode: 'manual', extension,
        });
        const imported: unknown = raw;
        const parsed = parsePeriod(imported);
        expect(parsed).toMatchObject({
            version: 3, start: '-0044-03-15T09:00', end: '-0044-03-15T17:00',
            durationDays: 1, durationValue: 8, durationUnit: 'hours', percentComplete: 100,
            predecessorIds: ['task-a', 'task-b'],
            dependencies: [
                { predecessorId: 'task-a', type: 'SS', lagMinutes: 30 },
                { predecessorId: 'task-b', type: 'FS', lagMinutes: 0 },
            ],
        });
        const saved = withPeriodBoundaries(imported, '-0043-03-15T09:00', '-0043-03-15T17:00');
        expect(saved).toEqual({ ...parsed, start: '-0043-03-15T09:00', end: '-0043-03-15T17:00' });
        expect(raw.extension).toBe(extension);
        expect(raw.dependencies[0]).toBe(opaqueDependency);
        expect(opaqueDependency.extension).toBe(extension);
        expect(raw.predecessorIds[0]).toBe(predecessor);
        parsed.predecessorIds.push('new');
        const firstDependency = parsed.dependencies[0];
        if (!firstDependency) throw new Error('Expected parsed dependency');
        firstDependency.lagMinutes = 60;
        expect(raw.dependencies[0]?.lagMinutes).toEqual(['30']);
        expect(raw.predecessorIds).toHaveLength(6);
    });

    it('retains inherited period fields and Date special handling', () => {
        class ImportedPeriod {
            get start(): string { return '-0044-03-15'; }
            get durationDays(): number { return 2; }
        }
        expect(parsePeriod(new ImportedPeriod())).toMatchObject({ start: '-0044-03-15', durationDays: 2 });
        const date = Object.assign(new Date(0), { start: 'ignored' });
        expect(parsePeriod(date)).toMatchObject({ version: 3, start: '', end: '' });
    });

    it('retains dependency collection receivers and failure paths', () => {
        const callbackError = new Error('imported collection failed');
        const dependencies = {
            length: 1,
            forEach(visit: (value: unknown) => void) {
                expect(this).toBe(dependencies);
                visit({ predecessorId: 'task-a', type: 'sf', lagMinutes: 15 });
            },
        };
        expect(parsePeriod({ dependencies }).dependencies).toEqual([
            { predecessorId: 'task-a', type: 'SF', lagMinutes: 15 },
        ]);
        expect(parsePeriod({ dependencies: {}, predecessorIds: ['legacy'] }).dependencies)
            .toEqual([{ predecessorId: 'legacy', type: 'FS', lagMinutes: 0 }]);
        expect(() => parsePeriod({ dependencies: 'invalid' })).toThrow(TypeError);
        expect(() => parsePeriod({ dependencies: [null] })).toThrow(TypeError);
        expect(() => parsePeriod({ durationDays: Symbol('duration') })).toThrow(TypeError);
        expect(() => parsePeriod({ dependencies: {
            length: 1, forEach: () => { throw callbackError; },
        } })).toThrow(callbackError);
    });

    it('calls predecessor readers with original notes and propagates their errors', () => {
        const note = { id: 'task-a', metadata: { Dates: { end: '-0044-03-15T17:00' }, extension: new Map() } };
        const read = vi.fn((candidate: typeof note): unknown => candidate.metadata.Dates);
        expect(latestPredecessorEnd(['task-a'], [note], read)).toBe('-0044-03-15T17:00');
        expect(read).toHaveBeenCalledExactlyOnceWith(note);
        expect(read.mock.calls[0]?.[0]).toBe(note);
        const failure = new Error('reader failed');
        expect(() => latestPredecessorEnd(['task-a'], [note], () => { throw failure; })).toThrow(failure);
    });

    it('retains custom holiday collections, opaque entries and lazy error paths', () => {
        const holidays = {
            map(convert: (value: unknown) => string) {
                expect(this).toBe(holidays);
                return [{ toString: () => '2026-08-03' }, 'invalid'].map(convert);
            },
        };
        expect(nextWorkingInstant('2026-08-03T09:00', { ...settings, holidays }))
            .toBe('2026-08-04T09:00');
        expect(() => nextWorkingInstant('2026-08-03T09:00', { holidays: 42 })).toThrow(TypeError);
        expect(nextWorkingInstant('2026-08-03T09:00', { holidays: 42 }, false))
            .toBe('2026-08-03T09:00');
        const failure = new Error('holiday failed');
        expect(() => nextWorkingInstant('2026-08-03T09:00', {
            holidays: { map: () => { throw failure; } },
        })).toThrow(failure);
    });
});
