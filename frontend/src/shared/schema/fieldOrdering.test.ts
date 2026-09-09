import { describe, expect, it } from 'vitest';
import { sortFieldItems } from './fieldOrdering';

describe('sortFieldItems', () => {
    it('keeps natural numbers, accent-insensitive ties and the original records', () => {
        const fields = ['Notes 10', 'notes 2', 'Àrea', 'area', 'Notes 1'].map(name => ({ name }));
        expect(sortFieldItems(fields, field => field.name, 'ca')).toEqual([
            fields[2], fields[3], fields[4], fields[1], fields[0],
        ]);
    });

    it('uses the requested locale on each call and handles empty or singleton inputs', () => {
        const fields = ['Zeta', 'Äpple', 'Aardvark'];
        expect(sortFieldItems(fields, value => value, 'sv')).toEqual(['Aardvark', 'Zeta', 'Äpple']);
        expect(sortFieldItems(fields, value => value, 'de')).toEqual(['Aardvark', 'Äpple', 'Zeta']);
        expect(sortFieldItems(null)).toEqual([]);
        const single = [{ id: 'only' }];
        expect(sortFieldItems(single)).toEqual(single);
        expect(sortFieldItems(single)).not.toBe(single);
    });
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
