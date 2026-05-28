"""Normalitzadors: payload cru de cada font de lookup → Zotero item canònic.

Patró arquitectònic (L3): cada font (CrossRef, OpenLibrary, arXiv, PubMed,
HTML meta tags, ...) té vocabulari propi. En lloc de tenir un mapper directe
"font → Recursos" per font, normalitzem **primer** a Zotero item i deleguem
al mapper declaratiu central [`zotero_to_recursos_mapper`].

Aquest disseny:
  - Centralitza l'única veritat sobre la nomenclatura Zotero/Recursos.
  - Permet afegir fonts noves sense tocar el mapping Recursos.
  - Manté els normalitzadors com a funcions pures (sense xarxa ni FS),
    trivials de testejar.

Estat actual (L3.2): només CrossRef. Pendents per a L3.3:
  - openlibrary_to_zotero_item
  - arxiv_to_zotero_item
  - pubmed_to_zotero_item
  - html_meta_to_zotero_item
"""
from __future__ import annotations

from typing import Any


# CrossRef `type` (https://api.crossref.org/types) → Zotero itemType.
# Cobrim els més comuns. Si en surt un de no llistat, el deixem tal qual
# (Zotero ignorarà el item type, però els altres camps continuaran).
_CROSSREF_TYPE_TO_ZOTERO: dict[str, str] = {
    'journal-article': 'journalArticle',
    'book': 'book',
    'book-chapter': 'bookSection',
    'proceedings-article': 'conferencePaper',
    'thesis': 'thesis',
    'report': 'report',
    # Tipus addicionals que no eren al mapper legacy però es poden afegir
    # sense risc — el schema oficial Zotero (v42) els conté:
    'posted-content': 'preprint',
    'dataset': 'dataset',
    'standard': 'standard',
}


def crossref_to_zotero_item(work: dict) -> dict[str, Any]:
    """Converteix una resposta de l'API CrossRef (camp `message`) a un
    Zotero item canònic. Funció pura.

    L'entrada típica és el que retorna ``GET https://api.crossref.org/works/{doi}``
    sota ``response.json()["message"]``. Els camps coberts són els que
    el mapper central reconeix (vegis `RECURSOS_TO_ZOTERO_FIELDS`); la
    resta s'ignoren a L3.2 i es recolliran a L3.4.
    """
    if not isinstance(work, dict):
        return {}
    item: dict[str, Any] = {}

    # Item Type
    crossref_type = work.get('type')
    if crossref_type:
        item['itemType'] = _CROSSREF_TYPE_TO_ZOTERO.get(crossref_type, crossref_type)

    # Title (CrossRef l'envia com a array; agafem la primera)
    title = work.get('title')
    if title:
        item['title'] = title[0] if isinstance(title, list) else title

    # Creators: només autors. Editors/traductors quedarien al item Zotero
    # amb creatorType propi però el mapper central els ignora a L3.1.
    creators: list[dict[str, str]] = []
    for a in work.get('author') or []:
        if not isinstance(a, dict):
            continue
        family = (a.get('family') or '').strip()
        given = (a.get('given') or '').strip()
        name = (a.get('name') or '').strip()
        if family:
            creator = {'creatorType': 'author', 'lastName': family}
            if given:
                creator['firstName'] = given
            creators.append(creator)
        elif name:
            creators.append({'creatorType': 'author', 'name': name})
    if creators:
        item['creators'] = creators

    # Date: CrossRef té `published-print`, `published-online`, `issued`
    # amb estructura {date-parts: [[year, month?, day?]]}. Prioritzem
    # print > online > issued per coincidir amb el comportament legacy.
    # El mapper central només n'extreu l'any (regex \d{4}), així que
    # n'hi ha prou amb passar l'any com a string.
    for key in ('published-print', 'published-online', 'issued'):
        date_obj = work.get(key) or {}
        parts = date_obj.get('date-parts') or []
        if parts and parts[0]:
            try:
                item['date'] = str(int(parts[0][0]))
                break
            except (TypeError, ValueError):
                continue

    # Container (revista/proceedings/llibre): l'envien com a array igual
    # que el title. Mapem a `publicationTitle` perquè és el primer del
    # fallback chain a `RECURSOS_TO_ZOTERO_FIELDS['Llibre/Revista']`.
    container = work.get('container-title')
    if container:
        item['publicationTitle'] = container[0] if isinstance(container, list) else container

    # Camps simples
    if work.get('publisher'):
        item['publisher'] = work['publisher']
    if work.get('volume'):
        item['volume'] = work['volume']
    if work.get('issue'):
        item['issue'] = work['issue']
    if work.get('page'):
        item['pages'] = work['page']
    if work.get('DOI'):
        item['DOI'] = work['DOI']
    if work.get('URL'):
        item['url'] = work['URL']
    if work.get('language'):
        item['language'] = work['language']

    # Identificadors que poden venir com a array
    isbn = work.get('ISBN')
    if isbn:
        item['ISBN'] = isbn[0] if isinstance(isbn, list) else isbn
    issn = work.get('ISSN')
    if issn:
        item['ISSN'] = issn[0] if isinstance(issn, list) else issn

    return item
