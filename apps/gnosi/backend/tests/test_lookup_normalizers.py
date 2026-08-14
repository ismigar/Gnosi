"""Tests for the lookup normalizers (raw source → canonical Zotero item).

Each normalizer is validated with:
  1. **Equivalence vs legacy**: the pipeline
     `normalitzador → zotero_item_to_recursos` produces EXACTLY the
     same Recursos fields as the original hardcoded mapper. Literal
     snapshot of the legacy at the top of the file.
  2. **Behavioral checks**: that the intermediate Zotero item has the fields
     the central mapper expects (to detect drift between the
     normalizer and `RECURSOS_TO_ZOTERO_FIELDS`).

Each source will have its own section. L3.2 covers CrossRef.
"""
from __future__ import annotations

import pytest

from backend.services.lookup_normalizers import (
    arxiv_to_zotero_item,
    crossref_to_zotero_item,
    html_meta_to_zotero_item,
    openlibrary_to_zotero_item,
    pubmed_to_zotero_item,
)
from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos


# ---------- Literal snapshot of _crossref_to_recursos (pre-refactor) ----------
# Exact copy of the code in vault_routes.py:4159 right before the refactor.
# If the new pipeline's output differs from this legacy one, the eq tests
# flag it as a regression.

def _legacy_crossref_to_recursos(work: dict) -> dict:
    out: dict = {}
    if work.get('title'):
        out['Title'] = work['title'][0] if isinstance(work['title'], list) else work['title']
    authors = work.get('author') or []
    if authors:
        parts = []
        for a in authors:
            family = (a.get('family') or '').strip()
            given = (a.get('given') or '').strip()
            if family and given:
                parts.append(f'{family}, {given}')
            elif family:
                parts.append(family)
            elif a.get('name'):
                parts.append(a['name'])
        if parts:
            out['Authors'] = '; '.join(parts)
    for key in ('published-print', 'published-online', 'issued'):
        date_obj = work.get(key) or {}
        parts = date_obj.get('date-parts') or []
        if parts and parts[0]:
            try:
                out['Any'] = int(parts[0][0])
                break
            except (TypeError, ValueError):
                pass
    if work.get('container-title'):
        ct = work['container-title']
        out['Llibre/Revista'] = ct[0] if isinstance(ct, list) else ct
    if work.get('publisher'):
        out['Editorial'] = work['publisher']
    if work.get('volume'):
        out['Volum'] = str(work['volume'])
    if work.get('issue'):
        out['Número'] = str(work['issue'])
    if work.get('page'):
        out['Pàgines'] = str(work['page'])
    if work.get('DOI'):
        out['DOI'] = work['DOI']
    if work.get('ISBN'):
        isbns = work['ISBN']
        out['ISBN'] = isbns[0] if isinstance(isbns, list) else isbns
    if work.get('ISSN'):
        issns = work['ISSN']
        out['ISSN'] = issns[0] if isinstance(issns, list) else issns
    if work.get('URL'):
        out['URL'] = work['URL']
    if work.get('language'):
        out['Idioma'] = work['language']
    if work.get('type'):
        type_map = {
            'journal-article': 'journalArticle',
            'book': 'book',
            'book-chapter': 'bookSection',
            'proceedings-article': 'conferencePaper',
            'thesis': 'thesis',
            'report': 'report',
        }
        out['Item Type'] = type_map.get(work['type'], work['type'])
    return out


# ---------- Fixtures CrossRef reals ----------
# Reduced responses (only the fields the mapper touches) extracted from
# real calls to https://api.crossref.org/works/<doi> under .message.

CROSSREF_JOURNAL_ARTICLE = {
    'type': 'journal-article',
    'title': ['Attention Is All You Need'],
    'author': [
        {'family': 'Vaswani', 'given': 'Ashish'},
        {'family': 'Shazeer', 'given': 'Noam'},
    ],
    'published-print': {'date-parts': [[2017, 6, 12]]},
    'container-title': ['arXiv preprint'],
    'volume': '1706',
    'issue': '03762',
    'page': '1-15',
    'DOI': '10.48550/arXiv.1706.03762',
    'ISSN': ['2331-8422'],
    'URL': 'https://doi.org/10.48550/arXiv.1706.03762',
    'language': 'en',
    'publisher': 'arXiv',
}

