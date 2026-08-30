import { fetchConfiguration } from '../../shared/api/configuration';
import {
  defineStorageKey,
  readStorage,
  stringStorageCodec,
  writeStorage,
} from '../../shared/platform/browser-storage';


export const DEFAULT_INTERFACE_LANGUAGE = 'en';
export const INTERFACE_LANGUAGE_STORAGE_KEY = 'i18nextLng';
export const SUPPORTED_INTERFACE_LANGUAGES = Object.freeze(['en', 'es', 'fr', 'ca'] as const);


export type InterfaceLanguage = typeof SUPPORTED_INTERFACE_LANGUAGES[number];


interface I18nController {
  readonly resolvedLanguage?: string;
  changeLanguage(language: string): Promise<unknown>;
}


interface JsonResponseLike {
  readonly ok?: boolean;
  json(): Promise<unknown>;
}


interface ResolveLanguageOptions {
  readonly fetchConfig?: () => Promise<unknown>;
  readonly storage?: Storage | null;
}


const interfaceLanguageKey = defineStorageKey(
  INTERFACE_LANGUAGE_STORAGE_KEY,
  stringStorageCodec,
);
const supportedLanguages: ReadonlySet<string> = new Set(SUPPORTED_INTERFACE_LANGUAGES);


function isJsonResponseLike(value: unknown): value is JsonResponseLike {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { readonly json?: unknown }).json === 'function';
}


function configuredLanguage(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const settings = (value as { readonly settings?: unknown }).settings;
  if (typeof settings !== 'object' || settings === null) return undefined;
  return (settings as { readonly language?: unknown }).language;
}


export function normalizeInterfaceLanguage(value: unknown): InterfaceLanguage | null {
  if (typeof value !== 'string') return null;
  const language = value.trim().split('-', 1)[0]?.toLowerCase() ?? '';
  return supportedLanguages.has(language) ? language as InterfaceLanguage : null;
}


export function getStoredInterfaceLanguage(
  storage?: Storage | null,
): InterfaceLanguage | null {
  return normalizeInterfaceLanguage(readStorage(interfaceLanguageKey, storage));
}


export async function resolveInitialInterfaceLanguage(
  options: ResolveLanguageOptions = {},
): Promise<InterfaceLanguage> {
  const storedLanguage = getStoredInterfaceLanguage(options.storage);
  if (storedLanguage) return storedLanguage;

  const fetchConfig = options.fetchConfig ?? fetchConfiguration;
  try {
    const result = await fetchConfig();
    const config = isJsonResponseLike(result)
      ? (result.ok === false ? null : await result.json())
      : result;
    const language = normalizeInterfaceLanguage(configuredLanguage(config));
    if (language) return language;
  } catch {
    // English remains the deterministic default when configuration is unavailable.
  }

  return DEFAULT_INTERFACE_LANGUAGE;
}


export async function initializeInterfaceLanguage(
  i18n: I18nController,
  options?: ResolveLanguageOptions,
): Promise<InterfaceLanguage> {
  const language = await resolveInitialInterfaceLanguage(options);
  if (i18n.resolvedLanguage !== language) await i18n.changeLanguage(language);
  return language;
}


export async function setInterfaceLanguage(
  i18n: I18nController,
  value: unknown,
  storage?: Storage | null,
): Promise<InterfaceLanguage> {
  const language = normalizeInterfaceLanguage(value) ?? DEFAULT_INTERFACE_LANGUAGE;
  writeStorage(interfaceLanguageKey, language, storage);
  await i18n.changeLanguage(language);
  return language;
}
