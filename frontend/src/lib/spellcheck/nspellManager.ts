import type { Hunspell, HunspellFactory } from 'hunspell-asm';

import { transportFetch } from '../../shared/api/transports';
import {
  defineStorageKey,
  jsonStorageCodec,
  readStorage,
  writeStorage,
} from '../../shared/platform/browser-storage';
import {
  SUPPORTED_LANGS,
  type SupportedLanguage,
} from './detectLang';


export interface Speller {
  add(word: string): void;
  correct(word: string): boolean;
  suggest(word: string): string[];
}


type HunspellLoader = () => Promise<HunspellFactory>;


function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((item: unknown) => typeof item === 'string');
}


export const PERSONAL_WORDS_STORAGE_KEY = defineStorageKey(
  'gnosi_spell_personal',
  jsonStorageCodec(isStringArray),
);


let factoryPromise: Promise<HunspellFactory> | null = null;
const cache = new Map<SupportedLanguage, Promise<Speller | null>>();
const instances = new Map<SupportedLanguage, Speller>();


function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}


function isHunspellLoader(value: unknown): value is HunspellLoader {
  return typeof value === 'function';
}


function resolveLoader(moduleValue: unknown): HunspellLoader {
  if (!isRecord(moduleValue)) {
    throw new TypeError('Hunspell module has an invalid shape');
  }
  if (isHunspellLoader(moduleValue.loadModule)) return moduleValue.loadModule;
  const defaultExport = moduleValue.default;
  if (isHunspellLoader(defaultExport)) return defaultExport;
  if (isRecord(defaultExport) && isHunspellLoader(defaultExport.loadModule)) {
    return defaultExport.loadModule;
  }
  throw new TypeError('Hunspell module does not expose a loader');
}


function getFactory(): Promise<HunspellFactory> {
  factoryPromise ??= import('hunspell-asm/dist/cjs/index.js')
    .then((moduleValue: unknown) => resolveLoader(moduleValue)());
  return factoryPromise;
}


function isSupportedLanguage(value: string): value is SupportedLanguage {
  return SUPPORTED_LANGS.some((language) => language === value);
}


/** Words added by the user, shared across spell-check languages. */
export function getPersonalWords(): string[] {
  return readStorage(PERSONAL_WORDS_STORAGE_KEY) ?? [];
}


function savePersonalWords(words: readonly string[]): void {
  writeStorage(PERSONAL_WORDS_STORAGE_KEY, [...new Set(words)]);
}


export function addPersonalWord(word: string | null | undefined): void {
  const normalized = (word ?? '').trim();
  if (!normalized) return;
  const words = getPersonalWords();
  if (!words.includes(normalized)) {
    words.push(normalized);
    savePersonalWords(words);
  }
  for (const speller of instances.values()) {
    try {
      speller.add(normalized);
    } catch {
      // A failed runtime dictionary update must not interrupt the editor.
    }
  }
}


function makeAdapter(hunspell: Hunspell): Speller {
  return {
    add(word) {
      try {
        hunspell.addWord(word);
      } catch {
        // Personal words remain persisted for the next loaded instance.
      }
    },
    correct(word) {
      try {
        return hunspell.spell(word);
      } catch {
        return true;
      }
    },
    suggest(word) {
      try {
        return hunspell.suggest(word);
      } catch {
        return [];
      }
    },
  };
}


export function loadSpeller(language: string): Promise<Speller | null> {
  if (!isSupportedLanguage(language)) return Promise.resolve(null);
  const cached = cache.get(language);
  if (cached) return cached;

  const baseUrl = import.meta.env.BASE_URL || '/';
  const promise = (async (): Promise<Speller | null> => {
    try {
      const [factory, affBuffer, dictionaryBuffer] = await Promise.all([
        getFactory(),
        transportFetch(`${baseUrl}dictionaries/${language}.aff`).then(
          (response) => {
            if (!response.ok) throw new Error(`aff ${String(response.status)}`);
            return response.arrayBuffer();
          },
        ),
        transportFetch(`${baseUrl}dictionaries/${language}.dic`).then(
          (response) => {
            if (!response.ok) throw new Error(`dic ${String(response.status)}`);
            return response.arrayBuffer();
          },
        ),
      ]);
      const affPath = factory.mountBuffer(
        new Uint8Array(affBuffer),
        `${language}.aff`,
      );
      const dictionaryPath = factory.mountBuffer(
        new Uint8Array(dictionaryBuffer),
        `${language}.dic`,
      );
      const adapter = makeAdapter(factory.create(affPath, dictionaryPath));
      for (const word of getPersonalWords()) adapter.add(word);
      instances.set(language, adapter);
      return adapter;
    } catch (error: unknown) {
      cache.delete(language);
      console.warn(
        `[spellcheck] could not load dictionary "${language}":`,
        error,
      );
      return null;
    }
  })();

  cache.set(language, promise);
  return promise;
}


export function getReadySpeller(language: string): Speller | null {
  return isSupportedLanguage(language)
    ? (instances.get(language) ?? null)
    : null;
}
