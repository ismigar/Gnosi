import { fileResourceString } from './fileResourcePaths';

export interface StructuredAuthor {
  readonly cognom1: string;
  readonly cognom2: string;
  readonly nom: string;
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseAuthorsString(text: unknown): StructuredAuthor[] {
  return fileResourceString(text)
    .split(/\s*[;&]\s*/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((chunk) => {
      const inverted = chunk.match(/^([^,]+),\s*(.+)$/);
      if (inverted) {
        const surnames = (inverted[1] ?? '').trim().split(/\s+/);
        return {
          cognom1: surnames[0] || '',
          cognom2: surnames.slice(1).join(' '),
          nom: (inverted[2] ?? '').trim(),
        };
      }
      const tokens = chunk.split(/\s+/);
      if (tokens.length === 1) return { cognom1: tokens[0] ?? '', cognom2: '', nom: '' };
      if (tokens.length === 2) {
        return { cognom1: tokens[1] ?? '', cognom2: '', nom: tokens[0] ?? '' };
      }
      return {
        cognom1: tokens[1] ?? '',
        cognom2: tokens.slice(2).join(' '),
        nom: tokens[0] ?? '',
      };
    });
}

function authorField(author: Readonly<Record<string, unknown>>, key: string): string {
  return fileResourceString(author[key]).trim();
}

function formatAuthorToken(author: unknown, accessor: string): string {
  if (!isUnknownRecord(author)) return '';
  const firstSurname = authorField(author, 'cognom1');
  const secondSurname = authorField(author, 'cognom2');
  const name = authorField(author, 'nom');
  const surnames = [firstSurname, secondSurname].filter(Boolean).join(' ');
  if (accessor === 'cognom1') return firstSurname;
  if (accessor === 'cognom2') return secondSurname;
  if (accessor === 'cognom' || accessor === 'cognoms') return surnames;
  if (accessor === 'nom') return name;
  return [name, surnames].filter(Boolean).join(' ');
}

function isStructuredAuthor(value: unknown): boolean {
  return isUnknownRecord(value)
    && ('cognom1' in value || 'cognom2' in value || 'nom' in value);
}

export function interpolateNamePattern(
  pattern: unknown,
  metadata: Readonly<Record<string, unknown>> = {},
): string {
  if (!pattern || typeof pattern !== 'string') return '';
  const lookup = (field: string): unknown => {
    const key = field.trim();
    if (!key) return undefined;
    if (Object.prototype.hasOwnProperty.call(metadata, key)) return metadata[key];
    const lower = key.toLowerCase();
    const match = Object.keys(metadata).find((candidate) => candidate.toLowerCase() === lower);
    return match === undefined ? undefined : metadata[match];
  };

  const expanded = pattern.replace(/\{([^{}]+)\}/g, (_match, token: string) => {
    const trimmed = token.trim();
    let field = trimmed;
    let accessor = '';
    let value = lookup(field);
    if (value === undefined) {
      const dot = trimmed.indexOf('.');
      if (dot >= 0) {
        field = trimmed.slice(0, dot).trim();
        accessor = trimmed.slice(dot + 1).trim();
        value = lookup(field);
      }
    }
    if (value === undefined || value === null) return '';
    if (Array.isArray(value) && value.some(isStructuredAuthor)) {
      return value
        .map((author) => formatAuthorToken(author, accessor.trim()))
        .filter(Boolean)
        .join(', ');
    }
    const normalizedAccessor = accessor.trim();
    if (
      normalizedAccessor
      && ['nom', 'cognom', 'cognoms', 'cognom1', 'cognom2'].includes(normalizedAccessor)
    ) {
      const chunks: readonly unknown[] = Array.isArray(value) ? value : [value];
      if (chunks.length && chunks.every((chunk) => typeof chunk === 'string')) {
        const authors = chunks.flatMap((chunk) => parseAuthorsString(chunk));
        if (authors.length) {
          return authors
            .map((author) => formatAuthorToken(author, normalizedAccessor))
            .filter(Boolean)
            .join(', ');
        }
      }
    }
    return (Array.isArray(value) ? value.join(', ') : fileResourceString(value)).trim();
  });

  return expanded
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*-\s*-\s*/g, ' - ')
    .replace(/^[\s\-–—_]+|[\s\-–—_]+$/g, '')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim();
}
