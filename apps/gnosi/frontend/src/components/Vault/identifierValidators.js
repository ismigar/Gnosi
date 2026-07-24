/**
 * Validators for bibliographic identifiers (DOI / ISBN / PMID / arXiv / URL).
 *
 * Lightweight mirror of the backend normalizers (`_normalize_doi`, etc. in
 * `vault_routes.py`). Here they are only **booleans** — the frontend shows
 * immediate visual feedback when the user types an invalid value, before
 * any HTTP call.
 *
 * Rule of thumb: if they return `true`, the backend will probably accept them. If
 * they return `false`, we don't ask the backend (saves a roundtrip and improves UX).
 *
 * Edge cases (decision: be tolerant of common formats):
 *   - DOI can come as `10.xxxx/...` or `https://doi.org/10.xxxx/...`
 *   - ISBN-10 with a trailing X checksum
 *   - PMID is strictly numeric
 *   - arXiv has two formats: new (`YYMM.NNNNN[vN]`) and old (`category/YYMMNNN`)
 *   - URL: http(s):// + something
 */

const DOI_RE = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;
const ISBN_DIGITS_RE = /^(?:97[89]\d{10}|\d{9}[\dX])$/;
const PMID_RE = /^\d{1,9}$/;
const ARXIV_NEW_RE = /^\d{4}\.\d{4,6}(v\d+)?$/;
const ARXIV_OLD_RE = /^[a-z-]+(\.[A-Z]{2})?\/\d{7}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

export function isValidDOI(raw) {
    if (!raw || typeof raw !== 'string') return false;
    return DOI_RE.test(raw.trim());
}

export function isValidISBN(raw) {
    if (!raw || typeof raw !== 'string') return false;
    // `.toUpperCase()` because the ISBN-10 check digit X is valid both
    // uppercase and lowercase; without this a "...089x" was rejected (the
    // regex uses `[\dX]`) and the frontend was blocking the search before the call.
    const cleaned = raw.trim().replace(/[-\s]/g, '').toUpperCase();
    return ISBN_DIGITS_RE.test(cleaned);
}

export function isValidPMID(raw) {
    if (!raw || typeof raw !== 'string') return false;
    return PMID_RE.test(raw.trim());
}

export function isValidArxivId(raw) {
    if (!raw || typeof raw !== 'string') return false;
    const t = raw.trim().replace(/^arxiv:\s*/i, '');
    return ARXIV_NEW_RE.test(t) || ARXIV_OLD_RE.test(t);
}

export function isValidURL(raw) {
    if (!raw || typeof raw !== 'string') return false;
    return URL_RE.test(raw.trim());
}

/**
 * Centralized: takes the identifier type and value, returns
 * `{ valid: bool, hint: string | null }`. The hint is light copy
 * about why validation failed (for a tooltip or inline help).
 *
 * `valid` for an empty value is `true` because the modal wants to accept
 * blank fields (not all of them are mandatory).
 */
export function validateIdentifier(kind, raw) {
    if (!raw || !String(raw).trim()) return { valid: true, hint: null };
    switch (kind) {
        case 'doi':
            return isValidDOI(raw)
                ? { valid: true, hint: null }
                : { valid: false, hint: 'Format DOI esperat: 10.xxxx/yyyy' };
        case 'isbn':
            return isValidISBN(raw)
                ? { valid: true, hint: null }
                : { valid: false, hint: 'ISBN ha de tenir 10 o 13 dígits (X final acceptada a ISBN-10)' };
        case 'pmid':
            return isValidPMID(raw)
                ? { valid: true, hint: null }
                : { valid: false, hint: 'PMID només pot tenir dígits (p. ex. 29083320)' };
        case 'arxiv':
            return isValidArxivId(raw)
                ? { valid: true, hint: null }
                : { valid: false, hint: 'arXiv id esperat: 2103.00020 o cat.SUB/0703001' };
        case 'url':
            return isValidURL(raw)
                ? { valid: true, hint: null }
                : { valid: false, hint: 'URL ha de començar amb http:// o https://' };
        default:
            return { valid: true, hint: null };
    }
}
