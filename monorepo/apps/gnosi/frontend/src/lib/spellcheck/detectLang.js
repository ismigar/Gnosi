// Idiomes suportats pel corrector (diccionaris Hunspell a /public/dictionaries).
export const SUPPORTED_LANGS = ['ca', 'es', 'en'];

export const LANG_LABELS = {
    ca: 'Català',
    es: 'Castellà',
    en: 'Anglès',
};

const ISO3_TO_LANG = { cat: 'ca', spa: 'es', eng: 'en' };

/**
 * Detecta l'idioma d'un text entre català/castellà/anglès.
 * Retorna un codi de SUPPORTED_LANGS o `null` si no hi ha prou text per decidir
 * (el qui crida decideix el fallback, normalment mantenir l'idioma actual).
 *
 * Usa `franc` (complet), no `franc-min`: el model reduït classifica TOT el
 * català com a castellà. Es carrega de forma mandrosa amb el corrector.
 */
export async function detectLang(text) {
    const clean = (text || '').trim();
    if (clean.length < 12) return null; // massa curt → indecidible
    const { franc } = await import('franc');
    const iso3 = franc(clean, { only: ['cat', 'spa', 'eng'], minLength: 12 });
    return ISO3_TO_LANG[iso3] || null;
}
