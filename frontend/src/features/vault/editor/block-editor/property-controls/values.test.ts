import { describe, expect, it } from 'vitest';
import { foldAccents, readPropertyOptions, readPropertyValues } from './values';

describe('editor property value compatibility', () => {
    it.each([
        [undefined, []], [null, []], ['', []], [false, []], [0, []],
        ['Mercè', ['Mercè']], ['"Mercè"', ['Mercè']],
        ['["Mercè","Història"]', ['Mercè', 'Història']],
        [['Mercè', 'Història'], ['Mercè', 'Història']],
        ['0', [0]], ['false', [false]], ['null', [null]],
        ['[0,false,null,"Mercè"]', [0, false, null, 'Mercè']],
        ['[not json', ['[not json']],
    ])('decodes %j without changing scalar identity', (input, expected) => {
        expect(readPropertyValues(input)).toEqual(expected);
    });

    it('copies arrays and never silently drops invalid object-valued metadata', () => {
        const source = ['Mercè'];
        expect(readPropertyValues(source)).not.toBe(source);
        expect(() => readPropertyValues('[{"name":"Mercè"}]')).toThrow(TypeError);
        expect(() => readPropertyValues([{ name: 'Mercè' }])).toThrow(TypeError);
    });

    it('retains ordering, duplicates, exact names and last rich color, without assigning colors to legacy options', () => {
        const { optionKeys, optionColorByKey } = readPropertyOptions([
            'Legacy', { name: 'Educació', color: 'blue' }, '', null, {},
            { name: 'Educació', color: 'pink' }, { name: '  Nou  ' }, 0, false,
        ]);
        expect(optionKeys).toEqual(['Legacy', 'Educació', 'Educació', '  Nou  ', '0', 'false']);
        expect(optionColorByKey).toEqual({ Educació: 'pink', '  Nou  ': null });
        expect(readPropertyOptions(null).optionKeys).toEqual([]);
    });

    it('folds Catalan accents and case for display titles without trimming the input', () => {
        expect(foldAccents('EDUCACIÓ')).toBe('educacio');
        expect(foldAccents('Història')).toBe('historia');
        expect(foldAccents(' Nou ')).toBe(' nou ');
    });
});
