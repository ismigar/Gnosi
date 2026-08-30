import { describe, expect, it } from 'vitest';

import { evaluateRollup } from './rollupUtils';

describe('evaluateRollup imported values', () => {
  it('counts opaque values without confusing their string form with emptiness', () => {
    const nested = { nested: { values: [null, ['one']] } };
    const empty: unknown[] = [];
    const values: readonly unknown[] = [nested, { other: true }, empty, [null], null, undefined, '', false, 0];

    expect(evaluateRollup(values, 'count_all')).toBe(9);
    expect(evaluateRollup(values, 'count_values')).toBe(6);
    expect(evaluateRollup(values, 'unique_count')).toBe(4);
    expect(evaluateRollup(values, 'show_original')).toBe('[object Object], [object Object], , , false, 0');
    expect(evaluateRollup(values, 'unrecognized')).toBe(9);
    expect(values[0]).toBe(nested);
    expect(values[2]).toBe(empty);
    expect(Object.isFrozen(empty)).toBe(false);
  });

  it('preserves numeric prefix and decimal comma coercion of arrays and objects', () => {
    const values: readonly unknown[] = [
      [2, 5], [[3]], { toString: () => '4,5' }, { nested: [100] }, null, false, '12px',
    ];

    expect(evaluateRollup(values, 'sum')).toBe(22);
    expect(evaluateRollup(values, 'avg')).toBe('5.50');
    expect(evaluateRollup(values, 'min')).toBe(2.5);
    expect(evaluateRollup(values, 'max')).toBe(12);
  });

  it('sorts using legacy strings and returns the original object or array', () => {
    const earlier = { nested: { value: null }, toString: () => '2024-01-01' };
    const later = ['2025-12-31'];
    const values: readonly unknown[] = [later, null, '', earlier, undefined];

    expect(evaluateRollup(values, 'earliest')).toBe(earlier);
    expect(evaluateRollup(values, 'latest')).toBe(later);
    expect(values).toEqual([later, null, '', earlier, undefined]);
    expect(values[0]).toBe(later);
    expect(values[3]).toBe(earlier);
    expect(Object.isFrozen(earlier)).toBe(false);
    expect(Object.isFrozen(later)).toBe(false);
    expect(evaluateRollup([2, 10], 'earliest')).toBe(10);
    expect(evaluateRollup([2, 10], 'latest')).toBe(2);
  });

  it('retains stable sort order for equal object strings and empty-array identity', () => {
    const first = { nested: [null] };
    const second = { nested: { value: [] } };
    const empty: unknown[] = [];

    expect(evaluateRollup([first, second], 'earliest')).toBe(first);
    expect(evaluateRollup([first, second], 'latest')).toBe(second);
    expect(evaluateRollup([null, '', empty], 'earliest')).toBe(empty);
    expect(evaluateRollup([null, undefined, ''], 'latest')).toBeNull();
  });

  it('counts checkbox text coercion of nested arrays and objects in the full denominator', () => {
    const values: readonly unknown[] = [
      true, ['true'], [[' checked ']], { toString: () => 'YES' }, 2,
      { nested: true }, null, [], ['true', 'false'], false,
    ];

    expect(evaluateRollup(values, 'percent_checked')).toBe('50%');
    expect(evaluateRollup([], 'percent_checked')).toBe('0%');
  });

  it('preserves eager coercion errors even for a count aggregation', () => {
    const error = new Error('Cannot coerce this value');
    const broken = { toString: () => { throw error; } };

    expect(() => evaluateRollup([broken], 'count_all')).toThrow(error);
    expect(() => evaluateRollup([broken], 'earliest')).toThrow(error);
    expect(() => evaluateRollup([Symbol('opaque')], 'show_original')).toThrow(TypeError);
  });
});
