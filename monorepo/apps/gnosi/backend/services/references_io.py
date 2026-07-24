"""Import/Export BibTeX and RIS ↔ Recursos fields (Gnosi).

**Pure** functions (stdlib + the `csl_type_resolver`/`zotero_schema` data
modules) — they don't depend on FastAPI, the vault or the network, so they can
be tested in isolation. The output dicts use the
canonical Recursos column names (see the directive
`gnosi_native_reference_manager.md`):
`Citation Key`, `Item Type`, `Authors`, `Any`, `Llibre/Revista`, `Editorial`,
`Lloc`, `Volum`, `Número`, `Pàgines`, `Edició`, `DOI`, `ISBN`, `ISSN`, `URL`,
`Idioma`, `Title`, `Títol del llibre`.

`Item Type` spaces: **parsing** emits the canonical Zotero key (`'book'`) —
the write boundary (`vault_routes` import endpoint) converts it to the label
of the target table's select catalog via `normalize_item_type`, so the vault
only ever stores catalog labels. **Serializing** accepts BOTH spaces
(`'Llibre'` or `'book'`) through `resolve_zotero_item_type`; without it,
every label-typed record exported as `@misc`/`GEN`.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Dict, List

# Pure sibling module (data tables only) — keeps this module free of backend
# and network dependencies.
from backend.services.csl_type_resolver import resolve_zotero_item_type

# Common LaTeX accents in BibTeX → Unicode combining diacritic.
_LATEX_ACCENTS = {
    "'": '́', '`': '̀', '"': '̈', '^': '̂', '~': '̃',
    '=': '̄', '.': '̇', 'c': '̧', 'v': '̌', 'u': '̆',
    'H': '̋',
}


def _decode_latex_accents(s: str) -> str:
    """`Sin\\'ead` → `Sinéad`, `\\c{c}` → `ç`. Covers the forms `\\'{e}` and `\\'e`."""
    def repl(m: 're.Match') -> str:
        comb = _LATEX_ACCENTS.get(m.group(1))
        if not comb:
            return m.group(0)
        return unicodedata.normalize('NFC', m.group(2) + comb)
    # Accents with braces: `\'{e}`, `\c{c}`, `\v{S}`, `\H{o}`… (the command letters
    # c/v/u/H ONLY in braced form).
    s = re.sub(r"\\([`'\"^~=.cvuH])\{(\w)\}", repl, s)
    # SYMBOL accents without braces: `\'e`, `\"u`, `\^o`… The sign (`' " ^ ~ = .`)
    # cannot start a word LaTeX command, so it's safe.
    #
    # The command-letters c/v/u/H without braces are NOT included here (there used to be
    # `\\([cvuH])\{?(\w)\}?` with the key OPTIONAL): it used to match LaTeX commands like
    # `\url{…}`, `\cite{…}` or `\verbatim` and CORRUPTED them (`\url` → `r̆l`,
    # because `\u`+`r` was read as a breve). The braced form already covers the
    # line above; the unbraced form (`\cc`) is non-standard (exporters —
    # Zotero, JabRef… — always write `\c{c}`).
    s = re.sub(r"\\([`'\"^~=.])(\w)", repl, s)
    return s

# ---------------------------------------------------------------------------
# Type maps.
# ---------------------------------------------------------------------------
_BIBTEX_TYPE_TO_ITEM = {
    'article': 'journalArticle',
    'book': 'book',
    'booklet': 'book',
    'inbook': 'bookSection',
    'incollection': 'bookSection',
    'inproceedings': 'conferencePaper',
    'conference': 'conferencePaper',
    'proceedings': 'book',
    'phdthesis': 'thesis',
    'mastersthesis': 'thesis',
    'techreport': 'report',
    'manual': 'book',
    'misc': 'document',
    'unpublished': 'manuscript',
    'online': 'webpage',
    'electronic': 'webpage',
}
_ITEM_TO_BIBTEX_TYPE = {
    'journalArticle': 'article', 'magazineArticle': 'article', 'newspaperArticle': 'article',
    'book': 'book', 'bookSection': 'incollection', 'conferencePaper': 'inproceedings',
    'thesis': 'phdthesis', 'report': 'techreport', 'webpage': 'online',
    'preprint': 'misc', 'document': 'misc', 'manuscript': 'unpublished',
}
_RIS_TYPE_TO_ITEM = {
    'JOUR': 'journalArticle', 'MGZN': 'magazineArticle', 'NEWS': 'newspaperArticle',
    'BOOK': 'book', 'CHAP': 'bookSection', 'CONF': 'conferencePaper', 'CPAPER': 'conferencePaper',
    'THES': 'thesis', 'RPRT': 'report', 'ELEC': 'webpage', 'GEN': 'document',
}
_ITEM_TO_RIS_TYPE = {
    'journalArticle': 'JOUR', 'magazineArticle': 'MGZN', 'newspaperArticle': 'NEWS',
    'book': 'BOOK', 'bookSection': 'CHAP', 'conferencePaper': 'CONF',
    'thesis': 'THES', 'report': 'RPRT', 'webpage': 'ELEC', 'document': 'GEN', 'preprint': 'JOUR',
}

# "Simple" Recursos fields in canonical serialization order.
_RECURSOS_SIMPLE_FIELDS = [
    'Title', 'Any', 'Llibre/Revista', 'Títol del llibre', 'Editorial', 'Lloc',
    'Volum', 'Número', 'Pàgines', 'Edició', 'DOI', 'ISBN', 'ISSN', 'URL', 'Idioma',
]


# ---------------------------------------------------------------------------
# Author normalization.
# ---------------------------------------------------------------------------

def _name_to_canonical(name: str) -> str:
    """`"First Last"` → `"Last, First"`; keeps `"Last, First"` if it already has a comma."""
    name = (name or '').strip()
    if not name or ',' in name:
        return name
    toks = name.split()
    if len(toks) == 1:
        return toks[0]
    return f"{toks[-1]}, {' '.join(toks[:-1])}"


def _authors_to_recursos_string(authors: List[str]) -> str:
    """List of authors → canonical Recursos string (`"Last, First; …"`)."""
    out = [_name_to_canonical(a) for a in authors if a and a.strip()]
    return '; '.join(o for o in out if o)


def _recursos_authors_to_list(authors) -> List[str]:
    """Field `Authors` from Recursos (string or structured) → list `"Cognom, Nom"`."""
    if isinstance(authors, list):
        out = []
        for a in authors:
            if isinstance(a, dict):
                fam = ' '.join(p for p in [a.get('cognom1'), a.get('cognom2')] if p).strip()
                given = (a.get('nom') or '').strip()
                if fam and given:
                    out.append(f"{fam}, {given}")
                elif fam:
                    out.append(fam)
                elif given:
                    out.append(given)
            elif isinstance(a, str) and a.strip():
                out.append(a.strip())
        return out
    if isinstance(authors, str) and authors.strip():
        return [p.strip() for p in authors.split(';') if p.strip()]
    return []


def _meta_authors(meta: Dict):
    """Author source for export: the structured `autoria` value if the page has
    one, else the legacy `Authors` string.

    Found by SHAPE (a list of dicts with `nom`/`cognom1`/`cognom2`), not by key
    name, because the field is stored under the user-renamable field name —
    mirror of `_find_structured_authors` in vault_routes. Reading only
    `Authors` exported records without any author at all: the import path even
    deletes `Authors` after filling `Autoría` (`_fill_autoria_from_authors`),
    so a reference imported from BibTeX and re-exported lost its author."""
    for v in meta.values():
        if isinstance(v, list) and any(
            isinstance(a, dict) and ('cognom1' in a or 'cognom2' in a or 'nom' in a)
            for a in v
        ):
            return v
    return meta.get('Authors')


# ---------------------------------------------------------------------------
# BibTeX — parse.
# ---------------------------------------------------------------------------

def _strip_bibtex_value(raw: str) -> str:
    """Cleans a BibTeX value: strips outer braces/quotes, collapses whitespace, and
    undoes some common escape sequences."""
    s = raw.strip()
    # Removes one level of outer {…} or "…".
    while len(s) >= 2 and ((s[0] == '{' and s[-1] == '}') or (s[0] == '"' and s[-1] == '"')):
        s = s[1:-1].strip()
    # Decodes LaTeX accents before stripping the inner braces (which may
    # be part of `\'{e}`).
    s = _decode_latex_accents(s)
    s = s.replace('{', '').replace('}', '')
    # Undoes LaTeX escaping (symmetric with `_bibtex_escape`) so that the
    # round-trip export→import recovers the literal text.
    s = re.sub(r'\\([&%$#_])', r'\1', s)
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


def _parse_bibtex_fields(body: str) -> Dict[str, str]:
    """Parses `name = value, …` respecting balanced braces and quotes."""
    fields: Dict[str, str] = {}
    i, n = 0, len(body)
    while i < n:
        # field name
        m = re.match(r'\s*([A-Za-z][\w-]*)\s*=\s*', body[i:])
        if not m:
            # skips to the next level-0 comma
            nxt = body.find(',', i)
            if nxt == -1:
                break
            i += (nxt - i) + 1
            continue
        name = m.group(1).lower()
        i += m.end()
        # value: balanced {…}, "…", or a bare token up to the comma
        if i < n and body[i] == '{':
            depth, j = 0, i
            while j < n:
                if body[j] == '{':
                    depth += 1
                elif body[j] == '}':
                    depth -= 1
                    if depth == 0:
                        j += 1
                        break
                j += 1
            value, i = body[i:j], j
        elif i < n and body[i] == '"':
            j = i + 1
            while j < n and body[j] != '"':
                j += 1
            value, i = body[i:j + 1], min(j + 1, n)
        else:
            nxt = body.find(',', i)
            if nxt == -1:
                nxt = n
            value, i = body[i:nxt], nxt
        fields[name] = _strip_bibtex_value(value)
        # Consume the separator comma.
        while i < n and body[i] in ' \t\r\n':
            i += 1
        if i < n and body[i] == ',':
            i += 1
    return fields


def _bibtex_entry_to_recursos(etype: str, key: str, f: Dict[str, str]) -> Dict:
    out: Dict = {'Citation Key': key, 'Item Type': _BIBTEX_TYPE_TO_ITEM.get(etype, 'document')}
    if f.get('title'):
        out['Title'] = f['title']
    if f.get('author'):
        authors = [a.strip() for a in re.split(r'\s+and\s+', f['author']) if a.strip()]
        s = _authors_to_recursos_string(authors)
        if s:
            out['Authors'] = s
    if f.get('year'):
        m = re.search(r'\d{4}', f['year'])
        if m:
            out['Any'] = int(m.group(0))
    # journal (articles) or booktitle (chapters/conf)
    if f.get('journal'):
        out['Llibre/Revista'] = f['journal']
    elif f.get('booktitle'):
        out['Llibre/Revista'] = f['booktitle']
        out['Títol del llibre'] = f['booktitle']
    if f.get('publisher'):
        out['Editorial'] = f['publisher']
    if f.get('address'):
        out['Lloc'] = f['address']
    if f.get('volume'):
        out['Volum'] = f['volume']
    if f.get('number'):
        out['Número'] = f['number']
    if f.get('pages'):
        out['Pàgines'] = f['pages'].replace('--', '-')
    if f.get('edition'):
        out['Edició'] = f['edition']
    if f.get('doi'):
        out['DOI'] = f['doi']
    if f.get('isbn'):
        out['ISBN'] = f['isbn']
    if f.get('issn'):
        out['ISSN'] = f['issn']
    if f.get('url'):
        out['URL'] = f['url']
    if f.get('language'):
        out['Idioma'] = f['language']
    return out


def parse_bibtex(text: str) -> List[Dict]:
    """Parses a BibTeX document → list of Recursos metadata dicts."""
    entries: List[Dict] = []
    n = len(text)
    i = 0
    while i < n:
        at = text.find('@', i)
        if at == -1:
            break
        m = re.match(r'@(\w+)\s*\{\s*', text[at:])
        if not m:
            i = at + 1
            continue
        etype = m.group(1).lower()
        cur = at + m.end()
        # ignore @comment/@string/@preamble
        if etype in ('comment', 'string', 'preamble'):
            i = cur
            continue
        # Find this entry's balanced closing brace FIRST, so the key search
        # cannot run past it into a later entry. A field-less entry like
        # `@misc{key}` has no comma before its own closing brace; using a global
        # `find(',')` there would grab a later entry's comma and mangle/drop it.
        depth, j = 1, cur
        while j < n and depth > 0:
            if text[j] == '{':
                depth += 1
            elif text[j] == '}':
                depth -= 1
            j += 1
        entry_close = j - 1  # index of this entry's closing '}'
        # key up to the first comma BEFORE the closing brace
        comma = text.find(',', cur, entry_close)
        if comma == -1:
            # No fields: the whole {...} content is the citation key.
            key = text[cur:entry_close].strip()
            fields: Dict[str, str] = {}
        else:
            key = text[cur:comma].strip()
            body = text[comma + 1:entry_close]
            fields = _parse_bibtex_fields(body)
        if key:
            entries.append(_bibtex_entry_to_recursos(etype, key, fields))
        i = j
    return entries


# ---------------------------------------------------------------------------
# BibTeX — serialize.
# ---------------------------------------------------------------------------

def _bibtex_escape(value: str) -> str:
    # Special LaTeX characters that, if not escaped, break the compilation
    # of an exported BibTeX (very common in titles: "C_max", "F#", "$O(n)$",
    # "50% & more"). The symmetric unescaping is in `_strip_bibtex_value`. We don't
    # touch `{ } \ ^ ~` (they need special handling and are much rarer).
    return (
        str(value)
        .replace('&', r'\&')
        .replace('%', r'\%')
        .replace('$', r'\$')
        .replace('#', r'\#')
        .replace('_', r'\_')
    )


def entry_to_bibtex(meta: Dict) -> str:
    key = str(meta.get('Citation Key') or 'ref').strip() or 'ref'
    item_type = meta.get('Item Type') or 'document'
    # The map is keyed by canonical Zotero keys, but the vault stores translated
    # labels ('Llibre'); without resolving, every native record exported @misc.
    btype = _ITEM_TO_BIBTEX_TYPE.get(resolve_zotero_item_type(item_type), 'misc')
    lines = [f"@{btype}{{{key},"]
    fld: List[tuple] = []
    if meta.get('Title'):
        fld.append(('title', meta['Title']))
    authors = _recursos_authors_to_list(_meta_authors(meta))
    if authors:
        fld.append(('author', ' and '.join(authors)))
    if meta.get('Any') not in (None, '', 'null'):
        fld.append(('year', str(meta['Any'])))
    container = meta.get('Llibre/Revista') or meta.get('Títol del llibre')
    if container:
        fld.append(('journal' if btype == 'article' else 'booktitle', container))
    if meta.get('Editorial'):
        fld.append(('publisher', meta['Editorial']))
    if meta.get('Lloc'):
        fld.append(('address', meta['Lloc']))
    if meta.get('Volum'):
        fld.append(('volume', meta['Volum']))
    if meta.get('Número'):
        fld.append(('number', meta['Número']))
    if meta.get('Pàgines'):
        fld.append(('pages', str(meta['Pàgines']).replace('-', '--')))
    if meta.get('Edició'):
        fld.append(('edition', meta['Edició']))
    if meta.get('DOI'):
        fld.append(('doi', meta['DOI']))
    if meta.get('ISBN'):
        fld.append(('isbn', meta['ISBN']))
    if meta.get('ISSN'):
        fld.append(('issn', meta['ISSN']))
    if meta.get('URL'):
        fld.append(('url', meta['URL']))
    if meta.get('Idioma'):
        fld.append(('language', meta['Idioma']))
    body = ',\n'.join(f"  {name} = {{{_bibtex_escape(val)}}}" for name, val in fld)
    return lines[0] + ('\n' + body if body else '') + '\n}'


def to_bibtex(entries: List[Dict]) -> str:
    return '\n\n'.join(entry_to_bibtex(e) for e in entries) + '\n'


# ---------------------------------------------------------------------------
# RIS — parse.
# ---------------------------------------------------------------------------

def parse_ris(text: str) -> List[Dict]:
    """Parses an RIS document → list of Recursos metadata dicts."""
    entries: List[Dict] = []
    cur: Dict[str, List[str]] = {}

    def flush():
        if cur:
            entries.append(_ris_record_to_recursos(cur))
            cur.clear()

    for raw in text.splitlines():
        m = re.match(r'^([A-Z][A-Z0-9])\s{2}-\s?(.*)$', raw.rstrip('\r\n'))
        if not m:
            continue
        tag, val = m.group(1), m.group(2).strip()
        if tag == 'ER':
            flush()
            continue
        if tag == 'TY':
            flush()
        cur.setdefault(tag, []).append(val)
    flush()
    return entries


def _ris_record_to_recursos(r: Dict[str, List[str]]) -> Dict:
    def first(*tags):
        for t in tags:
            if r.get(t):
                return r[t][0]
        return ''

    out: Dict = {}
    ty = (r.get('TY') or ['GEN'])[0]
    out['Item Type'] = _RIS_TYPE_TO_ITEM.get(ty, 'document')
    if first('ID'):
        out['Citation Key'] = first('ID')
    if first('TI', 'T1'):
        out['Title'] = first('TI', 'T1')
    authors = (r.get('AU') or []) + (r.get('A1') or [])
    if authors:
        s = _authors_to_recursos_string(authors)
        if s:
            out['Authors'] = s
    year = first('PY', 'Y1', 'DA')
    m = re.search(r'\d{4}', year)
    if m:
        out['Any'] = int(m.group(0))
    journal = first('JO', 'JF', 'T2', 'J2')
    if journal:
        out['Llibre/Revista'] = journal
    if first('PB'):
        out['Editorial'] = first('PB')
    if first('CY', 'PP'):
        out['Lloc'] = first('CY', 'PP')
    if first('VL'):
        out['Volum'] = first('VL')
    if first('IS'):
        out['Número'] = first('IS')
    sp, ep = first('SP'), first('EP')
    if sp and ep:
        out['Pàgines'] = f"{sp}-{ep}"
    elif sp:
        out['Pàgines'] = sp
    if first('DO'):
        out['DOI'] = first('DO')
    if first('SN'):
        # SN serves both ISBN and ISSN; heuristic for the ISSN hyphen.
        sn = first('SN')
        out['ISSN' if re.match(r'^\d{4}-\d{3}[\dxX]$', sn) else 'ISBN'] = sn
    if first('UR', 'L1'):
        out['URL'] = first('UR', 'L1')
    if first('LA'):
        out['Idioma'] = first('LA')
    return out


# ---------------------------------------------------------------------------
# RIS — serialize.
# ---------------------------------------------------------------------------

def entry_to_ris(meta: Dict) -> str:
    item_type = meta.get('Item Type') or 'document'
    # Same label→Zotero-key resolution as `entry_to_bibtex` (see the note there).
    ty = _ITEM_TO_RIS_TYPE.get(resolve_zotero_item_type(item_type), 'GEN')
    lines = [f"TY  - {ty}"]
    if meta.get('Citation Key'):
        lines.append(f"ID  - {meta['Citation Key']}")
    if meta.get('Title'):
        lines.append(f"TI  - {meta['Title']}")
    for a in _recursos_authors_to_list(_meta_authors(meta)):
        lines.append(f"AU  - {a}")
    if meta.get('Any') not in (None, '', 'null'):
        lines.append(f"PY  - {meta['Any']}")
    container = meta.get('Llibre/Revista') or meta.get('Títol del llibre')
    if container:
        lines.append(f"JO  - {container}")
    if meta.get('Editorial'):
        lines.append(f"PB  - {meta['Editorial']}")
    if meta.get('Lloc'):
        lines.append(f"CY  - {meta['Lloc']}")
    if meta.get('Volum'):
        lines.append(f"VL  - {meta['Volum']}")
    if meta.get('Número'):
        lines.append(f"IS  - {meta['Número']}")
    pages = str(meta.get('Pàgines') or '')
    if pages:
        parts = re.split(r'\s*-\s*', pages, maxsplit=1)
        lines.append(f"SP  - {parts[0]}")
        if len(parts) == 2:
            lines.append(f"EP  - {parts[1]}")
    if meta.get('DOI'):
        lines.append(f"DO  - {meta['DOI']}")
    if meta.get('ISSN'):
        lines.append(f"SN  - {meta['ISSN']}")
    elif meta.get('ISBN'):
        lines.append(f"SN  - {meta['ISBN']}")
    if meta.get('URL'):
        lines.append(f"UR  - {meta['URL']}")
    if meta.get('Idioma'):
        lines.append(f"LA  - {meta['Idioma']}")
    lines.append("ER  - ")
    return '\n'.join(lines)


def to_ris(entries: List[Dict]) -> str:
    return '\n'.join(entry_to_ris(e) for e in entries) + '\n'


# ---------------------------------------------------------------------------
# Auto-detect + dispatch.
# ---------------------------------------------------------------------------

def detect_format(text: str) -> str:
    """`'bibtex'`, `'ris'`, or `'unknown'` depending on the content."""
    head = text.lstrip()[:4000]
    if re.search(r'^\s*TY\s{2}-\s', head, re.MULTILINE):
        return 'ris'
    if re.search(r'@\w+\s*\{', head):
        return 'bibtex'
    return 'unknown'


def parse_references(text: str, fmt: str = 'auto') -> List[Dict]:
    if fmt == 'auto':
        fmt = detect_format(text)
    if fmt == 'bibtex':
        return parse_bibtex(text)
    if fmt == 'ris':
        return parse_ris(text)
    return []


def serialize_references(entries: List[Dict], fmt: str) -> str:
    if fmt == 'bibtex':
        return to_bibtex(entries)
    if fmt == 'ris':
        return to_ris(entries)
    raise ValueError(f"Format no suportat: {fmt}")
