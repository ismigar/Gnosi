/**
 * Validators d'identificadors bibliogràfics (DOI / ISBN / PMID / arXiv / URL).
 *
 * Mirall lleuger dels normalitzadors del backend (`_normalize_doi`, etc. a
 * `vault_routes.py`). Aquí només són **booleans** — el frontend mostra
 * feedback visual immediat quan l'usuari escriu un valor invàlid, abans
 * de cap crida HTTP.
 *
 * Lema: si retornen `true`, el backend probablement els acceptarà. Si
 * retornen `false`, no demano al backend (estalvia roundtrip i UX).
 *
 * Casos límit (decisió: ser tolerant amb formats comuns):
 *   - DOI pot venir com a `10.xxxx/...` o `https://doi.org/10.xxxx/...`
 *   - ISBN-10 amb checksum X final
 *   - PMID és estrictament numèric
 *   - arXiv té dos formats: nou (`YYMM.NNNNN[vN]`) i antic (`category/YYMMNNN`)
 *   - URL: http(s):// + alguna cosa
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
    // `.toUpperCase()` perquè el dígit de control X de l'ISBN-10 és vàlid tant
    // en majúscula com en minúscula; sense això un "...089x" es rebutjava (el
    // regex usa `[\dX]`) i el frontend bloquejava la cerca abans de la crida.
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
 * Centralitzat: rep el tipus d'identificador i el valor, retorna
 * `{ valid: bool, hint: string | null }`. El hint és copy lleuger
 * sobre per què la validació ha fallat (per a tooltip o ajuda inline).
 *
 * `valid` per a un valor buit és `true` perquè el modal vol acceptar
 * camps en blanc (no tots són obligatoris).
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