CROSSREF_BOOK_CHAPTER = {
    'type': 'book-chapter',
    'title': ['The Two Cultures'],
    'author': [{'family': 'Snow', 'given': 'C. P.'}],
    'issued': {'date-parts': [[1959]]},
    'container-title': ['The Two Cultures and the Scientific Revolution'],
    'publisher': 'Cambridge University Press',
    'page': '1-21',
    'ISBN': ['978-0-521-45730-9'],
    'DOI': '10.1017/CBO9780511819940',
}

CROSSREF_PROCEEDINGS = {
    'type': 'proceedings-article',
    'title': ['BERT: Pre-training of Deep Bidirectional Transformers'],
    'author': [{'family': 'Devlin', 'given': 'Jacob'}],
    'published-online': {'date-parts': [[2019, 6]]},
    'container-title': ['Proceedings of NAACL-HLT 2019'],
    'page': '4171-4186',
}

CROSSREF_INSTITUTIONAL_AUTHOR = {
    'type': 'report',
    'title': ['World Health Statistics 2024'],
    'author': [{'name': 'World Health Organization'}],
    'issued': {'date-parts': [[2024]]},
    'publisher': 'WHO',
}

CROSSREF_FALLBACK_DATE = {
    # Without `published-print` or `published-online`; falls back to `issued`.
    'type': 'journal-article',
    'title': ['Old paper'],
    'issued': {'date-parts': [[2005]]},
}

CROSSREF_NEW_TYPES = {
    # Modern types the legacy mapper did NOT account for (fell into the
    # default without translating). Now we recognize them.
    'type': 'posted-content',
    'title': ['Some preprint'],
}

CROSSREF_EMPTY: dict = {}


# ---------- Equivalence: new pipeline == legacy ----------

@pytest.mark.parametrize("fixture", [
    CROSSREF_JOURNAL_ARTICLE, CROSSREF_BOOK_CHAPTER, CROSSREF_PROCEEDINGS,
    CROSSREF_INSTITUTIONAL_AUTHOR, CROSSREF_FALLBACK_DATE, CROSSREF_EMPTY,
], ids=['journal-article', 'book-chapter', 'proceedings', 'institutional',
        'fallback-date', 'empty'])
def test_crossref_pipeline_equivalent_to_legacy(fixture):
    """`crossref_to_zotero_item → zotero_item_to_recursos` produces the
    same output as the original `_crossref_to_recursos`. No regression
    before the refactor in vault_routes.py."""
    new = zotero_item_to_recursos(crossref_to_zotero_item(fixture))
    legacy = _legacy_crossref_to_recursos(fixture)
    assert new == legacy


def test_non_dict_returns_empty():
    assert crossref_to_zotero_item(None) == {}
    assert crossref_to_zotero_item("not a dict") == {}
    assert crossref_to_zotero_item(42) == {}


# ---------- Behavioral checks of the intermediate Zotero item ----------

def test_creators_have_proper_zotero_structure():
    """Creators must have the shape the central mapper expects."""
    item = crossref_to_zotero_item(CROSSREF_JOURNAL_ARTICLE)
    assert 'creators' in item
    for c in item['creators']:
        assert c['creatorType'] == 'author'
        assert 'lastName' in c or 'name' in c


def test_institutional_creator_uses_name_field():
    item = crossref_to_zotero_item(CROSSREF_INSTITUTIONAL_AUTHOR)
    assert item['creators'] == [{'creatorType': 'author', 'name': 'World Health Organization'}]


def test_container_goes_to_publication_title():
    """Container must go to `publicationTitle` (first in the fallback chain)."""
    item = crossref_to_zotero_item(CROSSREF_JOURNAL_ARTICLE)
    assert item['publicationTitle'] == 'arXiv preprint'


def test_date_priority_print_before_issued():
    """`published-print` takes precedence over `issued`."""
    work = {
        'published-print': {'date-parts': [[2020]]},
        'issued': {'date-parts': [[1999]]},
    }
    item = crossref_to_zotero_item(work)
    assert item['date'] == '2020'


def test_date_fallback_to_issued():
    item = crossref_to_zotero_item(CROSSREF_FALLBACK_DATE)
    assert item['date'] == '2005'


# ---------- L3.2 bonus: modern types ----------

def test_modern_types_now_recognized():
    """Types the legacy mapper didn't translate (fell back to the original string)
    are now recognized as a canonical Zotero key."""
    item = crossref_to_zotero_item(CROSSREF_NEW_TYPES)
    assert item['itemType'] == 'preprint'
    # But the legacy left it as 'posted-content'
    assert _legacy_crossref_to_recursos(CROSSREF_NEW_TYPES)['Item Type'] == 'posted-content'


