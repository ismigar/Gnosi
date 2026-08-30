import { describe, expect, it } from 'vitest';

import { shareExpirationDays, sharePublicUrl } from './shareModalModel';


describe('shareModalModel', () => {
    it('builds public URLs without duplicate separators', () => {
        expect(sharePublicUrl('https://gnosi.test/', 'token-1'))
            .toBe('https://gnosi.test/s/token-1');
    });

    it('accepts only positive integer expiration values', () => {
        expect(shareExpirationDays('30')).toBe(30);
        expect(shareExpirationDays('0')).toBeUndefined();
        expect(shareExpirationDays('-2')).toBeUndefined();
        expect(shareExpirationDays('')).toBeUndefined();
    });
});
