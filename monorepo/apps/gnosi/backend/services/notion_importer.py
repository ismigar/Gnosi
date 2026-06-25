"""Importador de Notion (API REST pública) → Vault de Gnosi.

Reprodueix bases de dades → taules, pàgines → pàgines, relacions, contingut → Markdown
i fitxers. Disseny: les funcions de transformació són PURES i NO importen el backend, de
manera que es poden testejar amb fixtures sintètiques sense token ni servidor (cf.
directiva `notion_api_importer.md` i memòria `feedback_local_backend_test_verification`).

L'escriptura al vault es delega a "writers" injectats (l'endpoint passa funcions que
reusen `POST /api/vault/{tables,pages,views}`), de manera que aquest mòdul no acobla amb
els routers ni amb la I/O del vault.
"""
from __future__ import annotations

import time
import uuid
from typing import Any, Callable, Dict, Iterable, List, Optional

# Namespace estable per derivar IDs idempotents de Gnosi a partir dels de Notion
# (reimportar la mateixa BD/pàgina NO duplica: upsert per `id`).
_GNOSI_NS = uuid.UUID("6f0c9b2e-1a4d-5e6f-8a9b-000000000001")

NOTION_VERSION = "2022-06-28"
NOTION_API = "https://api.notion.com/v1"


def gnosi_id_for(notion_id: str, kind: str = "page") -> str:
    """ID de Gnosi determinista per a un objecte de Notion (idempotència de reimport)."""
    clean = str(notion_id or "").replace("-", "")
    return str(uuid.uuid5(_GNOSI_NS, f"{kind}:{clean}"))


# ---------------------------------------------------------------------------
# Paleta de colors Notion → Gnosi
# ---------------------------------------------------------------------------
_COLOR_MAP = {
    "default": "gray", "gray": "gray", "brown": "orange", "orange": "orange",
    "yellow": "yellow", "green": "green", "blue": "blue", "purple": "purple",
    "pink": "pink", "red": "red",
}


def _color(notion_color: Optional[str]) -> str:
    base = str(notion_color or "default").replace("_background", "")
    return _COLOR_MAP.get(base, "gray")


# ---------------------------------------------------------------------------
# Mapeig de tipus de propietat (esquema de BD)
# ---------------------------------------------------------------------------
# Notion type -> Gnosi field type (per a tipus directes sense lògica especial)
_PROP_TYPE_MAP = {
    "title": "title", "rich_text": "text", "number": "number",
    "select": "select", "multi_select": "multi_select", "status": "status",
    "checkbox": "checkbox", "url": "url", "email": "email",
    "phone_number": "phone", "people": "text", "files": "file",
    "created_time": "created_time", "last_edited_time": "last_edited_time",
    "created_by": "created_by", "last_edited_by": "last_edited_by",
    "formula": "text", "rollup": "text",
}

# Tipus de Notion que són calculats: desem el valor però NO s'han de reescriure a Notion
READ_ONLY_TYPES = {"formula", "rollup", "created_time", "last_edited_time",
                   "created_by", "last_edited_by"}


def map_property_schema(name: str, prop: Dict[str, Any]) -> Dict[str, Any]:
    """Una propietat de l'esquema de Notion → una propietat de taula de Gnosi.

    `prop` és el valor del dict `properties` de `GET /v1/databases/{id}`.
    """
    ntype = prop.get("type", "rich_text")
    field: Dict[str, Any] = {
        "id": str(uuid.uuid5(_GNOSI_NS, f"prop:{prop.get('id') or name}")),
        "name": name,
    }

    if ntype == "date":
        # Una propietat date pot contenir rang (end) → es decideix per fila; aquí
        # declarem `date` i el render promociona a període si hi ha end.
        field["type"] = "date"
    elif ntype == "relation":
        field["type"] = "relation"
        target = (prop.get("relation") or {}).get("database_id")
        if target:
            field["relation_database_id"] = gnosi_id_for(target, "table")
    elif ntype in ("select", "status"):
        field["type"] = "select" if ntype == "select" else "status"
        opts = (prop.get(ntype) or {}).get("options") or []
        field["options"] = [{"name": o.get("name", ""), "color": _color(o.get("color"))}
                            for o in opts]
    elif ntype == "multi_select":
        field["type"] = "multi_select"
        opts = (prop.get("multi_select") or {}).get("options") or []
        field["options"] = [{"name": o.get("name", ""), "color": _color(o.get("color"))}
                            for o in opts]
    else:
        field["type"] = _PROP_TYPE_MAP.get(ntype, "text")

    if ntype in READ_ONLY_TYPES:
        field["read_only"] = True
    return field


