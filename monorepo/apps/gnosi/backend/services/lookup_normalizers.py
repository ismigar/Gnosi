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

Estat actual (L3.3): CrossRef, Open Library, arXiv, PubMed, HTML meta tags.
Pendent L3.4: capturar camps Zotero rars (patentNumber, etc.) al frontmatter
sota una clau dedicada.
"""
from __future__ import annotations

import re
from typing import Any, Optional


# ---------- Helpers locals (duplicació conscient de vault_routes) ----------
# Aquestes utilitats també existeixen a `vault_routes.py`; les dupliquem
# aquí per mantenir el mòdul pur (sense importar FastAPI/dependencies del
# backend). Si en una iteració posterior cal centralitzar-les, candidats:
# `backend/services/identifier_normalizers.py`.

_DOI_RE_LOCAL = re.compile(r'10\.\d{4,9}/[-._;()/:A-Z0-9]+', re.IGNORECASE)


def _normalize_doi_local(raw: str) -> Optional[str]:
    if not raw:
        return None
    m = _DOI_RE_LOCAL.search(raw)
    return m.group(0) if m else None


def _normalize_isbn_local(raw: str) -> Optional[str]:
    if not raw:
        return None
    cleaned = re.sub(r'[-\s]', '', raw)
    m = re.search(r'97[89]\d{10}|\d{9}[\dX]', cleaned)
    return m.group(0) if m else None


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


# ---------- Open Library ----------

def _split_full_name(full: str) -> Optional[dict]:
    """`"Daniel Kahneman"` → `{lastName: "Kahneman", firstName: "Daniel"}`.

    Per noms d'un sol token, retornem `{name: token}` (Zotero ho tracta
    com a creator amb nom literal).
    """
    full = (full or '').strip()
    if not full:
        return None
    parts = full.split()
    if len(parts) >= 2:
        return {'creatorType': 'author', 'lastName': parts[-1],
                'firstName': ' '.join(parts[:-1])}
    return {'creatorType': 'author', 'name': full}


def openlibrary_to_zotero_item(book: dict) -> dict[str, Any]:
    """Open Library `bibkeys` (`jscmd=data`) → Zotero item canònic.

    Particularitats:
      - `title` + `subtitle` es concatenen amb `: ` (legacy ho fa així).
      - `authors[].name` ve com a string sencer; split heurístic last/first.
      - `publish_date` és lliure (`"2011"`, `"June 2011"`, `"2011-06-15"`).
      - `publishers` i `publish_places` són llistes de dict `{name: ...}`
        o strings; agafem el primer.
      - Tipus fix: `book`.
    """
    if not isinstance(book, dict):
        return {}
    item: dict[str, Any] = {'itemType': 'book'}

    title = (book.get('title') or '').strip()
    subtitle = (book.get('subtitle') or '').strip()
    if title and subtitle:
        item['title'] = f'{title}: {subtitle}'
    elif title:
        item['title'] = title
    elif subtitle:
        # Cas extrem: subtitle sense title (mai vist a Open Library, però
        # el legacy ho gestionava amb `.strip(': ')`).
        item['title'] = subtitle

    creators = []
    for a in book.get('authors') or []:
        if isinstance(a, dict):
            c = _split_full_name(a.get('name') or '')
            if c:
                creators.append(c)
    if creators:
        item['creators'] = creators

    pd = book.get('publish_date')
    if pd:
        m = re.search(r'\b(19|20)\d{2}\b', str(pd))
        if m:
            item['date'] = m.group(0)

    pubs = book.get('publishers')
    if isinstance(pubs, list) and pubs:
        first = pubs[0]
        name = first.get('name', '') if isinstance(first, dict) else str(first)
        if name:
            item['publisher'] = name

    places = book.get('publish_places')
    if isinstance(places, list) and places:
        first = places[0]
        name = first.get('name', '') if isinstance(first, dict) else str(first)
        if name:
            item['place'] = name

    if book.get('number_of_pages'):
        item['numPages'] = str(book['number_of_pages'])

    ids = book.get('identifiers') or {}
    if ids.get('isbn_13'):
        item['ISBN'] = ids['isbn_13'][0]
    elif ids.get('isbn_10'):
        item['ISBN'] = ids['isbn_10'][0]

    return item


# ---------- arXiv ----------

def arxiv_to_zotero_item(entry_xml: str) -> dict[str, Any]:
    """Resposta Atom XML de l'API d'arXiv → Zotero item `preprint`.

    Parseig amb `xml.etree` (stdlib). Si el XML és malformat, retornem
    `{}` perquè el caller pugui detectar fallida.
    """
    import xml.etree.ElementTree as ET
    if not entry_xml or not isinstance(entry_xml, str):
        return {}
    try:
        root = ET.fromstring(entry_xml)
    except ET.ParseError:
        return {}
    ns = {'atom': 'http://www.w3.org/2005/Atom', 'arxiv': 'http://arxiv.org/schemas/atom'}
    entry = root.find('atom:entry', ns)
    if entry is None:
        return {}

    item: dict[str, Any] = {'itemType': 'preprint'}

    title = entry.find('atom:title', ns)
    if title is not None and title.text:
        item['title'] = re.sub(r'\s+', ' ', title.text).strip()

    creators = []
    for a in entry.findall('atom:author', ns):
        name_el = a.find('atom:name', ns)
        if name_el is not None and name_el.text:
            c = _split_full_name(name_el.text)
            if c:
                creators.append(c)
    if creators:
        item['creators'] = creators

    published = entry.find('atom:published', ns)
    if published is not None and published.text:
        m = re.match(r'(\d{4})', published.text)
        if m:
            item['date'] = m.group(1)

    doi = entry.find('arxiv:doi', ns)
    if doi is not None and doi.text:
        item['DOI'] = doi.text.strip()

    journal_ref = entry.find('arxiv:journal_ref', ns)
    if journal_ref is not None and journal_ref.text:
        item['publicationTitle'] = journal_ref.text.strip()

    link = entry.find('atom:id', ns)
    if link is not None and link.text:
        item['url'] = link.text.strip()

    return item


# ---------- PubMed (E-utilities esummary) ----------

def _pubmed_name_to_creator(name: str) -> Optional[dict]:
    """`"Murphy SA"` (cognom + inicials) → `{lastName: "Murphy", firstName: "SA"}`.

    Si el cognom ja porta coma (format `"Murphy, S.A."`), parsegem el split.
    Si no es pot inferir cognom, retornem el name literal.
    """
    name = (name or '').strip()
    if not name:
        return None
    if ',' in name:
        family, _, given = name.partition(',')
        family = family.strip()
        given = given.strip()
        if family:
            c = {'creatorType': 'author', 'lastName': family}
            if given:
                c['firstName'] = given
            return c
        return None
    toks = name.split()
    # Format PubMed típic: l'últim token són inicials curtes
    if len(toks) >= 2 and re.fullmatch(r'[A-Za-z]{1,4}', toks[-1]):
        return {'creatorType': 'author', 'lastName': ' '.join(toks[:-1]),
                'firstName': toks[-1]}
    return {'creatorType': 'author', 'name': name}


def pubmed_to_zotero_item(doc: dict) -> dict[str, Any]:
    """PubMed esummary doc → Zotero item `journalArticle`.

    Particularitats:
      - `title` arriba amb `.` final que cal treure.
      - `authors[].name` format `"Cognom Inicials"`; parsejat especialment.
      - `articleids[]` (array) porta el DOI sota `idtype=doi`.
      - `uid` és el PMID (sempre present).
    """
    if not isinstance(doc, dict):
        return {}
    item: dict[str, Any] = {'itemType': 'journalArticle'}

    if doc.get('title'):
        item['title'] = str(doc['title']).rstrip('.')

    creators = []
    for a in doc.get('authors') or []:
        if not isinstance(a, dict):
            continue
        if a.get('authtype', 'Author') != 'Author':
            continue
        c = _pubmed_name_to_creator(a.get('name') or '')
        if c:
            creators.append(c)
    if creators:
        item['creators'] = creators

    date_raw = doc.get('pubdate') or doc.get('epubdate') or ''
    m = re.search(r'\d{4}', date_raw)
    if m:
        item['date'] = m.group(0)

    journal = doc.get('fulljournalname') or doc.get('source')
    if journal:
        item['publicationTitle'] = journal
    if doc.get('volume'):
        item['volume'] = str(doc['volume'])
    if doc.get('issue'):
        item['issue'] = str(doc['issue'])
    if doc.get('pages'):
        item['pages'] = str(doc['pages'])

    for aid in doc.get('articleids') or []:
        if isinstance(aid, dict) and aid.get('idtype') == 'doi' and aid.get('value'):
            item['DOI'] = aid['value']
            break

    langs = doc.get('lang') or []
    if isinstance(langs, list) and langs:
        item['language'] = langs[0]

    if doc.get('uid'):
        item['PMID'] = str(doc['uid'])

    return item


# ---------- HTML meta tags (Open Graph, Dublin Core, citation_*) ----------

def html_meta_to_zotero_item(html: str, url: str) -> dict[str, Any]:
    """Extreu meta tags d'una pàgina HTML → Zotero item.

    Prioritats (de més a menys autoritatiu): `citation_*` (Highwire) >
    `DC.*` (Dublin Core) > `og:*` (Open Graph). Fallback `<title>` si
    cap meta porta el títol.

    Quirk legacy preservat (bit-idèntic): si NO hi ha `journal_title`
    però sí `publisher`, el publisher va a `publicationTitle` (no a
    `publisher`). És incorrecte semànticament — `publisher` no és el
    nom de la revista — però mantenim el comportament fins que es
    decideixi corregir-lo en un commit separat.
    """
    if not isinstance(html, str):
        return {'url': url} if url else {}

    citations = re.findall(
        r'<meta[^>]+name=["\']citation_([^"\']+)["\'][^>]+content=["\']([^"\']*)["\']',
        html, re.IGNORECASE,
    )
    og = re.findall(
        r'<meta[^>]+property=["\']og:([^"\']+)["\'][^>]+content=["\']([^"\']*)["\']',
        html, re.IGNORECASE,
    )
    dc = re.findall(
        r'<meta[^>]+name=["\']DC\.([^"\']+)["\'][^>]+content=["\']([^"\']*)["\']',
        html, re.IGNORECASE,
    )
    title_m = re.search(r'<title[^>]*>([^<]+)</title>', html, re.IGNORECASE)
    fallback_title = title_m.group(1).strip() if title_m else None

    # Ordre de prioritat: og < dc < citation (l'últim guanya en sobreescriure)
    sources: dict[str, str] = {}
    for k, v in og: sources[k.lower()] = v
    for k, v in dc: sources[k.lower()] = v
    for k, v in citations: sources[k.lower()] = v

    def get(*keys: str) -> Optional[str]:
        for k in keys:
            v = sources.get(k.lower())
            if v:
                return v
        return None

    item: dict[str, Any] = {}

    title = get('title')
    if title:
        item['title'] = title.strip()
    elif fallback_title:
        item['title'] = fallback_title

    # Autors: citation_author > DC.creator/contributor > og:author
    author_strings: list[str] = [v for k, v in citations if k.lower() == 'author']
    author_strings += [v for k, v in dc if k.lower() in ('creator', 'contributor')]
    if not author_strings and get('author'):
        author_strings = [get('author')]
    if author_strings:
        creators = []
        seen = set()
        for raw in author_strings:
            a = raw.strip()
            if ',' in a:
                family, _, given = a.partition(',')
                family = family.strip()
                given = given.strip()
                key = f'{family.lower()}|{given.lower()}'
                if key in seen or not family:
                    continue
                seen.add(key)
                c = {'creatorType': 'author', 'lastName': family}
                if given:
                    c['firstName'] = given
                creators.append(c)
            else:
                toks = a.split()
                if len(toks) >= 2:
                    family = toks[-1]
                    given = ' '.join(toks[:-1])
                    key = f'{family.lower()}|{given.lower()}'
                    if key in seen:
                        continue
                    seen.add(key)
                    creators.append({'creatorType': 'author', 'lastName': family,
                                     'firstName': given})
                else:
                    key = a.lower()
                    if key in seen or not a:
                        continue
                    seen.add(key)
                    creators.append({'creatorType': 'author', 'name': a})
        if creators:
            item['creators'] = creators

    year_raw = get('date', 'publication_date')
    if year_raw:
        m = re.search(r'\b(19|20)\d{2}\b', year_raw)
        if m:
            item['date'] = m.group(0)

    # Quirk legacy: journal_title || publisher → publicationTitle.
    journal = get('journal_title', 'publisher')
    if journal:
        item['publicationTitle'] = journal

    doi_raw = get('doi')
    if doi_raw:
        item['DOI'] = _normalize_doi_local(doi_raw) or doi_raw

    isbn_raw = get('isbn')
    if isbn_raw:
        item['ISBN'] = _normalize_isbn_local(isbn_raw) or isbn_raw

    if get('volume'):
        item['volume'] = get('volume')
    if get('issue'):
        item['issue'] = get('issue')

    first = get('firstpage')
    last = get('lastpage')
    if first and last:
        item['pages'] = f'{first}-{last}'
    elif first:
        item['pages'] = first

    if get('language'):
        item['language'] = get('language')

    if url:
        item['url'] = url

    return item
