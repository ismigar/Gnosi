import type { LiteratureJson, LiteratureWork } from '../../shared/api/literature';
import type {
  LiteratureFilters,
  LiteratureSearchView,
  LiteratureWorkView,
} from './literatureTypes';
import { asWork, isRecord } from './literatureTypes';

export const EMPTY_FILTERS: LiteratureFilters = {
  date_from: '',
  date_to: '',
  full_text: null,
  languages: [],
  open_access: null,
  peer_reviewed: null,
  type: '',
};

export const LANGUAGE_OPTIONS: readonly (readonly [string, string])[] = [
  ['ca', 'Català'],
  ['es', 'Español'],
  ['en', 'English'],
  ['fr', 'Français'],
  ['pt', 'Português'],
  ['de', 'Deutsch'],
  ['it', 'Italiano'],
];

export const SEARCH_PAGE_SIZE = 50;
export const TERMINAL_SEARCH_STATES = new Set(['completed', 'cancelled', 'failed']);
export const SEARCH_EVENTS = [
  'source.started',
  'source.completed',
  'source.failed',
  'search.completed',
  'search.cancelled',
  'search.failed',
] as const;

export function authorLine(work: LiteratureWorkView): string {
  return (work.authors ?? []).map((author) => (
    author.literal ?? [author.given, author.family].filter(Boolean).join(' ')
  )).filter(Boolean).join('; ');
}

export function aiText(value: unknown, language: string): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => aiText(item, language)).filter(Boolean).join(' · ');
  }
  if (isRecord(value)) {
    const locale = language.split('-')[0] ?? '';
    const localized = value[locale] ?? value.en
      ?? Object.values(value).find((item) => typeof item === 'string') ?? '';
    return aiText(localized, language);
  }
  return '';
}

export function filtersFromSearch(value: LiteratureJson | undefined): LiteratureFilters {
  const source = value ?? {};
  const legacyLanguage = typeof source.language === 'string' ? source.language : '';
  const legacyLanguages = legacyLanguage
    .split(/[,;\s]+/)
    .filter(Boolean);
  const languages = Array.isArray(source.languages)
    ? source.languages.filter((item): item is string => typeof item === 'string')
    : legacyLanguages;
  return {
    ...EMPTY_FILTERS,
    ...source,
    date_from: typeof source.date_from === 'string' ? source.date_from : '',
    date_to: typeof source.date_to === 'string' ? source.date_to : '',
    full_text: typeof source.full_text === 'boolean' ? source.full_text : null,
    languages,
    open_access: typeof source.open_access === 'boolean' ? source.open_access : null,
    peer_reviewed: typeof source.peer_reviewed === 'boolean'
      ? source.peer_reviewed
      : null,
    type: typeof source.type === 'string' ? source.type : '',
  };
}

export function searchWorks(
  search: LiteratureSearchView | null,
): readonly LiteratureWorkView[] {
  return (search?.results ?? []).map(asWork);
}

export function rankWorks(
  works: readonly LiteratureWork[],
  ranking: ReadonlyMap<string, { readonly original_rank?: number; readonly semantic_rank?: number }>,
): LiteratureWorkView[] {
  return works.map((item) => {
    const work = asWork(item);
    const rank = ranking.get(work.id);
    return {
      ...work,
      original_rank: rank?.original_rank,
      semantic_rank: rank?.semantic_rank,
    };
  }).sort((left, right) => (
    (left.semantic_rank ?? Number.MAX_SAFE_INTEGER)
    - (right.semantic_rank ?? Number.MAX_SAFE_INTEGER)
  ));
}
