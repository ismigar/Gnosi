import * as blockNoteLocales from '@blocknote/core/locales';
import { describe, expect, it } from 'vitest';

import { localeExportName, resolveBlockNoteDictionary } from './registry';
import { blocknoteCa } from './ca';

describe('BlockNote locale resolver', () => {
    it('uses the custom Catalan dictionary', () => {
        expect(resolveBlockNoteDictionary('ca-ES')).toBe(blocknoteCa);
    });

    it('uses an official package locale when available', () => {
        expect(resolveBlockNoteDictionary('fr-FR')).toBe(blockNoteLocales.fr);
    });

    it('falls back to English for unsupported locales', () => {
        expect(resolveBlockNoteDictionary('de-DE')).toBe(blockNoteLocales.en);
    });

    it('maps BCP-47 regions to BlockNote export names', () => {
        expect(localeExportName('zh-TW')).toBe('zhTW');
    });
});
