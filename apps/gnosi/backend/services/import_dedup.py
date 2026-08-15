"""Deduplication in `POST /import-references`.

Pure functions (no FastAPI / network / FS). Compares each entry in the
BibTeX/RIS file against the vault using 4 criteria (in priority order):

  1. Identical Citation Key
  2. Normalized DOI
  3. Normalized ISBN
  4. Normalized title (lowercase, no accents/punctuation)

If an entry matches, the caller marks it as "skipped" and logs
the reason for user feedback.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional


# ---------- Identifier normalizers (deliberate duplication) ----------
# These utilities also live in `vault_routes.py`. We duplicate them here
# to keep the module pure (imported by tests without FastAPI). If in a
# later iteration they get centralized, candidate: `backend/services/identifier_normalizers.py`.

_DOI_RE = re.compile(r'10\.\d{4,9}/[-._;()/:A-Z0-9]+', re.IGNORECASE)


def _normalize_doi(raw: str) -> Optional[str]:
    if not raw:
        return None
    m = _DOI_RE.search(raw)
    return m.group(0) if m else None


def _normalize_isbn(raw: str) -> Optional[str]:
    if not raw:
        return None
    cleaned = re.sub(r'[-\s]', '', raw)
    m = re.search(r'97[89]\d{10}|\d{9}[\dX]', cleaned)
    return m.group(0) if m else None


# ---------- Title normalizer for deduplication ----------

def normalize_title_for_dedup(title) -> str:
    """Aggressive equivalence: lowercase, accents/punctuation stripped, spaces collapsed.

    More tolerant than strict equality; it can produce an occasional false positive
    with generic titles ("Introduction", "Editorial") but the risk of a
    duplicate import is costlier than an occasional skip. The user can always
    review `skipped_details` to decide whether to force the creation manually.
    
    """
    if not title or not isinstance(title, str):
        return ""
    t = unicodedata.normalize('NFKD', title)
    t = ''.join(c for c in t if not unicodedata.combining(c))
    t = t.lower()
    t = re.sub(r'[^a-z0-9\s]', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t


# ---------- Matcher principal ----------

def find_existing_match(
    entry: dict,
    dedup: dict,
    vault_keys: set,
) -> Optional[tuple]:
    """Returns `(reason, existing_key)` if the entry matches a
    page already existing in the vault; `None` if it's new.

    `dedup` is the result of `build_indexes_from_records(...)`:
        {'doi': {doi_norm_lower: ck}, 'isbn': {isbn_norm: ck}, 'title': {t_norm: ck}}

    `vault_keys` is the set of existing citation keys.

    Priority order: citation_key > DOI > ISBN > title. Goes from the most
    authoritative to the most tolerant to minimize false positives.
    
    """
    ck = (entry.get('Citation Key') or '').strip()
    if ck and ck in vault_keys:
        return ('citation_key', ck)

    doi = (entry.get('DOI') or '').strip()
    if doi:
        norm = _normalize_doi(doi)
        if norm:
            existing = dedup.get('doi', {}).get(norm.lower())
            if existing:
                return ('doi', existing)

    isbn = (entry.get('ISBN') or '').strip()
    if isbn:
        norm = _normalize_isbn(isbn)
        if norm:
            existing = dedup.get('isbn', {}).get(norm)
            if existing:
                return ('isbn', existing)

    title = entry.get('Title') or ''
    tnorm = normalize_title_for_dedup(title)
    if tnorm:
        existing = dedup.get('title', {}).get(tnorm)
        if existing:
            return ('title', existing)

    return None


def add_to_indexes(entry: dict, ck: str, dedup: dict) -> None:
    """After creating a page, add its identifiers to the
    auxiliary indexes so the **same import** doesn't create internal duplicates
    (two entries in the file with the same DOI/ISBN/title).

    Idempotent: `setdefault` doesn't overwrite if the key is already present.
    
    """
    doi = (entry.get('DOI') or '').strip()
    if doi:
        norm = _normalize_doi(doi)
        if norm:
            dedup.setdefault('doi', {}).setdefault(norm.lower(), ck)
    isbn = (entry.get('ISBN') or '').strip()
    if isbn:
        norm = _normalize_isbn(isbn)
        if norm:
            dedup.setdefault('isbn', {}).setdefault(norm, ck)
    tnorm = normalize_title_for_dedup(entry.get('Title') or '')
    if tnorm:
        dedup.setdefault('title', {}).setdefault(tnorm, ck)
