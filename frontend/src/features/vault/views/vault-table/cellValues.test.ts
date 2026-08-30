import { afterEach, describe, expect, it, vi } from 'vitest';
import { cellNode, metadataDate, tableCell, tableClipboard, tableText } from './cellValues';

afterEach(() => { vi.unstubAllGlobals(); });

describe('table value boundaries', () => {
  it('preserves native date coercion for numbers, null, Date and imported objects', () => {
    const date = new Date('2026-08-12T10:00:00Z');
    expect(metadataDate(null).getTime()).toBe(0);
    expect(metadataDate(1000).getTime()).toBe(1000);
    expect(metadataDate(date).getTime()).toBe(date.getTime());
    expect(metadataDate(date)).not.toBe(date);
    expect(metadataDate({ [Symbol.toPrimitive]: () => 2000 }).getTime()).toBe(2000);
    expect(metadataDate('invalid').getTime()).toBeNaN();
    expect(() => metadataDate(Symbol('invalid'))).toThrow(TypeError);
  });

  it('keeps valid scalar and nested array children without stringifying objects', () => {
    const value = ['Mercè', [3, null, false, 4n], undefined];
    expect(cellNode(value)).toEqual(value);
    expect(() => cellNode({ title: 'not a React child' })).toThrow('Objects are not valid');
    expect(() => cellNode([Symbol('invalid')])).toThrow('Objects are not valid');
  });

  it('admits only concrete string cell identifiers, retaining empty strings', () => {
    expect(tableCell({ rowId: 'a', field: 'Score' })).toEqual({ rowId: 'a', field: 'Score' });
    expect(tableCell({ rowId: '', field: '' })).toEqual({ rowId: '', field: '' });
    expect(tableCell({ rowId: 1, field: 'Score' })).toBeNull();
    expect(tableCell(null)).toBeNull();
  });

  it('retains display coercion and the original clipboard receiver', () => {
    expect(tableText(null)).toBe('');
    expect(tableText([1, 'two'])).toBe('1,two');
    expect(tableText({ toString: () => 'plugin value' })).toBe('plugin value');
    const clipboard = { writeText: vi.fn() };
    vi.stubGlobal('navigator', { clipboard });
    expect(tableClipboard()).toBe(clipboard);
    vi.stubGlobal('navigator', {});
    expect(tableClipboard()).toBeUndefined();
  });
});
