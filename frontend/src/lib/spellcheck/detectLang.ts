// Idiomes suportats pel corrector (diccionaris Hunspell a /public/dictionaries).
export const SUPPORTED_LANGS = ['ca', 'es', 'en'] as const;


export type SupportedLanguage = typeof SUPPORTED_LANGS[number];


export const LANG_LABELS: Readonly<Record<SupportedLanguage, string>> = {
  ca: 'Català',
  es: 'Castellà',
  en: 'Anglès',
};


const ISO3_TO_LANG: Readonly<Partial<Record<string, SupportedLanguage>>> = {
  cat: 'ca',
  spa: 'es',
  eng: 'en',
};


/**
 * Detects the language of a text among Catalan/Spanish/English.
 * Returns a supported code, or `null` if there is not enough text to decide.
 */
export async function detectLang(
  text: string | null | undefined,
): Promise<SupportedLanguage | null> {
  const clean = (text ?? '').trim();
  if (clean.length < 12) return null;
  const { franc } = await import('franc');
  const iso3 = franc(clean, { only: ['cat', 'spa', 'eng'], minLength: 12 });
  return ISO3_TO_LANG[iso3] ?? null;
}
