// Idiomes suportats pel corrector (diccionaris Hunspell a /public/dictionaries).
export const SUPPORTED_LANGS = ['ca', 'es', 'en'];

export const LANG_LABELS = {
    ca: 'Català',
    es: 'Castellà',
    en: 'Anglès',
};

const ISO3_TO_LANG = { cat: 'ca', spa: 'es', eng: 'en' };

/**
 * Detects the language of a text among Catalan/Spanish/English.
 * Returns a SUPPORTED_LANGS code, or `null` if there isn't enough text to decide
 * (the caller decides the fallback, usually keeping the current language).
 *
 * Uses `franc` (the full version), not `franc-min`: the reduced model classifies ALL
 * Catalan as Spanish. It's lazy-loaded together with the spell checker.
 */
export async function detectLang(text) {
    const clean = (text || '').trim();
    if (clean.length < 12) return null; // massa curt → indecidible
    const { franc } = await import('franc');
    const iso3 = franc(clean, { only: ['cat', 'spa', 'eng'], minLength: 12 });
    return ISO3_TO_LANG[iso3] || null;
}
