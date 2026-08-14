import { describe, expect, it } from 'vitest';

import { orderGroupKeys } from './groupOrderUtils';

const EMPTY = '__empty__';
const keys = ['FET', 'EN PROGRÉS', 'PER FER', EMPTY];

describe('orderGroupKeys', () => {
    it('reverses catalog groups in descending order and keeps the empty group last', () => {
        expect(orderGroupKeys({ keys, direction: 'desc', emptyKey: EMPTY })).toEqual([
            'PER FER',
            'EN PROGRÉS',
            'FET',
            EMPTY,
        ]);
    });

    it('sorts group labels alphabetically in both directions', () => {
        const getLabel = key => ({ FET: 'Done', 'EN PROGRÉS': 'In progress', 'PER FER': 'To do' })[key];

        expect(orderGroupKeys({ keys, mode: 'alpha', emptyKey: EMPTY, getLabel })).toEqual([
            'FET',
            'EN PROGRÉS',
            'PER FER',
            EMPTY,
        ]);
        expect(orderGroupKeys({ keys, mode: 'alpha', direction: 'desc', emptyKey: EMPTY, getLabel })).toEqual([
            'PER FER',
            'EN PROGRÉS',
            'FET',
            EMPTY,
        ]);
    });

    it('sorts by record count in both directions', () => {
        const counts = { FET: 3, 'EN PROGRÉS': 1, 'PER FER': 2, [EMPTY]: 8 };
        const getCount = key => counts[key];

        expect(orderGroupKeys({ keys, mode: 'count', emptyKey: EMPTY, getCount })).toEqual([
            'EN PROGRÉS',
            'PER FER',
            'FET',
            EMPTY,
        ]);
        expect(orderGroupKeys({ keys, mode: 'count', direction: 'desc', emptyKey: EMPTY, getCount })).toEqual([
            'FET',
            'PER FER',
            'EN PROGRÉS',
            EMPTY,
        ]);
    });
});
