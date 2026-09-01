import { describe, expect, it } from 'vitest';

import {
    applyLocaleMetadata,
    buildLocaleRegistry,
    canonicalizeLocale,
    getIntlLocale,
    getLocaleMeta,
    resolveLocale,
    type LocaleDirection,
    type TranslationCatalogue,
} from './registry';

const syntheticLocaleModules = import.meta.glob<TranslationCatalogue>(
    './__fixtures__/*/translation.json',
    { eager: true, import: 'default' },
);

function catalogue(
    nativeName: string,
    intlLocale: string,
    direction: LocaleDirection = 'ltr',
    translation: TranslationCatalogue = {},
): TranslationCatalogue {
    return {
        _meta: {
            nativeName,
            intlLocale,
            direction,
        },
        ...translation,
    };
}

describe('locale registry', () => {
    it('discovers a synthetic locale from its catalogue path', () => {
        const fixtureModules = Object.fromEntries(Object.entries(syntheticLocaleModules).map(
            ([path, value]) => [path.replace('./__fixtures__/', './'), value],
        ));
        const registry = buildLocaleRegistry({
            './en/translation.json': catalogue('English', 'en-US', 'ltr', {
                greeting: 'Hello',
            }),
            ...fixtureModules,
            './pt-BR/translation.json': catalogue('Português (Brasil)', 'pt-BR', 'ltr', {
                greeting: 'Olá',
            }),
            './ar/translation.json': catalogue('العربية', 'ar', 'rtl', {
                greeting: 'مرحبًا',
            }),
        });

        expect(registry.availableLocales.map(({ code }) => code)).toEqual(
            expect.arrayContaining(['en', 'de', 'pt-BR', 'ar']),
        );
        expect(registry.localeResources.de?.translation.greeting).toBe('Hallo');
        expect(registry.localeResources['pt-BR']?.translation).toEqual({ greeting: 'Olá' });
        expect(registry.localeResources['pt-BR']?.translation).not.toHaveProperty('_meta');
        expect(registry.getLocaleMeta('ar').direction).toBe('rtl');
    });

    it('resolves exact locale, base language, and English fallback in order', () => {
        const registry = buildLocaleRegistry({
            './en/translation.json': catalogue('English', 'en-US'),
            './de/translation.json': catalogue('Deutsch', 'de-DE'),
            './pt-BR/translation.json': catalogue('Português (Brasil)', 'pt-BR'),
        });

        expect(registry.resolveLocale('pt-BR')).toBe('pt-BR');
        expect(registry.resolveLocale('de-AT')).toBe('de');
        expect(registry.resolveLocale('pt-PT')).toBe('en');
        expect(registry.resolveLocale('not_a_locale')).toBe('en');
    });

    it('accepts canonical BCP-47 tags and rejects non-canonical or duplicate codes', () => {
        expect(canonicalizeLocale('pt_br')).toBe('pt-BR');
        expect(canonicalizeLocale('invalid_locale_123')).toBeNull();

        expect(() => buildLocaleRegistry({
            './en/translation.json': catalogue('English', 'en-US'),
            './pt-br/translation.json': catalogue('Português', 'pt-BR'),
        })).toThrow(/canonical BCP-47/);

        expect(() => buildLocaleRegistry({
            './en/translation.json': catalogue('English', 'en-US'),
            './EN/translation.json': catalogue('English duplicate', 'en-US'),
        })).toThrow(/canonical BCP-47|Duplicate locale/);
    });

    it('applies Intl language and RTL direction to the document root', () => {
        const targetDocument = {
            documentElement: {
                lang: '',
                dir: '',
            },
        };

        applyLocaleMetadata({
            intlLocale: 'ar-EG',
            direction: 'rtl',
        }, targetDocument);

        expect(targetDocument.documentElement).toEqual({
            lang: 'ar-EG',
            dir: 'rtl',
        });
    });

    it('resolves production Intl metadata with English fallback', () => {
        expect(getIntlLocale('ca-ES')).toBe('ca-ES');
        expect(getIntlLocale('fr-CA')).toBe('fr-FR');
        expect(getIntlLocale('de-DE')).toBe('en-US');
        expect(resolveLocale('es-MX')).toBe('es');
        expect(getLocaleMeta('unknown').code).toBe('en');
    });
});
