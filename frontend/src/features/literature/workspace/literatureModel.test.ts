import { describe, expect, it } from 'vitest';

import { aiText, filtersFromSearch, rankWorks } from './literatureModel';
import type { LiteratureWorkView } from './literatureTypes';

const firstWork: LiteratureWorkView = { id: 'first', title: 'First work' };
const secondWork: LiteratureWorkView = { id: 'second', title: 'Second work' };

describe('literatureModel', () => {
  it('preserves legacy language filters when opening historical searches', () => {
    expect(filtersFromSearch({ language: 'ca, es en' }).languages).toEqual([
      'ca',
      'es',
      'en',
    ]);
  });

  it('selects localized AI text with the historical English fallback', () => {
    expect(aiText({ en: 'Evidence', fr: 'Preuves' }, 'fr-FR')).toBe('Preuves');
    expect(aiText({ en: 'Evidence' }, 'ca')).toBe('Evidence');
  });

  it('reranks works without discarding their original API payload', () => {
    const ranked = rankWorks([firstWork, secondWork], new Map([
      ['first', { original_rank: 1, semantic_rank: 2 }],
      ['second', { original_rank: 2, semantic_rank: 1 }],
    ]));
    expect(ranked.map((work) => work.id)).toEqual(['second', 'first']);
    expect(ranked[0]).toMatchObject({ original_rank: 2, semantic_rank: 1 });
  });
});