def test_unknown_type_passes_through():
    """An unlisted type is left as is (same as the legacy)."""
    item = crossref_to_zotero_item({'type': 'monograph'})
    assert item['itemType'] == 'monograph'


# =================================================================
# Open Library
# =================================================================

def _legacy_openlibrary_to_recursos(book: dict) -> dict:
    """Literal snapshot of _openlibrary_to_recursos (vault_routes.py, pre-L3.3)."""
    import re as _re
    out: dict = {}
    if book.get('title'):
        out['Title'] = book['title']
    if book.get('subtitle'):
        out['Title'] = f"{out.get('Title', '')}: {book['subtitle']}".strip(': ')
    authors = book.get('authors') or []
    if authors:
        names = []
        for a in authors:
            full = (a.get('name') or '').strip()
            if not full:
                continue
            parts = full.split()
            if len(parts) >= 2:
                family = parts[-1]
                given = ' '.join(parts[:-1])
                names.append(f'{family}, {given}')
            else:
                names.append(full)
        if names:
            out['Authors'] = '; '.join(names)
    if book.get('publish_date'):
        m = _re.search(r'\b(19|20)\d{2}\b', str(book['publish_date']))
        if m:
            try:
                out['Any'] = int(m.group(0))
            except ValueError:
                pass
    if book.get('publishers') and isinstance(book['publishers'], list) and book['publishers']:
        out['Editorial'] = book['publishers'][0].get('name', '') if isinstance(book['publishers'][0], dict) else str(book['publishers'][0])
    if book.get('publish_places') and isinstance(book['publish_places'], list) and book['publish_places']:
        first = book['publish_places'][0]
        out['Lloc'] = first.get('name', '') if isinstance(first, dict) else str(first)
    if book.get('number_of_pages'):
        out['Núm. pàgines'] = str(book['number_of_pages'])
    ids = book.get('identifiers') or {}
    if ids.get('isbn_13'):
        out['ISBN'] = ids['isbn_13'][0]
    elif ids.get('isbn_10'):
        out['ISBN'] = ids['isbn_10'][0]
    out['Item Type'] = 'book'
    return out


OPENLIB_FULL = {
    'title': 'Thinking, Fast and Slow',
    'subtitle': 'A Biography of the Brain',
    'authors': [{'name': 'Daniel Kahneman'}],
    'publish_date': '2011',
    'publishers': [{'name': 'Farrar, Straus and Giroux'}],
    'publish_places': [{'name': 'New York'}],
    'number_of_pages': 499,
    'identifiers': {'isbn_13': ['9780374275631'], 'isbn_10': ['0374275637']},
}

OPENLIB_MULTI_AUTHOR_DATE_FREEFORM = {
    'title': 'Book of Many',
    'authors': [{'name': 'Jane Doe'}, {'name': 'John Smith'}, {'name': 'Madonna'}],
    'publish_date': 'June 15, 2003',
    'publishers': ['Penguin'],          # string instead of dict
    'publish_places': ['London'],
}

OPENLIB_MINIMAL = {'title': 'X', 'identifiers': {'isbn_10': ['0123456789']}}

OPENLIB_EMPTY: dict = {}


@pytest.mark.parametrize("fixture", [
    OPENLIB_FULL, OPENLIB_MULTI_AUTHOR_DATE_FREEFORM, OPENLIB_MINIMAL, OPENLIB_EMPTY,
], ids=['full', 'multi_author_freeform_date', 'minimal', 'empty'])
def test_openlibrary_pipeline_equivalent_to_legacy(fixture):
    new = zotero_item_to_recursos(openlibrary_to_zotero_item(fixture))
    legacy = _legacy_openlibrary_to_recursos(fixture)
    assert new == legacy


def test_openlibrary_non_dict_returns_empty():
    assert openlibrary_to_zotero_item(None) == {}
    assert openlibrary_to_zotero_item("not a dict") == {}


# =================================================================
# arXiv
# =================================================================

