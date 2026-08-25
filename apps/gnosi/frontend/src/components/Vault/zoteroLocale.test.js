import { describe, expect, it } from 'vitest';

import { uiLangToZoteroLocale } from './zoteroLocale';

describe('Zotero locale resolver', () => {
    it('uses declarative Zotero metadata', () => {
        expect(uiLangToZoteroLocale('ca-ES')).toBe('ca-AD');
        expect(uiLangToZoteroLocale('fr-FR')).toBe('fr-FR');
    });

    it('falls back to en-US for unsupported locales', () => {
        expect(uiLangToZoteroLocale('de-DE')).toBe('en-US');
    });
});
