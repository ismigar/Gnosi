#!/usr/bin/env python3
"""Zotero → Vault enrich-only sync + Citation Key fixer.

Pensat per a la migració inicial (Fase 1 de la roadmap Zotero → Gnosi com
a font única). Diferent de `zotero_to_vault.py`:

  - Match en cadena per a maximitzar encerts amb mínim risc:
      1. Zotero URI exacta
      2. DOI normalitzat
      3. Títol normalitzat (skipped per a colisions)
  - PATCH (no PUT) sobre el backend: la metadata existent al Vault queda
    intacta (Citation Key, Tags personals, Estat, relacions `📀…`, etc.).
  - Heurística "enrich-only": un camp del Vault només es modifica si està
    buit. Els 4 camps de "metadata pura" (Zotero URI, Clau Zotero, Item
    Type, Date Added/Modified) sí es sobreescriuen sempre.
  - No crea pàgines noves al mode default. Les llista per a revisió manual.
  - Mode `--create-missing` (opcional): crea pàgina nova a la taula
    objectiu per cada item Zotero sense match.

Per què no és part de `zotero_to_vault.py`: aquell sync està dissenyat
per a fer una rèplica completa Zotero → Vault, no per a una migració
puntual respectuosa amb el contingut humà existent. Quan vulguis
desactivar definitivament Zotero, aquest script és el camí d'una via.

Ús:
    python3 zotero_enrich.py                     # dry-run (default)
    python3 zotero_enrich.py --apply             # escriu els PATCH
    python3 zotero_enrich.py --apply --create-missing  # + crea sense match
    python3 zotero_enrich.py --fix-keys          # detecta i corregeix
                                                  # Citation Keys malparsejats
                                                  # per coma-com-a-separador
                                                  # d'autors (cas Margulis)
    python3 zotero_enrich.py --fix-keys --apply  # idem, escrivint els canvis

Vegeu la directiva `docs/dev_memory/directives/zotero_one_way_migration.md`
i la memòria personal `feedback_zotero_mapping`.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Configuració. Defaults pensats per al setup actual del projecte. Es poden
# sobreescriure via env vars per a portabilitat.
# ---------------------------------------------------------------------------

ZOTERO_DB = os.path.expanduser(os.environ.get('ZOTERO_DB', '~/Zotero/zotero.sqlite'))
RECURSOS_TABLE = os.environ.get('RECURSOS_TABLE_ID', '8c80f2a861b843b790da4f0e260b7db9')
VAULT_API = os.environ.get('VAULT_API', 'http://localhost:5173/api/vault')
LINKED_BASE = os.path.expanduser(os.environ.get(
    'ZOTERO_LINKED_BASE',
    '~/Library/CloudStorage/OneDrive-UNED/Biblioteca',
))

# Mapping Zotero field → property name del Recursos. Aquest mapping s'ha
# derivat de l'endpoint `/api/zotero/suggest-mapping` un cop i deixat
# inline aquí perquè el script no requereixi cap config al backend.
# Si reanomenes columnes al Vault, actualitza aquest dict.
FIELD_MAP = {
    'authors':         'Authors',
    'year':            'Any',
    'doi':             'DOI',
    'isbn':            'ISBN',
    'issn':            'ISSN',
    'url':             'URL',
    'publisher':       'Editorial',
    'place':           'Lloc',
    'publication':     'Llibre/Revista',
    'book_title':      'Títol del llibre',
    'volume':          'Volum',
    'issue':           'Número',
    'pages':           'Pàgines',
    'edition':         'Edició',
    'series':          'Col·lecció',
    'series_number':   'Número de col·lecció',
    'num_pages':       'Núm. pàgines',
    'short_title':     'Títol curt',
    'institution':     'Institució',
    'university':      'Universitat',
    'journal_abbrev':  'Abreviatura revista',
    'library_catalog': 'Catàleg',
    'call_number':     'Signatura',
    'archive':         'Arxiu',
    'archive_location': 'Localització arxiu',
    'rights':          'Drets',
    'extra':           'Extra',
    'attachment_path': 'File Path',
}

# Camps de "metadata pura" — Zotero sempre té raó. Inclou identificadors
# i timestamps que cap usuari no tocaria a mà.
ALWAYS_OVERWRITE = {
    'uri':           'Zotero URI',
    'key':           'Clau Zotero',
    'type':          'Item Type',
    'date_added':    'Date Added',
    'date_modified': 'Date Modified',
}


# ---------------------------------------------------------------------------
# Lectura de la BD Zotero. Cal copiar el fitxer abans (l'app Zotero el manté
# obert i `sqlite3` no permet lectura concurrent en alguns modes).
# ---------------------------------------------------------------------------


def open_zotero_db() -> sqlite3.Connection:
    if not os.path.exists(ZOTERO_DB):
        raise FileNotFoundError(f'Zotero DB not found at {ZOTERO_DB}')
    tmp = '/tmp/zotero_enrich.sqlite'
    shutil.copy2(ZOTERO_DB, tmp)
    return sqlite3.connect(f'file:{tmp}?mode=ro', uri=True)


def extract_items(con: sqlite3.Connection) -> list[dict]:
    cur = con.cursor()
    cur.execute("""
        SELECT items.itemID, items.key, itemTypes.typeName, items.dateAdded, items.dateModified
        FROM items
        JOIN itemTypes ON items.itemTypeID = itemTypes.itemTypeID
        WHERE itemTypes.typeName NOT IN ('attachment', 'note', 'annotation')
          AND items.itemID NOT IN (SELECT itemID FROM deletedItems)
    """)
    rows = cur.fetchall()

    items = []
    for item_id, key, typ, da, dm in rows:
        cur.execute("""
            SELECT f.fieldName, dv.value
            FROM itemData id
            JOIN fields f ON id.fieldID = f.fieldID
            JOIN itemDataValues dv ON id.valueID = dv.valueID
            WHERE id.itemID = ?
        """, (item_id,))
        fields = dict(cur.fetchall())

        cur.execute("""
            SELECT c.firstName, c.lastName, ict.creatorType
            FROM itemCreators ic
            JOIN creators c ON ic.creatorID = c.creatorID
            JOIN creatorTypes ict ON ic.creatorTypeID = ict.creatorTypeID
            WHERE ic.itemID = ?
            ORDER BY ic.orderIndex
        """, (item_id,))
        creators = list(cur.fetchall())
        authors = ", ".join(
            f"{(r[0] or '').strip()} {(r[1] or '').strip()}".strip()
            for r in creators if r[2] == 'author'
        )

        cur.execute("""
            SELECT t.name
            FROM itemTags it JOIN tags t ON it.tagID = t.tagID
            WHERE it.itemID = ? ORDER BY t.name
        """, (item_id,))
        tags = [r[0] for r in cur.fetchall()]

        cur.execute("""
            SELECT items.key, ia.linkMode, ia.path
            FROM itemAttachments ia JOIN items ON items.itemID = ia.itemID
            WHERE ia.parentItemID = ?
            ORDER BY items.dateAdded ASC
        """, (item_id,))
        att_path = None
        for att_key, linkmode, p in cur.fetchall():
            if not p:
                continue
            # `attachments:<rel>` → relatiu a LINKED_BASE (cas comú: PDFs
            # a OneDrive/Biblioteca, no a ~/Zotero/storage)
            if p.startswith('attachments:'):
                full = os.path.join(LINKED_BASE, p[len('attachments:'):])
                if os.path.exists(full):
                    att_path = full
                    break
            elif p.startswith('/') and os.path.exists(p):
                att_path = p
                break

        year = None
        if fields.get('date'):
            m = re.match(r'(\d{4})', fields['date'])
            if m:
                year = int(m.group(1))

        items.append({
            'key': key,
            'uri': f'zotero://select/library/items/{key}',
            'type': typ,
            'title': fields.get('title') or '',
            'authors': authors,
            'year': year,
            'date': fields.get('date'),
            'date_added': da,
            'date_modified': dm,
            'doi': fields.get('DOI'),
            'isbn': fields.get('ISBN'),
            'issn': fields.get('ISSN'),
            'url': fields.get('url'),
            'publisher': fields.get('publisher'),
            'place': fields.get('place'),
            'publication': fields.get('publicationTitle'),
            'book_title': fields.get('bookTitle'),
            'volume': fields.get('volume'),
            'issue': fields.get('issue'),
            'pages': fields.get('pages'),
            'edition': fields.get('edition'),
            'series': fields.get('series'),
            'series_number': fields.get('seriesNumber'),
            'num_pages': fields.get('numPages'),
            'abstract': fields.get('abstractNote'),
            'language': fields.get('language'),
            'extra': fields.get('extra'),
            'short_title': fields.get('shortTitle'),
            'institution': fields.get('institution'),
            'university': fields.get('university'),
            'journal_abbrev': fields.get('journalAbbreviation'),
            'library_catalog': fields.get('libraryCatalog'),
            'call_number': fields.get('callNumber'),
            'archive': fields.get('archive'),
            'archive_location': fields.get('archiveLocation'),
            'rights': fields.get('rights'),
            'attachment_path': att_path,
            'tags': tags,
        })
    return items


# ---------------------------------------------------------------------------
# Helpers de normalització i matching.
# ---------------------------------------------------------------------------


def norm_text(s: Optional[str]) -> str:
    if not s:
        return ''
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'[\W_]+', ' ', s)
    return ' '.join(s.split())


def norm_doi(s: Optional[str]) -> str:
    if not s:
        return ''
    return re.sub(r'^https?://(dx\.)?doi\.org/', '', s.strip().lower())


def is_empty(v) -> bool:
    if v is None:
        return True
    if isinstance(v, str) and v.strip() == '':
        return True
    if isinstance(v, list) and not v:
        return True
    return False


# ---------------------------------------------------------------------------
# Crides al backend Gnosi.
# ---------------------------------------------------------------------------


def fetch_recursos() -> list[dict]:
    url = f'{VAULT_API}/pages?table_id={RECURSOS_TABLE}'
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def patch_page(page_id: str, props: dict) -> object:
    body = json.dumps({'metadata': props}).encode()
    req = urllib.request.Request(
        f'{VAULT_API}/pages/{urllib.parse.quote(page_id)}',
        method='PATCH', data=body,
        headers={'Content-Type': 'application/json'},
    )
    # Backoff per a errno 35 d'OneDrive (deadlock al sync). El daemon de
    # warmup gestiona els placeholders, però els PATCH consecutius poden
    # competir momentàniament amb OneDrive Sync Service.
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status
        except urllib.error.HTTPError as e:
            if e.code == 500 and attempt < 3:
                time.sleep(0.5 * (2 ** attempt))
                continue
            return f'HTTP {e.code}'
        except Exception as e:
            return f'ERR: {e}'
    return 'EXHAUSTED'


def create_page(item: dict) -> tuple[Optional[str], object]:
    """POST a /pages amb metadata Zotero. Retorna (page_id, status)."""
    meta = {'database_table_id': RECURSOS_TABLE, 'source': 'Zotero'}
    for src, dst in ALWAYS_OVERWRITE.items():
        v = item.get(src)
        if v:
            meta[dst] = v
    for src, dst in FIELD_MAP.items():
        v = item.get(src)
        if v:
            meta[dst] = v
    payload = {
        'title': item.get('title') or item.get('key') or 'Sense títol',
        'content': '',
        'metadata': meta,
    }
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f'{VAULT_API}/pages',
        method='POST', data=body,
        headers={'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
            return data.get('id'), r.status
    except urllib.error.HTTPError as e:
        return None, f'HTTP {e.code}'
    except Exception as e:
        return None, f'ERR: {e}'


# ---------------------------------------------------------------------------
# Lògica principal.
# ---------------------------------------------------------------------------


def index_recursos(pages: list[dict]) -> tuple[dict, dict, dict]:
    by_uri, by_doi, by_title = {}, {}, {}
    for p in pages:
        m = p.get('metadata') or {}
        if m.get('Zotero URI'):
            by_uri[m['Zotero URI'].strip()] = p
        if m.get('DOI'):
            by_doi[norm_doi(m['DOI'])] = p
        nt = norm_text(p.get('title') or m.get('Title') or '')
        if nt:
            by_title.setdefault(nt, []).append(p)
    return by_uri, by_doi, by_title


def compute_patch(page: dict, item: dict) -> dict:
    """Retorna el diff a aplicar a `page` perquè absorbeixi data nova de
    `item`, respectant la regla enrich-only."""
    m = page.get('metadata') or {}
    patch = {}
    for src, dst in ALWAYS_OVERWRITE.items():
        v = item.get(src)
        if v and m.get(dst) != v:
            patch[dst] = v
    for src, dst in FIELD_MAP.items():
        v = item.get(src)
        if v and is_empty(m.get(dst)):
            patch[dst] = v
    return patch


def fix_citation_keys(apply_writes: bool) -> int:
    """Re-deriva les Citation Keys per al cas concret en què Zotero usa
    coma sense espai com a separador d'autors (`Lynn. Margulis,Lorraine.
    Olendzenski`) i el meu algorisme original ho confonia amb format
    `Cognom, Inicial`, generant `lynnmargulis` en lloc de `margulis`.

    Detecció: el camp Authors conté `[A-Z]\\.\\s*,\\s*[A-Z]` (Inicial.
    seguit de coma seguit d'Inicial, sense espai darrere del punt). En
    aquest cas, agafem només el primer "autor" abans de la coma i
    fem servir el seu últim mot com a cognom.

    Per als cognoms compostos hispànics legítims (`García Fernández`,
    `Del Pino Díaz`, etc.), NO toca res — són casos vàlids que cal
    decidir manualment si es vol simplificar.
    """
    pages = fetch_recursos()
    # Senyal inequívoc de coma-com-separador a Zotero: coma immediatament
    # seguida de majúscula SENSE espai. Format estàndard d'autor només té
    # `, ` (amb espai). Així distingim:
    #   - `García Fernández, Ismael`           → coma + espai → normal
    #   - `Lynn. Margulis,Lorraine. Olendzenski` → coma + MAJ → cas Margulis
    pattern = re.compile(r',[A-ZÀ-Ÿ]')
    changes: list[tuple[str, str, str, str]] = []  # (page_id, authors_short, old_key, new_key)
    for p in pages:
        m = p.get('metadata') or {}
        authors = m.get('Authors') or ''
        ck = m.get('Citation Key')
        year = m.get('Any')
        if not (authors and ck and year):
            continue
        if not pattern.search(authors):
            continue
        # Reparsejar amb la lògica correcta: la coma és separador d'autors
        first_author = authors.split(',')[0].strip()
        tokens = first_author.split()
        if not tokens:
            continue
        # Últim mot és el cognom; netejar accents i símbols
        cog = tokens[-1].lower()
        cog = (cog.replace('á', 'a').replace('é', 'e').replace('í', 'i')
                  .replace('ó', 'o').replace('ú', 'u').replace('à', 'a')
                  .replace('è', 'e').replace('ò', 'o').replace('ç', 'c')
                  .replace('ñ', 'n').replace('.', ''))
        cog = re.sub(r'[^a-z]', '', cog)
        if not cog:
            continue
        new_key = f'{cog}{year}'
        if new_key != ck:
            # Conservem el sufix a/b/c si existia (per a desambiguació)
            suffix_match = re.search(r'([a-z])$', ck)
            if suffix_match and ck[:-1].endswith(str(year)):
                new_key += suffix_match.group(1)
            changes.append((
                p['id'],
                authors[:60],
                ck,
                new_key,
            ))

    print(f'Casos detectats per re-parsing (coma-com-separador): {len(changes)}')
    for pid, a, old, new in changes:
        print(f'  {old:30s} → {new:20s}  {a}')

    if not apply_writes or not changes:
        if not apply_writes:
            print('\n[DRY-RUN] --apply per escriure els canvis.')
        return 0

    ok = err = 0
    for pid, _, _, new_key in changes:
        res = patch_page(pid, {'Citation Key': new_key})
        if res == 200:
            ok += 1
        else:
            err += 1
            print(f'  ! {pid[:8]}.. → {res}')
    print(f'\nResultat: {ok} ok, {err} err')
    return 0 if err == 0 else 1


def main() -> int:
    apply_writes = '--apply' in sys.argv
    create_missing = '--create-missing' in sys.argv

    if '--fix-keys' in sys.argv:
        return fix_citation_keys(apply_writes)

    con = open_zotero_db()
    items = extract_items(con)
    pages = fetch_recursos()
    by_uri, by_doi, by_title = index_recursos(pages)

    print(f'Zotero items: {len(items)}')
    print(f'Recursos pages: {len(pages)}')

    stats = dict.fromkeys(
        ['match_uri', 'match_doi', 'match_title', 'no_match', 'collisions'],
        0,
    )
    to_update: list[tuple[dict, dict, str, dict]] = []
    no_match: list[dict] = []

    for it in items:
        page = None
        kind = None
        if it['uri'] in by_uri:
            page, kind = by_uri[it['uri']], 'uri'
            stats['match_uri'] += 1
        elif it['doi'] and norm_doi(it['doi']) in by_doi:
            page, kind = by_doi[norm_doi(it['doi'])], 'doi'
            stats['match_doi'] += 1
        else:
            nt = norm_text(it['title'])
            if nt and nt in by_title:
                cands = by_title[nt]
                if len(cands) > 1:
                    stats['collisions'] += 1
                    continue
                page, kind = cands[0], 'title'
                stats['match_title'] += 1
        if not page:
            stats['no_match'] += 1
            no_match.append(it)
            continue

        diff = compute_patch(page, it)
        if diff:
            to_update.append((page, it, kind, diff))

    print('\nMatching:')
    for k, v in stats.items():
        print(f'  {v:4d}  {k}')
    print(f'\nPàgines a actualitzar (patches no buits): {len(to_update)}')
    print(f'Items sense match: {len(no_match)}')

    if not apply_writes:
        print('\n[DRY-RUN] No s\'ha escrit res. --apply per executar.')
        return 0

    ok = err = 0
    errs: list[tuple[str, str, object]] = []
    for i, (page, _, _, diff) in enumerate(to_update):
        res = patch_page(page['id'], diff)
        if res == 200:
            ok += 1
        else:
            err += 1
            if len(errs) < 5:
                errs.append((page['id'][:8], next(iter(diff)), res))
        if (i + 1) % 25 == 0:
            print(f'  · {i + 1}/{len(to_update)} (ok={ok}, err={err})')
    print(f'\nEnrich: {ok} ok, {err} err')
    if errs:
        print(f'  Samples: {errs}')

    if create_missing and no_match:
        print(f'\nCreating {len(no_match)} pages…')
        cok = cerr = 0
        for it in no_match:
            new_id, res = create_page(it)
            if res in (200, 201):
                cok += 1
            else:
                cerr += 1
                print(f'  ! {(it["title"] or "?")[:50]} → {res}')
        print(f'Create: {cok} ok, {cerr} err')

    return 0 if err == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