def map_database_schema(db: Dict[str, Any]) -> Dict[str, Any]:
    """`GET /v1/databases/{id}` → dict de taula de Gnosi (per `POST /api/vault/tables`)."""
    title = _plain_title(db.get("title")) or "Sense títol"
    props = db.get("properties") or {}
    properties = [map_property_schema(name, p) for name, p in props.items()]
    return {
        "id": gnosi_id_for(db.get("id"), "table"),
        "name": title,
        "icon": _emoji_icon(db.get("icon")),
        "properties": properties,
    }


def _plain_title(title_array: Any) -> str:
    if not isinstance(title_array, list):
        return ""
    return "".join(t.get("plain_text", "") for t in title_array)


def _emoji_icon(icon: Any) -> Optional[str]:
    if isinstance(icon, dict) and icon.get("type") == "emoji":
        return icon.get("emoji")
    return None


# ---------------------------------------------------------------------------
# Rich text → Markdown
# ---------------------------------------------------------------------------
def rich_text_to_md(rich: Any) -> str:
    """Array de rich_text de Notion → Markdown inline (bold/italic/code/strike/link)."""
    if not isinstance(rich, list):
        return ""
    out = []
    for r in rich:
        txt = r.get("plain_text", "")
        if not txt:
            continue
        ann = r.get("annotations") or {}
        if ann.get("code"):
            txt = f"`{txt}`"
        if ann.get("bold"):
            txt = f"**{txt}**"
        if ann.get("italic"):
            txt = f"*{txt}*"
        if ann.get("strikethrough"):
            txt = f"~~{txt}~~"
        href = r.get("href")
        if href:
            txt = f"[{txt}]({href})"
        out.append(txt)
    return "".join(out)


# ---------------------------------------------------------------------------
# Valors de propietats d'una pàgina (fila) → valors de Gnosi (per nom de camp)
# ---------------------------------------------------------------------------
def value_to_gnosi(prop: Dict[str, Any], users: Optional[Dict[str, str]] = None) -> Any:
    """Un valor de propietat de `GET /v1/pages/{id}` → valor pla per a Gnosi."""
    users = users or {}
    t = prop.get("type")
    v = prop.get(t)

    if t == "title" or t == "rich_text":
        return rich_text_to_md(v)
    if t == "number":
        return v
    if t == "checkbox":
        return bool(v)
    if t == "select" or t == "status":
        return (v or {}).get("name") if isinstance(v, dict) else None
    if t == "multi_select":
        return [o.get("name") for o in (v or []) if o.get("name")]
    if t == "date":
        if not isinstance(v, dict):
            return None
        start, end = v.get("start"), v.get("end")
        return {"start": start, "end": end} if end else start
    if t == "url" or t == "email" or t == "phone_number":
        return v
    if t == "people":
        return ", ".join(users.get(p.get("id"), p.get("id", "")) for p in (v or []))
    if t == "files":
        return [_file_url(f) for f in (v or []) if _file_url(f)]
    if t == "relation":
        # IDs de Notion; es tradueixen a IDs de Gnosi a la passada B
        return [gnosi_id_for(r.get("id"), "page") for r in (v or []) if r.get("id")]
    if t == "formula":
        f = v or {}
        return f.get(f.get("type"), "")
    if t == "rollup":
        r = v or {}
        if r.get("type") == "number":
            return r.get("number")
        if r.get("type") == "array":
            return ", ".join(str(value_to_gnosi(x, users)) for x in r.get("array", []))
        return r.get(r.get("type"), "")
    if t in ("created_time", "last_edited_time"):
        return v
    if t in ("created_by", "last_edited_by"):
        return users.get((v or {}).get("id"), "") if isinstance(v, dict) else ""
    return None


def _file_url(f: Dict[str, Any]) -> Optional[str]:
    ftype = f.get("type")
    if ftype == "external":
        return (f.get("external") or {}).get("url")
    if ftype == "file":
        return (f.get("file") or {}).get("url")  # S3 caduca ~1h
    return None


