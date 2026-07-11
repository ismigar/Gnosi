"""Normalizers: raw payload from each lookup source → canonical Zotero item.

Architectural pattern (L3): each source (CrossRef, OpenLibrary, arXiv, PubMed,
HTML meta tags, ...) has its own vocabulary. Instead of having a direct
"source → Recursos" mapper per source, we normalize **first** to a Zotero item and
delegate to the central declarative mapper [`zotero_to_recursos_mapper`].

This design:
  - Centralizes the single source of truth about Zotero/Recursos naming.
  - Allows adding new sources without touching the Recursos mapping.
  - Keeps the normalizers as pure functions (no network or FS),
    trivial to test.

Current state (L3.3): CrossRef, Open Library, arXiv, PubMed, HTML meta tags.
Pending L3.4: capture rare Zotero fields (patentNumber, etc.) in the frontmatter
under a dedicated key.
"""
from __future__ import annotations

import re
from typing import Any, Optional


# ---------- Local helpers (deliberate duplication of vault_routes) ----------
# These utilities also exist in `vault_routes.py`; we duplicate them
# here to keep the module pure (without importing FastAPI/backend
# dependencies). If a later iteration needs to centralize them, candidates:
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
# We cover the most common ones. If one shows up that isn't listed, we leave it as is
# (Zotero will ignore the item type, but the other fields will still work).
_CROSSREF_TYPE_TO_ZOTERO: dict[str, str] = {
    'journal-article': 'journalArticle',
    'book': 'book',
    'book-chapter': 'bookSection',
    'proceedings-article': 'conferencePaper',
    'thesis': 'thesis',
    'report': 'report',
    # Additional types that weren't in the legacy mapper but can be added
    # safely — the official Zotero schema (v42) contains them:
    'posted-content': 'preprint',
    'dataset': 'dataset',
    'standard': 'standard',
}


def crossref_to_zotero_item(work: dict) -> dict[str, Any]:
    """Converts a CrossRef API response (`message` field) into a
    canonical Zotero item. Pure function.

    The typical input is what ``GET https://api.crossref.org/works/{doi}``
    returns under ``response.json()["message"]``. The fields covered are the ones
    the central mapper recognizes (see `RECURSOS_TO_ZOTERO_FIELDS`); the
    rest are ignored in L3.2 and will be collected in L3.4.
    
    """
    if not isinstance(work, dict):
        return {}
    item: dict[str, Any] = {}

    # Item Type
    crossref_type = work.get('type')
    if crossref_type:
        item['itemType'] = _CROSSREF_TYPE_TO_ZOTERO.get(crossref_type, crossref_type)

    # Title (CrossRef sends it as an array; we take the first one)
    title = work.get('title')
    if title:
        item['title'] = title[0] if isinstance(title, list) else title

    # Creators: authors only. Editors/translators would stay in the Zotero item
    # with their own creatorType but the central mapper ignores them in L3.1.
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

    # Date: CrossRef has `published-print`, `published-online`, `issued`
    # with structure {date-parts: [[year, month?, day?]]}. We prioritize
    # print > online > issued to match the legacy behavior.
    # The central mapper only extracts the year from it (regex \d{4}), so
    # it's enough to pass the year as a string.
    for key in ('published-print', 'published-online', 'issued'):
        date_obj = work.get(key) or {}
        parts = date_obj.get('date-parts') or []
        if parts and parts[0]:
            try:
                item['date'] = str(int(parts[0][0]))
                break
            except (TypeError, ValueError):
                continue

    # Container (journal/proceedings/book): they send it as an array too
    # than the title. We map to `publicationTitle` because it's the first of the
    # fallback chain a `RECURSOS_TO_ZOTERO_FIELDS['Llibre/Revista']`.
    container = work.get('container-title')
    if container:
        item['publicationTitle'] = container[0] if isinstance(container, list) else container

    # Simple fields
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

    # Identifiers that can come as an array
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

    For single-token names, we return `{name: token}` (Zotero treats it
    as a creator with a literal name).
    
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
    """Open Library `bibkeys` (`jscmd=data`) → canonical Zotero item.

    Particularities:
      - `title` + `subtitle` are concatenated with `: ` (legacy does it this way).
      - `authors[].name` comes as a whole string; heuristic last/first split.
      - `publish_date` is free-form (`"2011"`, `"June 2011"`, `"2011-06-15"`).
      - `publishers` and `publish_places` are lists of dict `{name: ...}`
        or strings; we take the first one.
      - Fixed type: `book`.
    
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
        # Edge case: subtitle without title (never seen on Open Library, but
        # the legacy code handled it with `.strip(': ')`).
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
    """Atom XML response from the arXiv API → Zotero `preprint` item.

    Parsed with `xml.etree` (stdlib). If the XML is malformed, we return
    `{}` so the caller can detect failure.
    
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
    """`"Murphy SA"` (last name + initials) → `{lastName: "Murphy", firstName: "SA"}`.

    If the last name already has a comma (format `"Murphy, S.A."`), we parse the split.
    If the last name can't be inferred, we return the literal name.
    
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
    # Typical PubMed format: the last token is short initials
    if len(toks) >= 2 and re.fullmatch(r'[A-Za-z]{1,4}', toks[-1]):
        return {'creatorType': 'author', 'lastName': ' '.join(toks[:-1]),
                'firstName': toks[-1]}
    return {'creatorType': 'author', 'name': name}


def pubmed_to_zotero_item(doc: dict) -> dict[str, Any]:
    """PubMed esummary doc → Zotero `journalArticle` item.

    Particularities:
      - `title` arrives with a trailing `.` that needs to be stripped.
      - `authors[].name` format `"LastName Initials"`; parsed specially.
      - `articleids[]` (array) carries the DOI under `idtype=doi`.
      - `uid` is the PMID (always present).
    
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

