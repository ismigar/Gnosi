const DOI_RE = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;
const ISBN_DIGITS_RE = /^(?:97[89]\d{10}|\d{9}[\dX])$/;
const PMID_RE = /^\d{1,9}$/;
const ARXIV_NEW_RE = /^\d{4}\.\d{4,6}(v\d+)?$/;
const ARXIV_OLD_RE = /^[a-z-]+(\.[A-Z]{2})?\/\d{7}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

type IdentifierValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

interface IdentifierValidation {
  hint: string | null;
  valid: boolean;
}

export function isValidDOI(raw?: unknown): boolean {
  return typeof raw === 'string' && Boolean(raw) && DOI_RE.test(raw.trim());
}

export function isValidISBN(raw?: unknown): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const cleaned = raw.trim().replace(/[-\s]/g, '').toUpperCase();
  return ISBN_DIGITS_RE.test(cleaned);
}

export function isValidPMID(raw?: unknown): boolean {
  return typeof raw === 'string' && Boolean(raw) && PMID_RE.test(raw.trim());
}

export function isValidArxivId(raw?: unknown): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const text = raw.trim().replace(/^arxiv:\s*/i, '');
  return ARXIV_NEW_RE.test(text) || ARXIV_OLD_RE.test(text);
}

export function isValidURL(raw?: unknown): boolean {
  return typeof raw === 'string' && Boolean(raw) && URL_RE.test(raw.trim());
}

export function validateIdentifier(
  kind?: string | null,
  raw?: IdentifierValue,
): IdentifierValidation {
  if (!raw || !String(raw).trim()) return { valid: true, hint: null };
  switch (kind) {
    case 'doi':
      return isValidDOI(raw)
        ? { valid: true, hint: null }
        : {
            valid: false,
            hint: 'Expected DOI format: 10.xxxx/yyyy',
          };
    case 'isbn':
      return isValidISBN(raw)
        ? { valid: true, hint: null }
        : {
            valid: false,
            hint: 'ISBN must contain 10 or 13 digits (a final X is accepted for ISBN-10)',
          };
    case 'pmid':
      return isValidPMID(raw)
        ? { valid: true, hint: null }
        : {
            valid: false,
            hint: 'PMID may contain digits only (for example, 29083320)',
          };
    case 'arxiv':
      return isValidArxivId(raw)
        ? { valid: true, hint: null }
        : {
            valid: false,
            hint: 'Expected arXiv ID: 2103.00020 or cat.SUB/0703001',
          };
    case 'url':
      return isValidURL(raw)
        ? { valid: true, hint: null }
        : {
            valid: false,
            hint: 'URL must start with http:// or https://',
          };
    default:
      return { valid: true, hint: null };
  }
}
