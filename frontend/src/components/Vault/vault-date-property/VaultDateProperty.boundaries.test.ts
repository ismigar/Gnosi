import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { parsePeriod, type PeriodInput } from '../../../utils/projectPlanning';
import { formattedDateInputValue, htmlDateValue, isSignedDateValue, scalarDateValue, toLocalDateString } from './dateModel';
import { createPlanningPeriodModel } from './planningModel';
import type { PeriodEditorProps, VaultPlanningNote } from './types';

function modelProps(overrides: Partial<PeriodEditorProps> = {}): PeriodEditorProps {
    return {
        fieldConfig: { id: 'dates', period_unit: 'hours', skip_non_working_days: false },
        fieldName: 'Dates', idToTitle: {}, noteId: 'current', notes: [],
        onChange: vi.fn<(value: PeriodInput) => void>(), planningEnabled: true,
        planningSettings: { task_table_id: 'tasks', hours_per_day: 8, workday_start: '09:00' },
        value: '', ...overrides,
    };
}

describe('VaultDateProperty imported calendar boundaries', () => {
    it('keeps signed scalar dates, opaque period starts and array coercion', () => {
        const value: unknown = { start: { toString: () => '-0044-03-15T09:00' }, extension: new Set(['opaque']) };
        expect(scalarDateValue(value)).toBe('-0044-03-15T09:00');
        expect(formattedDateInputValue(value, 'datetime', 'en-US')).toBe('-0044-03-15T09:00');
        expect(isSignedDateValue(value)).toBe(true);
        expect(htmlDateValue(value, 'datetime')).toBe('');
        expect(scalarDateValue(['2026-07-27/2026-07-28'])).toBe('2026-07-27');
        expect(scalarDateValue({ extension: new Map() })).toBe('');
    });

    it('retains symbol errors and callable date coercion', () => {
        const symbol: unknown = Symbol('date');
        expect(isSignedDateValue(symbol)).toBe(false);
        expect(formattedDateInputValue(symbol, 'date', 'en-US')).toBe('');
        expect(() => htmlDateValue(symbol, 'date')).toThrow(TypeError);
        const callable = Object.assign(() => undefined, {
            toString: () => '-0044-03-15T09:00',
        });
        expect(scalarDateValue(callable)).toBe(callable);
        expect(formattedDateInputValue(callable, 'datetime', 'en-US')).toBe('-0044-03-15T09:00');
        const numeric = Object.assign(() => undefined, { [Symbol.toPrimitive]: () => 0 });
        expect(htmlDateValue(numeric, 'date')).toBe(toLocalDateString(new Date(0), 'date'));
    });

    it('preserves note references, table scoping, aliases and opaque metadata', () => {
        const extension = new Map([['plugin', { keep: true }]]);
        const metadata: Record<string, unknown> = {
            table_id: 'tasks', dates: { end: '-0044-03-15T17:00' }, extension,
        };
        const predecessor: VaultPlanningNote = { id: 'previous', metadata };
        const notes: readonly VaultPlanningNote[] = Object.freeze([
            { id: 'current', metadata: { table_id: 'tasks', Dates: '' } },
            predecessor,
            { id: 'successor', metadata: { table_id: 'tasks', Dates: { predecessorIds: ['current'] } } },
            { id: 'outside', metadata: { table_id: 'other' } },
        ]);
        const onChange = vi.fn<(value: PeriodInput) => void>();
        const model = createPlanningPeriodModel(modelProps({ notes, onChange,
            value: { durationValue: { valueOf: () => 8 }, durationUnit: 'hours', extension },
        }), 'en-US');
        expect(model.candidates).toEqual([predecessor]);
        expect(model.candidates[0]).toBe(predecessor);
        model.togglePredecessor('previous');
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0]).toHaveLength(1);
        expect(onChange).toHaveBeenCalledWith({
            version: 3, start: '-0044-03-16T09:00', end: '-0044-03-16T17:00',
            durationDays: null, durationValue: 8, durationUnit: 'hours',
            predecessorIds: ['previous'], dependencies: [{ predecessorId: 'previous', type: 'FS', lagMinutes: 0 }],
            startMode: 'auto', endMode: 'auto', mode: 'automatic', constraintType: 'ASAP',
            constraintDate: '', deadline: '', percentComplete: 0, actualStart: '', actualEnd: '',
        });
        expect(predecessor.metadata).toBe(metadata);
        expect(metadata.extension).toBe(extension);
        expect(notes[1]).toBe(predecessor);
        expectTypeOf(model.handleDurationChange).toEqualTypeOf<(value: string) => void>();
    });

    it('keeps opaque settings, legacy predecessor filtering and their error behavior', () => {
        const settings = {
            hours_per_day: { valueOf: () => 4 }, workday_start: '10:00',
            working_weekdays: [1, 2, 3, 4, 5], holidays: [],
            task_table_id: 'tasks', extension: new Set(['retained']),
        };
        const metadata: Record<string, unknown> = {
            table_id: 'tasks', Dates: '2026-07-27/2026-07-28',
            predecessor_ids: ['current', { nested: 'opaque' }],
        };
        const note: VaultPlanningNote = { id: 'mixed', metadata };
        const onChange = vi.fn<(value: PeriodInput) => void>();
        const props = modelProps({ value: '2026-07-27/2026-07-27', planningSettings: settings, notes: [note], onChange });
        const model = createPlanningPeriodModel(props, 'en-US');
        expect(model.candidates[0]).toBe(note);
        model.handleDurationChange('2');
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
            end: '2026-07-27T12:00', durationValue: 2, durationDays: 0.5,
        }));
        expect(metadata.predecessor_ids).toEqual(['current', { nested: 'opaque' }]);
        expect(settings.extension).toEqual(new Set(['retained']));
        const error = new Error('settings extension getter');
        const badSettings = { get extension(): never { throw error; } };
        expect(() => createPlanningPeriodModel({ ...props, planningSettings: badSettings }, 'en-US')).toThrow(error);
        expect(() => createPlanningPeriodModel({ ...props, planningSettings: null }, 'en-US')).toThrow(TypeError);
    });

    it('retains all serialized planning fields, mutable outputs and callback errors', () => {
        const raw = Object.freeze({
            start: '-0044-03-15T09:00', end: '-0044-03-15T17:00', durationValue: 8, durationUnit: 'hours',
            dependencies: Object.freeze([{ predecessorId: 'previous', type: 'SS', lagMinutes: 30 }]),
            predecessorIds: ['previous'], constraintType: 'SNET', constraintDate: '-0044-03-14T09:00',
            deadline: '-0044-03-17T17:00', actualStart: '-0044-03-15T10:00', actualEnd: '', percentComplete: 25,
        });
        const onChange = vi.fn<(value: PeriodInput) => void>();
        const props = modelProps({ value: raw, onChange });
        const model = createPlanningPeriodModel(props, 'en-US');
        model.handleDependencyLagChange(0, '90');
        expect(onChange.mock.calls[0]).toEqual([{
            ...parsePeriod(raw), dependencies: [{ predecessorId: 'previous', type: 'SS', lagMinutes: 90 }],
        }]);
        const saved = onChange.mock.calls[0]?.[0];
        expect(Object.isFrozen(saved)).toBe(false);
        expect(raw.dependencies[0]?.lagMinutes).toBe(30);
        const error = new Error('save failed');
        const failing = createPlanningPeriodModel({ ...props, onChange: () => { throw error; } }, 'en-US');
        expect(() => { failing.commitDeadline('2026-08-30T17:00'); }).toThrow(error);
    });
});