def _legacy_arxiv_to_recursos(entry_xml: str) -> dict:
    """Literal snapshot of _arxiv_to_recursos (vault_routes.py, pre-L3.3)."""
    import re as _re
    import xml.etree.ElementTree as ET
    out: dict = {}
    ns = {'atom': 'http://www.w3.org/2005/Atom', 'arxiv': 'http://arxiv.org/schemas/atom'}
    try:
        root = ET.fromstring(entry_xml)
    except ET.ParseError:
        return out
    entry = root.find('atom:entry', ns)
    if entry is None:
        return out
    title = entry.find('atom:title', ns)
    if title is not None and title.text:
        out['Title'] = _re.sub(r'\s+', ' ', title.text).strip()
    authors_el = entry.findall('atom:author', ns)
    if authors_el:
        names = []
        for a in authors_el:
            name = a.find('atom:name', ns)
            if name is not None and name.text:
                parts = name.text.strip().split()
                if len(parts) >= 2:
                    names.append(f'{parts[-1]}, {" ".join(parts[:-1])}')
                else:
                    names.append(name.text.strip())
        if names:
            out['Authors'] = '; '.join(names)
    published = entry.find('atom:published', ns)
    if published is not None and published.text:
        m = _re.match(r'(\d{4})', published.text)
        if m:
            try:
                out['Any'] = int(m.group(1))
            except ValueError:
                pass
    doi = entry.find('arxiv:doi', ns)
    if doi is not None and doi.text:
        out['DOI'] = doi.text.strip()
    journal_ref = entry.find('arxiv:journal_ref', ns)
    if journal_ref is not None and journal_ref.text:
        out['Llibre/Revista'] = journal_ref.text.strip()
    link = entry.find('atom:id', ns)
    if link is not None and link.text:
        out['URL'] = link.text.strip()
    out['Item Type'] = 'preprint'
    return out


ARXIV_FULL = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v5</id>
    <title>Attention Is
       All You Need</title>
    <published>2017-06-12T17:57:34Z</published>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <arxiv:doi>10.48550/arXiv.1706.03762</arxiv:doi>
    <arxiv:journal_ref>NIPS 2017</arxiv:journal_ref>
  </entry>
</feed>"""

ARXIV_SINGLE_NAME_AUTHOR = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/test</id>
    <title>Test</title>
    <published>2020-01-01T00:00:00Z</published>
    <author><name>Plato</name></author>
  </entry>
</feed>"""

ARXIV_MALFORMED = "this is not xml"


@pytest.mark.parametrize("xml,name", [
    (ARXIV_FULL, 'full'),
    (ARXIV_SINGLE_NAME_AUTHOR, 'single_name'),
    (ARXIV_MALFORMED, 'malformed'),
    ('', 'empty'),
])
def test_arxiv_pipeline_equivalent_to_legacy(xml, name):
    new = zotero_item_to_recursos(arxiv_to_zotero_item(xml))
    legacy = _legacy_arxiv_to_recursos(xml)
    assert new == legacy, f"divergence on {name}: new={new} legacy={legacy}"


# =================================================================
# PubMed (esummary)
# =================================================================

def _legacy_pubmed_author_to_canonical(name: str) -> str:
    import re as _re
    name = (name or '').strip()
    if not name or ',' in name:
        return name
    toks = name.split()
    if len(toks) >= 2 and _re.fullmatch(r'[A-Za-z]{1,4}', toks[-1]):
        return f"{' '.join(toks[:-1])}, {toks[-1]}"
    return name


def _legacy_pubmed_to_recursos(doc: dict) -> dict:
    import re as _re
    out: dict = {}
    if doc.get('title'):
        out['Title'] = str(doc['title']).rstrip('.')
    names = [
        _legacy_pubmed_author_to_canonical(a.get('name', ''))
        for a in (doc.get('authors') or [])
        if a.get('name') and a.get('authtype', 'Author') == 'Author'
    ]
    if names:
        out['Authors'] = '; '.join(n for n in names if n)
    m = _re.search(r'\d{4}', doc.get('pubdate') or doc.get('epubdate') or '')
    if m:
        out['Any'] = int(m.group(0))
    journal = doc.get('fulljournalname') or doc.get('source')
    if journal:
        out['Llibre/Revista'] = journal
    if doc.get('volume'):
        out['Volum'] = str(doc['volume'])
    if doc.get('issue'):
        out['Número'] = str(doc['issue'])
    if doc.get('pages'):
        out['Pàgines'] = str(doc['pages'])
    for aid in (doc.get('articleids') or []):
        if aid.get('idtype') == 'doi' and aid.get('value'):
            out['DOI'] = aid['value']
    langs = doc.get('lang') or []
    if langs:
        out['Idioma'] = langs[0]
    if doc.get('uid'):
        out['PMID'] = str(doc['uid'])
    out['Item Type'] = 'journalArticle'
    return out


