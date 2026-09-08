import { describe, expect, it } from 'vitest';
import { releaseNotesUrl } from './releaseNotesUrl';

describe('public release history URL', () => {
    it.each([
        ['ca-ES', '.ca'], ['es_ES', '.es'], ['en', ''], ['fr', ''], [undefined, ''],
    ])('resolves %s to the available public locale', (locale, suffix) => {
        expect(releaseNotesUrl(locale, '2.0.6')).toBe(`https://ismigar.github.io/changelog${suffix}.html#v2.0.6`);
    });
});