def _parse_meta_tags(html: str) -> tuple[list, list, list]:
    """Extracts the `(key_without_prefix, content)` pairs from `<meta>` tags of
    three families: Highwire (`citation_*`), Open Graph (`og:*`) and Dublin
    Core (`DC.*`).

    Independent of the ORDER of attributes within the `<meta>` tag: HTML allows
    both `<meta name="citation_title" content="...">` and
    `<meta content="..." name="citation_title">`, and many pages emit
    `content` first. The previous parsing, with a single regex that required
    `name=...` BEFORE `content=...`, silently missed every meta tag
    with the reversed order (title, authors, DOI...). Here we scan each tag and
    read `name`/`property` and `content` separately.
    
    """
    citations: list = []
    og: list = []
    dc: list = []
    for tag in re.findall(r'<meta\b[^>]*>', html, re.IGNORECASE):
        key_m = re.search(r'\b(?:name|property)\s*=\s*["\']([^"\']+)["\']', tag, re.IGNORECASE)
        content_m = re.search(r'\bcontent\s*=\s*["\']([^"\']*)["\']', tag, re.IGNORECASE)
        if not key_m or content_m is None:
            continue
        key = key_m.group(1)
        val = content_m.group(1)
        low = key.lower()
        if low.startswith('citation_'):
            citations.append((key[len('citation_'):], val))
        elif low.startswith('og:'):
            og.append((key[len('og:'):], val))
        elif low.startswith('dc.'):
            dc.append((key[len('dc.'):], val))
    return citations, og, dc


def html_meta_to_zotero_item(html: str, url: str) -> dict[str, Any]:
    """Extracts meta tags from an HTML page → Zotero item.

    Priorities (from most to least authoritative): `citation_*` (Highwire) >
    `DC.*` (Dublin Core) > `og:*` (Open Graph). Falls back to `<title>` if
    no meta tag carries the title.

    As of this commit, the fields are correctly separated:
      - `journal_title` (Highwire) / `DC.publisher` → `publicationTitle`
        only if it comes from this meta tag (the journal where it was published).
      - `publisher` (without the `citation_` or `DC.` prefix) → `publisher`
        (the publisher: Acme Press, Elsevier, ...).

    If you see the old quirk anywhere in the pre-fix code
    (publisher going to `Llibre/Revista`), it's a bug and should
    be updated to this new behavior.
    
    """
    if not isinstance(html, str):
        return {'url': url} if url else {}

    citations, og, dc = _parse_meta_tags(html)
    title_m = re.search(r'<title[^>]*>([^<]+)</title>', html, re.IGNORECASE)
    fallback_title = title_m.group(1).strip() if title_m else None

    # Priority order: og < dc < citation (the last one wins when overwriting)
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

    # Correct separation: the journal name (journal_title) and the publisher
    # (publisher) are different concepts and go to different Zotero fields.
    journal = get('journal_title')
    if journal:
        item['publicationTitle'] = journal
    publisher = get('publisher')
    if publisher:
        item['publisher'] = publisher

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
