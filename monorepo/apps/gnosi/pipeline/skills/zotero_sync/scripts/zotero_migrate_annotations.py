#!/usr/bin/env python3
"""Migra les anotacions PDF de Zotero a `pdf_annotations` del Vault.

Format compatible amb el visor Zotero integrat: cada anotació es desa
amb `comment = '__ZOTERO_JSON__' + JSON.stringify(zoteroAnnotation)` perquè
el reader Zotero pugui reconstruir-la amb fidelitat completa (rects en
PDF coords, sortIndex, color exacte). Els rects normalitzats no els
calculem aquí — el blob complet del comment és suficient per al visor.

source_uri = `file://` + url-quoted del path absolut del PDF.
  - Per `attachments:<rel>` → LINKED_BASE/<rel>
  - Per `storage:<file>` → ~/Zotero/storage/<att_key>/<file>

Dedup: cerca al backend si ja hi ha una anotació amb mateix (source_uri,
page, text) i la salta. Així re-runs no creen duplicats.
"""
import json, os, shutil, sqlite3, sys, time, urllib.parse, urllib.request, urllib.error

ZOTERO_DB = os.path.expanduser('~/Zotero/zotero.sqlite')
ZOTERO_STORAGE = os.path.expanduser('~/Zotero/storage')
LINKED_BASE = os.path.expanduser('~/Library/CloudStorage/OneDrive-UNED/Biblioteca')
VAULT_API = 'http://localhost:5173/api/vault'
APPLY = '--apply' in sys.argv

# Mapeig type INTEGER de Zotero (observat al schema sqlite) → string de l'API
# del reader Zotero. Aquest mapeig és canonical: vegis chrome/locale/en-US/
# zotero/zotero.ftl al repo de Zotero, o data/annotations.js del reader.
TYPE_MAP = {
    1: 'highlight',
    2: 'note',
    3: 'image',
    4: 'ink',
    5: 'underline',
    6: 'text',
}

# --- Lectura Zotero ---
tmp = '/tmp/zotero_migrate_annotations.sqlite'
shutil.copy2(ZOTERO_DB, tmp)
con = sqlite3.connect(f'file:{tmp}?mode=ro', uri=True)
cur = con.cursor()

# Anotacions + parent attachment + filename
cur.execute("""
    SELECT ia.itemID, items.key as ann_key, ia.type, ia.authorName, ia.text,
           ia.comment, ia.color, ia.pageLabel, ia.sortIndex, ia.position,
           items.dateAdded, items.dateModified,
           att.path, att_items.key as att_key, ia.parentItemID
    FROM itemAnnotations ia
    JOIN items ON items.itemID = ia.itemID
    JOIN itemAttachments att ON att.itemID = ia.parentItemID
    JOIN items att_items ON att_items.itemID = att.itemID
    WHERE items.itemID NOT IN (SELECT itemID FROM deletedItems)
""")
rows = cur.fetchall()
print(f'Anotacions a Zotero: {len(rows)}')

# --- Resoldre source_uri per a cada anotació ---
def resolve_path(att_path, att_key):
    if not att_path: return None
    if att_path.startswith('attachments:'):
        rel = att_path[len('attachments:'):]
        return os.path.join(LINKED_BASE, rel)
    if att_path.startswith('storage:'):
        rel = att_path[len('storage:'):]
        return os.path.join(ZOTERO_STORAGE, att_key, rel)
    if att_path.startswith('/'):
        return att_path
    return None

def file_uri(fs_path):
    # quote igual com el sentinel del frontend: només caràcters problemàtics.
    # safe='/:' perquè els slashes i el colon del file:// es preservin
    return 'file://' + urllib.parse.quote(fs_path, safe='/')

