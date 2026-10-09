import { describe, expect, it } from 'vitest';
import { columnLabel, evaluateSpreadsheetFormula as evaluate, translateFormula } from './spreadsheetFormula';
const context = { cell: (r: number, c: number) => [[2, 3], [4, 5]][r]?.[c] ?? '#REF!', field: (name: string) => new Map([['Price', 12], ['Quantity', 3]]).get(name) ?? '#REF!' };
describe('spreadsheet formulas', () => {
  it.each([
    ['=IF(FALSE,1/0,7)', 7], ['=IF(TRUE,7,Z999)', 7], ['=#REF!', '#REF!'],
    ['=1+2*3', 7], ['=(1+2)*3', 9], ['=2^3^2', 512], ['=-2^2', -4],
    ['=50%*20', 10], ['=SUM(A1:B2)', 14], ['=SUMA(A1;B2)', 7],
    ['=AVERAGE(A1:A2)', 3], ['=MIN(A1:B2)', 2], ['=MAX(A1:B2)', 5],
    ['=COUNT(A1:B2)', 4], ['=ROUND(1.234,2)', 1.23], ['=ABS(-3)', 3],
    ['=[Price]*[Quantity]', 36], ['={Price}*2', 24], ['=IF(A1>1,"yes","no")', 'yes'],
    ['="hello "&"world"', 'hello world'], ['=1/0', '#DIV/0!'], ['=Z999', '#REF!'],
    ['=UNKNOWN(1)', '#NAME?'], ['=SUM(A1:ZZ99999)', '#REF!'],
    ['=globalThis.alert(1)', '#NAME?'], ['=constructor.constructor("return 1")()', '#ERROR!'],
    ['=1;2', '#ERROR!'], ['="a"+1', '#VALUE!'], ['=2**3', '#NAME?'],
  ])('evaluates %s as %s', (formula, expected) => { expect(evaluate(formula, context)).toBe(expected); });
  it('rejects unbounded nesting and propagates dependency errors', () => {
    expect(evaluate(`=${'('.repeat(100)}1${')'.repeat(100)}`, context)).toBe('#ERROR!');
    expect(evaluate('=A1+2', { ...context, cell: () => '#CYCLE!' })).toBe('#CYCLE!');
  });
  it('translates relative references while preserving absolute and literal references', () => {
    expect(translateFormula('=A1+$B2+C$3+$D$4+SUM(A1:B2)', 2, 1)).toBe('=B3+$B4+D$3+$D$4+SUM(B3:C4)');
    expect(translateFormula('="A1"&[B2]&{C3}&A1', 1, 1)).toBe('="A1"&[B2]&{C3}&B2');
    expect(translateFormula('=A1', -1, 0)).toBe('=#REF!');
    expect(columnLabel(26)).toBe('AA');
  });
});