PUBMED_FULL = {
    'uid': '29083320',
    'title': 'The neural basis of attention.',
    'authors': [
        {'name': 'Murphy SA', 'authtype': 'Author'},
        {'name': 'Chen JL', 'authtype': 'Author'},
        {'name': 'Reviewer Z', 'authtype': 'Reviewer'},  # has to be ignored
    ],
    'pubdate': '2017 Nov',
    'fulljournalname': 'Nature Reviews Neuroscience',
    'volume': '18',
    'issue': '11',
    'pages': '673-685',
    'articleids': [
        {'idtype': 'pubmed', 'value': '29083320'},
        {'idtype': 'doi', 'value': '10.1038/nrn.2017.135'},
    ],
    'lang': ['eng'],
}

PUBMED_EPUBDATE_ONLY = {
    'uid': '12345',
    'title': 'X',
    'epubdate': '2020 Feb',
    'source': 'Short Source',  # fulljournalname fallback
}

PUBMED_AUTHOR_WITH_COMMA = {
    'uid': '99',
    'title': 'Y',
    'authors': [{'name': 'García, Maria', 'authtype': 'Author'}],
}


@pytest.mark.parametrize("fixture,name", [
    (PUBMED_FULL, 'full'),
    (PUBMED_EPUBDATE_ONLY, 'epub_only'),
    (PUBMED_AUTHOR_WITH_COMMA, 'author_comma'),
    ({}, 'empty'),
])
def test_pubmed_pipeline_equivalent_to_legacy(fixture, name):
    new = zotero_item_to_recursos(pubmed_to_zotero_item(fixture))
    legacy = _legacy_pubmed_to_recursos(fixture)
    assert new == legacy, f"divergence on {name}: new={new} legacy={legacy}"


# =================================================================
# HTML meta tags
# =================================================================

def _legacy_normalize_doi(raw: str):
    import re as _re
    if not raw:
        return None
    m = _re.search(r'10\.\d{4,9}/[-._;()/:A-Z0-9]+', raw, _re.IGNORECASE)
    return m.group(0) if m else None


def _legacy_normalize_isbn(raw: str):
    import re as _re
    if not raw:
        return None
    cleaned = _re.sub(r'[-\s]', '', raw)
    m = _re.search(r'97[89]\d{10}|\d{9}[\dX]', cleaned)
    return m.group(0) if m else None


def _legacy_html_meta_to_recursos(html: str, url: str) -> dict:
    """Literal snapshot of _html_meta_to_recursos (vault_routes.py, pre-L3.3)."""
    import re as _re
    out: dict = {}
    citations = _re.findall(
        r'<meta[^>]+name=["\']citation_([^"\']+)["\'][^>]+content=["\']([^"\']*)["\']',
        html, _re.IGNORECASE,
    )
    og = _re.findall(
        r'<meta[^>]+property=["\']og:([^"\']+)["\'][^>]+content=["\']([^"\']*)["\']',
        html, _re.IGNORECASE,
    )
    dc = _re.findall(
        r'<meta[^>]+name=["\']DC\.([^"\']+)["\'][^>]+content=["\']([^"\']*)["\']',
        html, _re.IGNORECASE,
    )
    title_m = _re.search(r'<title[^>]*>([^<]+)</title>', html, _re.IGNORECASE)
    fallback_title = title_m.group(1).strip() if title_m else None

    sources = {}
    for k, v in og: sources[k.lower()] = v
    for k, v in dc: sources[k.lower()] = v
    for k, v in citations: sources[k.lower()] = v

    def get(*keys):
        for k in keys:
            v = sources.get(k.lower())
            if v:
                return v
        return None

    title = get('title')
    if title:
        out['Title'] = title.strip()
    elif fallback_title:
        out['Title'] = fallback_title

    authors_list = [v for k, v in citations if k.lower() == 'author']
    authors_list += [v for k, v in dc if k.lower() in ('creator', 'contributor')]
    if not authors_list and get('author'):
        authors_list = [get('author')]
    if authors_list:
        parts = []
        seen = set()
        for a in authors_list:
            a = a.strip()
            if ',' in a:
                normalized = a
            else:
                toks = a.split()
                if len(toks) >= 2:
                    normalized = f'{toks[-1]}, {" ".join(toks[:-1])}'
                else:
                    normalized = a
            key = normalized.lower()
            if key in seen:
                continue
            seen.add(key)
            parts.append(normalized)
        out['Authors'] = '; '.join(parts)

    year = get('date', 'publication_date')
    if year:
        m = _re.search(r'\b(19|20)\d{2}\b', year)
        if m:
            try:
                out['Any'] = int(m.group(0))
            except ValueError:
                pass
    journal = get('journal_title', 'publisher')
    if journal:
        out['Llibre/Revista'] = journal
    if get('doi'):
        out['DOI'] = _legacy_normalize_doi(get('doi')) or get('doi')
    if get('isbn'):
        out['ISBN'] = _legacy_normalize_isbn(get('isbn')) or get('isbn')
    if get('volume'):
        out['Volum'] = get('volume')
    if get('issue'):
        out['Número'] = get('issue')
    if get('firstpage') and get('lastpage'):
        out['Pàgines'] = f"{get('firstpage')}-{get('lastpage')}"
    elif get('firstpage'):
        out['Pàgines'] = get('firstpage')
    if get('language'):
        out['Idioma'] = get('language')
    out['URL'] = url
    return out