# --- Carregar les anotacions ja existents al backend per dedup ---
# No tenim un endpoint "list all", però podem cercar per source_uri quan
# necessitem. Cache local per a la sessió.
seen_per_uri = {}  # source_uri → set( (page, text_snippet) )
def existing_set(source_uri):
    if source_uri in seen_per_uri: return seen_per_uri[source_uri]
    url = f'{VAULT_API}/pdf-annotations?source_uri={urllib.parse.quote(source_uri)}'
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            data = json.loads(r.read())
    except Exception:
        data = []
    s = set()
    for a in data:
        s.add((a.get('page'), (a.get('text') or '').strip()[:80]))
    seen_per_uri[source_uri] = s
    return s

# --- Construir + (opcional) escriure ---
to_create = []  # (source_uri, payload)
skipped_dup = 0
skipped_no_pdf = 0

for r in rows:
    (item_id, ann_key, type_int, author, text, comment, color, page_label,
     sort_index, position_json, date_added, date_modified,
     att_path, att_key, parent_item_id) = r

    fs_path = resolve_path(att_path, att_key)
    if not fs_path or not os.path.exists(fs_path):
        skipped_no_pdf += 1
        continue

    source_uri = file_uri(fs_path)
    type_str = TYPE_MAP.get(type_int, 'highlight')

    # Pos position JSON → pageIndex (0-indexed)
    try:
        pos = json.loads(position_json) if position_json else {}
    except json.JSONDecodeError:
        pos = {}
    page_index = pos.get('pageIndex', 0)
    page_1based = page_index + 1

    # Dedup: si ja existeix una anotació amb (page, text) → skip
    key = (page_1based, (text or '').strip()[:80])
    if key in existing_set(source_uri):
        skipped_dup += 1
        continue

    # Construeix l'anotació Zotero JSON sencera (el visor la reconstruirà)
    zotero_ann = {
        'id': ann_key,
        'type': type_str,
        'color': color or '#ffd400',
        'sortIndex': sort_index or '00000|000000|00000',
        'pageLabel': page_label or str(page_1based),
        'dateCreated': date_added,
        'dateModified': date_modified,
        'authorName': author or '',
        'isAuthorNameAuthoritative': True,
        'text': text or '',
        'comment': comment or '',
        'tags': [],
        'position': pos,
    }

    payload = {
        'source_uri': source_uri,
        'page': page_1based,
        'type': type_str,
        'color': color or '#ffd400',
        'rects': [],  # buit perquè el blob del comment porta els rects natius
        'text': text or '',
        'comment': '__ZOTERO_JSON__' + json.dumps(zotero_ann, ensure_ascii=False),
    }
    to_create.append((source_uri, payload, ann_key))

print(f'Per crear: {len(to_create)}')
print(f'Skipped sense PDF al disc: {skipped_no_pdf}')
print(f'Skipped (duplicats existents): {skipped_dup}')

# Mostra els primers per fitxer
by_uri = {}
for su, p, k in to_create:
    by_uri.setdefault(su, []).append(k)
print(f'\nDistribució per PDF:')
for su, keys in by_uri.items():
    name = os.path.basename(urllib.parse.unquote(su.replace('file://','')))[:60]
    print(f'  {len(keys):3d}  {name}')

if not APPLY:
    print('\n[DRY-RUN] Cap escriptura. --apply per executar.')
    sys.exit(0)

# --- POST ---
def post_ann(payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(f'{VAULT_API}/pdf-annotations',
        method='POST', data=body, headers={'Content-Type':'application/json'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status
        except urllib.error.HTTPError as e:
            if e.code >= 500 and attempt < 2: time.sleep(0.5); continue
            return f'HTTP {e.code}'
        except Exception as e:
            return f'ERR: {e}'

ok = err = 0; errs = []
for i, (su, p, k) in enumerate(to_create):
    res = post_ann(p)
    if res in (200, 201): ok += 1
    else:
        err += 1
        if len(errs) < 5: errs.append((k, res))
    if (i+1) % 25 == 0: print(f'  · {i+1}/{len(to_create)} (ok={ok}, err={err})')
print(f'\nCreate: {ok} ok, {err} err')
if errs: print(f'  Samples: {errs}')
