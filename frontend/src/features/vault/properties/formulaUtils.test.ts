import { describe, expect, it } from 'vitest';

import { evaluateFormula } from './formulaUtils';

describe('evaluateFormula imported metadata', () => {
  it('keeps brace coercion for nested objects, arrays and null', () => {
    const nested = { extension: { values: [null, ['one', 'two']] } };
    const array = [nested, null, ['one', 'two']];
    const metadata: Readonly<Record<string, unknown>> = {
      nested,
      array,
      empty: null,
    };

    expect(evaluateFormula('{nested}', metadata)).toBe('[object Object]');
    expect(evaluateFormula('{array}', metadata)).toBe('[object Object],,one,two');
    expect(evaluateFormula('{empty}', metadata)).toBe('');
    expect(evaluateFormula('{missing}', metadata)).toBe('');
    expect(metadata.nested).toBe(nested);
    expect(metadata.array).toBe(array);
    expect(array[0]).toBe(nested);
    expect(Object.isFrozen(array)).toBe(false);
  });

  it('preserves the distinct prop expression coercion and failure paths', () => {
    const metadata: Record<string, unknown> = {
      nested: { extension: [null] },
      singleton: [7],
      pair: [2, 3],
      empty: null,
      flag: true,
    };

    expect(evaluateFormula("prop('nested')", metadata)).toBeNull();
    expect(evaluateFormula("prop('singleton') + 1", metadata)).toBe(8);
    expect(evaluateFormula("prop('pair')", metadata)).toBe(3);
    expect(evaluateFormula("prop('empty')", metadata)).toBe('');
    expect(evaluateFormula("prop('flag')", metadata)).toBe(true);
    expect(evaluateFormula('{flag}', metadata)).toBe(1);
    expect(evaluateFormula("prop('title')", metadata, 'Quoted "title"')).toBe('Quoted "title"');
  });

  it('uses object text hooks without replacing their values and catches failures', () => {
    const token = { toString: () => ' 42 ' };
    const error = new Error('Cannot coerce this value');
    const broken = { toString: () => { throw error; } };
    const metadata: Record<string, unknown> = { token, broken };

    expect(evaluateFormula("prop('token') + 1", metadata)).toBe(43);
    expect(evaluateFormula('{token}', metadata)).toBe(' 42 ');
    expect(evaluateFormula('{broken}', metadata)).toBeNull();
    expect(evaluateFormula("prop('broken')", metadata)).toBeNull();
    expect(metadata.token).toBe(token);
    expect(metadata.broken).toBe(broken);
  });

  it('preserves opaque evaluator results and normalizes only nullish or nonfinite results', () => {
    expect(evaluateFormula('[1, [null, 2]]')).toEqual([1, [null, 2]]);
    expect(evaluateFormula('Object.fromEntries([["nested", [null, 2]]])')).toEqual({ nested: [null, 2] });
    expect(evaluateFormula('Symbol.for("formula-result")')).toBe(Symbol.for('formula-result'));
    expect(evaluateFormula('String')).toBe(String);
    expect(evaluateFormula('42n')).toBe(42n);
    expect(evaluateFormula('false')).toBe(false);
    expect(evaluateFormula('undefined')).toBeNull();
    expect(evaluateFormula('null')).toBeNull();
    expect(evaluateFormula('1 / 0')).toBeNull();
    expect(evaluateFormula('0 / 0')).toBeNull();
    expect(evaluateFormula({ expression: '1 + 1' })).toBeNull();
  });
});
