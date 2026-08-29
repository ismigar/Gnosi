/** Pure helpers for ordered author lists used by the autoria field type. */
interface AuthorLike {
  cognom1?: string | null;
  cognom2?: string | null;
  nom?: string | null;
}

interface Author {
  cognom1: string;
  cognom2: string;
  nom: string;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readAuthorPart(author: Record<string, unknown>, key: string): string {
  const value = author[key];
  return typeof value === 'string' ? value : '';
}

export const emptyAuthor = (): Author => ({
  nom: '',
  cognom1: '',
  cognom2: '',
});

/** Pill-visible label: "Nom Cognom1 Cognom2". */
export const authorFullName = (
  author?: AuthorLike | null,
): string =>
  [author?.nom, author?.cognom1, author?.cognom2]
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .join(' ');

/** Search and tooltip label: "Surname1 Surname2, Name". */
export const authorSortLabel = (
  author?: AuthorLike | null,
): string => {
  const family = [author?.cognom1, author?.cognom2]
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .join(' ');
  const given = (author?.nom || '').trim();
  return [family, given].filter(Boolean).join(', ');
};

export const sameAuthor = (
  left?: AuthorLike | null,
  right?: AuthorLike | null,
): boolean =>
  left?.nom === right?.nom &&
  left?.cognom1 === right?.cognom1 &&
  left?.cognom2 === right?.cognom2;

/** Returns unique, non-empty authors from raw autoria cell values. */
export const dedupeAuthors = (
  values?: readonly unknown[] | null,
): Author[] => {
  const seen = new Set<string>();
  const out: Author[] = [];
  for (const value of values || []) {
    if (!isUnknownArray(value)) continue;
    for (const candidate of value) {
      if (!isUnknownRecord(candidate)) continue;
      const nom = readAuthorPart(candidate, 'nom');
      const cognom1 = readAuthorPart(candidate, 'cognom1');
      const cognom2 = readAuthorPart(candidate, 'cognom2');
      const key = `${nom}|${cognom1}|${cognom2}`;
      if (key === '||' || seen.has(key)) continue;
      seen.add(key);
      out.push({ nom, cognom1, cognom2 });
    }
  }
  return out;
};
