import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { removeStorage } from '../../shared/platform/browser-storage';
import {
  PERSONAL_WORDS_STORAGE_KEY,
  addPersonalWord,
  getPersonalWords,
  loadSpeller,
} from './nspellManager';


describe('personal spell-check dictionary', () => {
  beforeEach(() => {
    removeStorage(PERSONAL_WORDS_STORAGE_KEY);
  });

  afterEach(() => {
    removeStorage(PERSONAL_WORDS_STORAGE_KEY);
  });

  it('normalizes, persists, and deduplicates personal words', () => {
    addPersonalWord('  Gnosi  ');
    addPersonalWord('Gnosi');
    addPersonalWord('');

    expect(getPersonalWords()).toEqual(['Gnosi']);
  });

  it('does not load a dictionary for an unsupported language', async () => {
    await expect(loadSpeller('fr')).resolves.toBeNull();
  });
});
