"""Deduplicació al `POST /import-references`.

Funcions pures (sense FastAPI / xarxa / FS). Compara cada entrada del fitxer
BibTeX/RIS contra el vault per 4 criteris (per ordre de prioritat):

  1. Citation Key idèntic
  2. DOI normalitzat
  3. ISBN normalitzat
  4. Títol normalitzat (minúscules, sense accents/puntuació)

Si una entrada coincideix, el caller la marca com a "skipped" i registra
el motiu per al feedback de l'usuari.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional


# ---------- Normalitzadors d'identificadors (duplicació conscient) ----------
# Aquestes utilitats també viuen a `vault_routes.py`. Les dupliquem aquí
# per mantenir el mòdul pur (importat per tests sense FastAPI). Si en una
# iteració posterior es centralitzen, candidat: `backend/services/identifier_normalizers.py`.

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


# ---------- Normalitzador de títol per a deduplicació ----------

def normalize_title_for_dedup(title) -> str:
    """Equivalence agressiva: minúscules, accents/puntuació fora, espais col·lapsats.

    Més tolerant que un equality estricte; pot generar algun fals positiu
    amb títols genèrics ("Introduction", "Editorial") però el risc d'un
    import duplicat és més car que un skip ocasional. L'usuari sempre pot
    revisar `skipped_details` per decidir si forçar la creació manualment.
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
    """Retorna `(reason, existing_key)` si l'entrada coincideix amb una
    pàgina ja existent al vault; `None` si és nova.

    `dedup` és el resultat de `build_indexes_from_records(...)`:
        {'doi': {doi_norm_lower: ck}, 'isbn': {isbn_norm: ck}, 'title': {t_norm: ck}}

    `vault_keys` és el set de citation keys existents.

    Ordre de prioritat: citation_key > DOI > ISBN > títol. Va del més
    autoritatiu al més tolerant per minimitzar falsos positius.
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
    """Després de crear una pàgina, afegir els seus identificadors als
    índexs aux perquè la **mateixa importació** no creï duplicats interns
    (dues entrades del fitxer amb el mateix DOI/ISBN/títol).

    Idempotent: `setdefault` no sobreescriu si la clau ja és present.
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
