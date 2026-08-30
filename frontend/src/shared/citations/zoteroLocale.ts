import { getLocaleMeta } from '../i18n/locales/registry';

/** Resolve a react-i18next language to a Zotero locale code. */
export function uiLangToZoteroLocale(
  uiLanguage?: string,
): string {
  const localeMeta: unknown = getLocaleMeta(uiLanguage);
  if (
    typeof localeMeta === 'object' &&
    localeMeta !== null &&
    'zoteroLocale' in localeMeta &&
    typeof localeMeta.zoteroLocale === 'string' &&
    localeMeta.zoteroLocale
  ) {
    return localeMeta.zoteroLocale;
  }
  return 'en-US';
}