def page_to_values(page: Dict[str, Any], users: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """`GET /v1/pages/{id}` → {nom_camp: valor} per a `POST /api/vault/pages`."""
    out: Dict[str, Any] = {}
    for name, prop in (page.get("properties") or {}).items():
        out[name] = value_to_gnosi(prop, users)
    return out


# ---------------------------------------------------------------------------
# Blocs → Markdown
# ---------------------------------------------------------------------------
def block_to_md(block: Dict[str, Any], depth: int = 0) -> str:
    """Un sol bloc de Notion → línia(es) Markdown. NO recursiu (els fills es preprocessen)."""
    t = block.get("type", "")
    data = block.get(t) or {}
    rt = lambda: rich_text_to_md(data.get("rich_text"))
    indent = "  " * depth

    if t == "paragraph":
        return f"{indent}{rt()}"
    if t in ("heading_1", "heading_2", "heading_3"):
        level = {"heading_1": "#", "heading_2": "##", "heading_3": "###"}[t]
        return f"{level} {rt()}"
    if t == "bulleted_list_item":
        return f"{indent}- {rt()}"
    if t == "numbered_list_item":
        return f"{indent}1. {rt()}"
    if t == "to_do":
        mark = "x" if data.get("checked") else " "
        return f"{indent}- [{mark}] {rt()}"
    if t == "toggle":
        return f"{indent}- {rt()}"
    if t == "quote":
        return f"> {rt()}"
    if t == "callout":
        emoji = ((data.get("icon") or {}).get("emoji")) or ""
        return f"> {emoji} {rt()}".rstrip()
    if t == "code":
        lang = data.get("language", "")
        return f"```{lang}\n{rt()}\n```"
    if t == "divider":
        return "---"
    if t == "equation":
        return f"$$\n{data.get('expression', '')}\n$$"
    if t in ("image", "file", "video", "pdf"):
        url = _file_url(data) or ""
        cap = rich_text_to_md(data.get("caption"))
        return f"![{cap}]({url})"
    if t == "bookmark":
        url = data.get("url", "")
        return f"[bookmark: {url}]({url})"
    if t == "child_page":
        return f"[[{data.get('title', '')}]]"
    if t == "child_database":
        return f"[[{data.get('title', '')}]]"
    if t == "table_row":
        cells = data.get("cells") or []
        return "| " + " | ".join(rich_text_to_md(c) for c in cells) + " |"
    if t == "synced_block":
        return ""  # el contingut ve com a fills
    return rt() or ""


def blocks_to_md(blocks: List[Dict[str, Any]], depth: int = 0) -> str:
    """Llista de blocs (amb `_children` ja resolts) → Markdown.

    Cada bloc pot portar `_children` (llista de blocs fills, p.ex. dins toggles/llistes).
    L'orquestrador omple `_children` baixant-los recursivament.
    """
    lines: List[str] = []
    for b in blocks:
        md = block_to_md(b, depth)
        if md or md == "":
            lines.append(md)
        children = b.get("_children") or []
        if children:
            lines.append(blocks_to_md(children, depth + 1))
    return "\n\n".join(l for l in lines if l != "")


# ---------------------------------------------------------------------------
# Heurística de vistes (Fase 1: l'API pública no exposa vistes)
# ---------------------------------------------------------------------------
def default_views_for_table(table: Dict[str, Any], create_group_view: bool = True) -> List[Dict[str, Any]]:
    """Genera la vista de taula per defecte + (opcional) una vista agrupada per status/select."""
    props = table.get("properties") or []
    visible = [p["name"] for p in props]
    views = [{
        "id": str(uuid.uuid5(_GNOSI_NS, f"view:{table['id']}:main")),
        "table_id": table["id"], "name": "Tot", "type": "table",
        "visibleProperties": visible,
    }]
    if create_group_view:
        group_field = next((p["name"] for p in props if p.get("type") == "status"), None)
        if not group_field:
            selects = [p["name"] for p in props if p.get("type") == "select"]
            group_field = selects[0] if len(selects) == 1 else None
        if group_field:
            views.append({
                "id": str(uuid.uuid5(_GNOSI_NS, f"view:{table['id']}:group")),
                "table_id": table["id"], "name": f"Per {group_field}", "type": "table",
                "visibleProperties": visible, "groupBy": group_field,
            })
    return views


# ---------------------------------------------------------------------------
# Client HTTP (httpx) — throttle + retry 429 + paginació
# ---------------------------------------------------------------------------
class NotionClient:
    def __init__(self, token: str, min_interval: float = 0.34):
        self.token = token
        self.min_interval = min_interval  # ~3 req/s
        self._last = 0.0
        self._client = None

    def _http(self):
        if self._client is None:
            import httpx  # lazy: les transforms pures no depenen de httpx
            self._client = httpx.Client(
                base_url=NOTION_API, timeout=30.0,
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Notion-Version": NOTION_VERSION,
                    "Content-Type": "application/json",
                },
            )
        return self._client

    def _throttle(self):
        dt = time.monotonic() - self._last
        if dt < self.min_interval:
            time.sleep(self.min_interval - dt)
        self._last = time.monotonic()

    def _request(self, method: str, path: str, **kw) -> Dict[str, Any]:
        for attempt in range(5):
            self._throttle()
            resp = self._http().request(method, path, **kw)
            if resp.status_code == 429:
                wait = float(resp.headers.get("Retry-After", 1.0))
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        resp.raise_for_status()
        return {}

    def me(self) -> Dict[str, Any]:
        return self._request("GET", "/users/me")

    def list_users(self) -> Dict[str, str]:
        users, cursor = {}, None
        while True:
            params = {"page_size": 100}
            if cursor:
                params["start_cursor"] = cursor
            data = self._request("GET", "/users", params=params)
            for u in data.get("results", []):
                users[u.get("id")] = u.get("name") or u.get("id")
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")
        return users

    def search_databases(self) -> List[Dict[str, Any]]:
        results, cursor = [], None
        while True:
            body = {"filter": {"property": "object", "value": "database"}, "page_size": 100}
            if cursor:
                body["start_cursor"] = cursor
            data = self._request("POST", "/search", json=body)
            results.extend(data.get("results", []))
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")
        return results

    def get_database(self, db_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/databases/{db_id}")

    def get_page(self, page_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/pages/{page_id}")

    def query_database(self, db_id: str) -> Iterable[Dict[str, Any]]:
        cursor = None
        while True:
            body = {"page_size": 100}
            if cursor:
                body["start_cursor"] = cursor
            data = self._request("POST", f"/databases/{db_id}/query", json=body)
            for row in data.get("results", []):
                yield row
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")

    def get_block_children(self, block_id: str) -> List[Dict[str, Any]]:
        """Fills d'un bloc/pàgina, recursiu: omple `_children` quan `has_children`."""
        results, cursor = [], None
        while True:
            params = {"page_size": 100}
            if cursor:
                params["start_cursor"] = cursor
            data = self._request("GET", f"/blocks/{block_id}/children", params=params)
            for b in data.get("results", []):
                if b.get("has_children"):
                    b["_children"] = self.get_block_children(b["id"])
                results.append(b)
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")
        return results


# ---------------------------------------------------------------------------
# Descobriment de referències dins els blocs (per al tancament transitiu)
# ---------------------------------------------------------------------------
def discover_block_refs(blocks: List[Dict[str, Any]]) -> tuple:
    """Escaneja un arbre de blocs (amb `_children`) i retorna (db_ids, page_ids) referenciats.

    Detecta `child_page`, `child_database`, `link_to_page` i mencions (`mention`) inline a
    qualsevol `rich_text`. PUR (sense xarxa) → testejable amb fixtures.
    """
    db_ids: set = set()
    page_ids: set = set()

    def scan_rich(rich):
        for r in rich or []:
            if r.get("type") == "mention":
                m = r.get("mention") or {}
                if m.get("type") == "page":
                    page_ids.add((m.get("page") or {}).get("id"))
                elif m.get("type") == "database":
                    db_ids.add((m.get("database") or {}).get("id"))

    def walk(bl):
        for b in bl or []:
            t = b.get("type")
            data = b.get(t) if isinstance(b.get(t), dict) else {}
            if t == "child_page":
                page_ids.add(b.get("id"))
            elif t == "child_database":
                db_ids.add(b.get("id"))
            elif t == "link_to_page":
                ltp = b.get("link_to_page") or {}
                if ltp.get("type") == "page_id":
                    page_ids.add(ltp.get("page_id"))
                elif ltp.get("type") == "database_id":
                    db_ids.add(ltp.get("database_id"))
            if data.get("rich_text"):
                scan_rich(data.get("rich_text"))
            walk(b.get("_children"))

    walk(blocks)
    db_ids.discard(None)
    page_ids.discard(None)
    return db_ids, page_ids


# ---------------------------------------------------------------------------
# Orquestrador: crawler BFS de tancament transitiu (writers injectats)
# ---------------------------------------------------------------------------
def import_workspace(
    client: NotionClient,
    *,
    write_table: Callable[[Dict[str, Any]], None],
    write_page: Callable[[Dict[str, Any]], None],
    write_view: Callable[[Dict[str, Any]], None],
    database_ids: Optional[List[str]] = None,
    create_group_views: bool = True,
    target_folder: str = "Importades/Notion",
    follow_relations: bool = True,
    follow_children: bool = True,
    max_pages: int = 5000,
    exists: Optional[Callable[[str, str], bool]] = None,
    only_new: bool = True,
) -> Dict[str, Any]:
    """Importa un workspace de Notion seguint el GRAF de referències (sense orfes).

    BFS sobre BD i pàgines: en importar una BD se n'encuen les BD relacionades (esquema);
    en importar una pàgina se n'encuen els `child_page`/`child_database`/mencions del seu
    contingut. Conjunt de visitats → segur amb cicles (Projects↔Tasks↔Areas). `max_pages`
    evita desbordaments i es reporta si s'arriba (cap tall silenciós).

    Els IDs de Gnosi són deterministes (`gnosi_id_for`): un cop el destí d'una relació
    s'importa, el cablejat ja casa sense mapa explícit.
    """
    from collections import deque

    report = {"databases": 0, "tables": 0, "pages": 0, "views": 0,
              "errors": [], "truncated": False, "skipped_existing": 0}
    users = client.list_users()

    def _skip(notion_id: str, title: str) -> bool:
        # Sync guardat: si la pàgina JA existeix al vault (per id o títol) i only_new,
        # NO la toquem (evita duplicar i evita sobreescriure feina divergida).
        return bool(only_new and exists and exists(notion_id, title))

    seed = database_ids if database_ids is not None else [d["id"] for d in client.search_databases()]
    db_queue = deque(seed)
    page_queue: deque = deque()
    visited_dbs: set = set()
    visited_pages: set = set()
    queued: set = set(seed)

    def enq_db(did):
        if did and did not in visited_dbs and did not in queued:
            queued.add(did)
            db_queue.append(did)

    def enq_page(pid):
        if pid and pid not in visited_pages and pid not in queued:
            queued.add(pid)
            page_queue.append(pid)

    def limit_hit() -> bool:
        if report["pages"] >= max_pages:
            report["truncated"] = True
            return True
        return False

    while (db_queue or page_queue) and not limit_hit():
        if db_queue:
            db_id = db_queue.popleft()
            if db_id in visited_dbs:
                continue
            visited_dbs.add(db_id)
            try:
                db = client.get_database(db_id)
                table = map_database_schema(db)
                table["folder"] = target_folder
                write_table(table)
                report["tables"] += 1
                report["databases"] += 1
                for view in default_views_for_table(table, create_group_views):
                    write_view(view)
                    report["views"] += 1
                if follow_relations:
                    for prop in (db.get("properties") or {}).values():
                        if prop.get("type") == "relation":
                            enq_db((prop.get("relation") or {}).get("database_id"))
                for row in client.query_database(db_id):
                    if limit_hit():
                        break
                    visited_pages.add(row["id"])
                    try:
                        values = page_to_values(row, users)
                        title = values.pop("title", None) or _page_title(row) or "Sense títol"
                        if _skip(row["id"], title):
                            report["skipped_existing"] += 1
                            continue
                        blocks = client.get_block_children(row["id"])
                        write_page({
                            "id": gnosi_id_for(row["id"], "page"),
                            "title": title,
                            "content": blocks_to_md(blocks),
                            "metadata": {"table_id": table["id"], **values,
                                        "icon": _emoji_icon(row.get("icon"))},
                        })
                        report["pages"] += 1
                        if follow_children:
                            rdb, rpg = discover_block_refs(blocks)
                            for d in rdb:
                                enq_db(d)
                            for p in rpg:
                                enq_page(p)
                    except Exception as e:  # noqa: BLE001
                        report["errors"].append({"page": row.get("id"), "error": str(e)})
            except Exception as e:  # noqa: BLE001
                report["errors"].append({"database": db_id, "error": str(e)})
        else:
            pid = page_queue.popleft()
            if pid in visited_pages:
                continue
            visited_pages.add(pid)
            try:
                pg = client.get_page(pid)
                parent = pg.get("parent") or {}
                if parent.get("type") == "database_id":
                    # És una fila d'una BD → importa la BD sencera (no com a pàgina solta)
                    enq_db(parent.get("database_id"))
                    continue
                title = _page_title(pg) or "Sense títol"
                if _skip(pid, title):
                    report["skipped_existing"] += 1
                    continue
                blocks = client.get_block_children(pid)
                write_page({
                    "id": gnosi_id_for(pid, "page"),
                    "title": title,
                    "content": blocks_to_md(blocks),
                    "metadata": {"icon": _emoji_icon(pg.get("icon"))},
                })
                report["pages"] += 1
                if follow_children:
                    rdb, rpg = discover_block_refs(blocks)
                    for d in rdb:
                        enq_db(d)
                    for p in rpg:
                        enq_page(p)
            except Exception as e:  # noqa: BLE001
                report["errors"].append({"page": pid, "error": str(e)})

    return report


def _page_title(page: Dict[str, Any]) -> str:
    for prop in (page.get("properties") or {}).values():
        if prop.get("type") == "title":
            return rich_text_to_md(prop.get("title"))
    return ""