HTML_HIGHWIRE = """
<html><head>
<title>Some page</title>
<meta name="citation_title" content="Real Title">
<meta name="citation_author" content="Smith, John A.">
<meta name="citation_author" content="Doe, Jane">
<meta name="citation_publication_date" content="2020/05/15">
<meta name="citation_journal_title" content="Some Journal">
<meta name="citation_volume" content="42">
<meta name="citation_issue" content="7">
<meta name="citation_firstpage" content="100">
<meta name="citation_lastpage" content="120">
<meta name="citation_doi" content="https://doi.org/10.1234/abc.def">
<meta name="citation_language" content="en">
</head></html>
"""

HTML_OG_FALLBACK = """
<html><head>
<title>Page Title Fallback</title>
<meta property="og:title" content="OG Title">
<meta property="og:author" content="Plato">
</head></html>
"""

HTML_PUBLISHER_QUIRK = """
<html><head>
<title>Quirk</title>
<meta name="citation_title" content="Some Article">
<meta name="DC.publisher" content="Acme Press">
</head></html>
"""

HTML_TITLE_FALLBACK = """
<html><head><title>Just A Title</title></head></html>
"""


@pytest.mark.parametrize("html,name", [
    (HTML_HIGHWIRE, 'highwire'),
    (HTML_OG_FALLBACK, 'og_fallback'),
    (HTML_TITLE_FALLBACK, 'title_fallback'),
    # NOTE: HTML_PUBLISHER_QUIRK is NOT here; the legacy quirk (publisher →
    # Llibre/Revista when there was no journal_title) was incorrect and has been
    # fixed in html_meta_to_zotero_item. See the specific test below.
])
def test_html_pipeline_equivalent_to_legacy(html, name):
    url = "https://example.com/article"
    new = zotero_item_to_recursos(html_meta_to_zotero_item(html, url))
    legacy = _legacy_html_meta_to_recursos(html, url)
    assert new == legacy, f"divergence on {name}: new={new} legacy={legacy}"


def test_html_publisher_now_separated_from_journal():
    """publisher goes to Editorial; journal_title goes to Llibre/Revista.

    Before (legacy): `publisher` fell into Llibre/Revista if there was no
    journal_title. It was incorrect — it overwrote the journal's name
    with the publisher's.
    
    """
    url = "https://example.com/x"
    out = zotero_item_to_recursos(html_meta_to_zotero_item(HTML_PUBLISHER_QUIRK, url))
    assert out.get('Editorial') == 'Acme Press'
    assert 'Llibre/Revista' not in out


def test_html_journal_and_publisher_coexist():
    """If both are present, each goes to its own field; they are not mixed."""
    html = """
    <html><head>
    <title>X</title>
    <meta name="citation_journal_title" content="Nature">
    <meta name="DC.publisher" content="Springer Nature">
    </head></html>
    """
    out = zotero_item_to_recursos(html_meta_to_zotero_item(html, "https://x.com"))
    assert out['Llibre/Revista'] == 'Nature'
    assert out['Editorial'] == 'Springer Nature'


def test_html_url_always_present():
    """The URL parameter is always included, even if the HTML is empty."""
    out = zotero_item_to_recursos(html_meta_to_zotero_item("<html></html>", "https://x.com"))
    assert out['URL'] == 'https://x.com'
