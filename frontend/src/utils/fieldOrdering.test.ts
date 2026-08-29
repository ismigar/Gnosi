import { describe, expect, it } from 'vitest';
import { sortFieldItems } from './fieldOrdering';

describe('sortFieldItems', () => {
    it('sorts field labels without mutating the supplied array', () => {
        const fields = [
            { id: '3', name: 'zeta' },
            { id: '2', name: 'Àrea' },
            { id: '1', name: 'Alpha' },
        ];

        expect(
            sortFieldItems(fields, (field) => field.name, 'ca')
                .map((field) => field.name),
        ).toEqual(['Alpha', 'Àrea', 'zeta']);
        expect(fields.map((field) => field.name)).toEqual(['zeta', 'Àrea', 'Alpha']);
    });
});
