"""Notion importer (public REST API) → Gnosi Vault.

Reproduces databases → tables, pages → pages, relations, content → Markdown
and files. Design: the transformation functions are PURE and do NOT import the backend, so
they can be tested with synthetic fixtures without a token or server (cf.
directive `notion_api_importer.md` and memory `feedback_local_backend_test_verification`).

Writing to the vault is delegated to injected "writers" (the endpoint passes functions that
reuse `POST /api/vault/{tables,pages,views}`), so that this module doesn't couple with
the routers or the vault's I/O.
"""
from __future__ import annotations

import time
import uuid
from typing import Any, Callable, Dict, Iterable, List, Optional

# Stable namespace to derive idempotent Gnosi IDs from Notion's
# (reimporting the same DB/page does NOT duplicate: upsert by `id`).
_GNOSI_NS = uuid.UUID("6f0c9b2e-1a4d-5e6f-8a9b-000000000001")

NOTION_VERSION = "2022-06-28"
NOTION_API = "https://api.notion.com/v1"


def gnosi_id_for(notion_id: str, kind: str = "page") -> str:
    """Deterministic Gnosi ID for a Notion object (reimport idempotency)."""
    clean = str(notion_id or "").replace("-", "")
    return str(uuid.uuid5(_GNOSI_NS, f"{kind}:{clean}"))


def table_id_for(notion_db_id: str) -> str:
    """Table ID = Notion DB id WITHOUT dashes (that's how the Gnosi vault stores them:
    e.g. Areas `90e31c41f815489b99f30086b120cbfa`) → reconciles by id, doesn't duplicate."""
    return str(notion_db_id or "").replace("-", "")


def page_id_for(notion_page_id: str) -> str:
    """Page ID = Notion id AS-IS (with dashes: the vault keeps it in the frontmatter
    `id`, e.g. `103268e5-2714-8069-...`) → relations and matching key off the id."""
    return str(notion_page_id or "")


# ---------------------------------------------------------------------------
# Notion → Gnosi color palette
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
# Property type mapping (DB schema)
# ---------------------------------------------------------------------------
# Notion type -> Gnosi field type (for direct types with no special logic)
_PROP_TYPE_MAP = {
    "title": "title", "rich_text": "text", "number": "number",
    "select": "select", "multi_select": "multi_select", "status": "status",
    "checkbox": "checkbox", "url": "url", "email": "email",
    # Notion "files" (files/images) → Gnosi "files" (valid canonical type). NOT "file" (singular):
    # it's not a real Gnosi type (the modal and VaultTable only know "files"/"image"), and
    # leaving it caused the <select> to get corrupted when opening the schema config (bug 2026-07-02:
    # Articles/Image → "authorship"). The user can switch image fields to "image".
    "phone_number": "phone", "people": "text", "files": "files",
    "created_time": "created_time", "last_edited_time": "last_edited_time",
    "created_by": "created_by", "last_edited_by": "last_edited_by",
    "formula": "text", "rollup": "text", "unique_id": "text",
}

# Notion types that are computed: we save the value but they must NOT be written back to Notion
READ_ONLY_TYPES = {"formula", "rollup", "created_time", "last_edited_time",
                   "created_by", "last_edited_by"}


def map_property_schema(name: str, prop: Dict[str, Any]) -> Dict[str, Any]:
    """A Notion schema property → a Gnosi table property.

    `prop` is the value of the `properties` dict from `GET /v1/databases/{id}`.
    
    """
    ntype = prop.get("type", "rich_text")
    field: Dict[str, Any] = {
        "id": str(uuid.uuid5(_GNOSI_NS, f"prop:{prop.get('id') or name}")),
        "name": name,
    }

    if ntype == "date":
        # A date property may contain a range (end) → it's decided per row; here
        # we declare `date` and the renderer promotes it to a period if there's an end.
        field["type"] = "date"
    elif ntype == "relation":
        field["type"] = "relation"
        target = (prop.get("relation") or {}).get("database_id")
        if target:
            field["relation_database_id"] = table_id_for(target)
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
    """`GET /v1/databases/{id}` → Gnosi table dict (for `POST /api/vault/tables`)."""
    title = _plain_title(db.get("title")) or "Sense títol"
    props = db.get("properties") or {}
    properties = [map_property_schema(name, p) for name, p in props.items()]
    return {
        "id": table_id_for(db.get("id")),
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
    """Notion rich_text array → inline Markdown (bold/italic/code/strike/link)."""
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
# Property values of a page (row) → Gnosi values (by field name)
# ---------------------------------------------------------------------------
def value_to_gnosi(prop: Dict[str, Any], users: Optional[Dict[str, str]] = None) -> Any:
    """A property value from `GET /v1/pages/{id}` → a flat value for Gnosi."""
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
        # Notion IDs; translated to Gnosi IDs in pass B
        return [page_id_for(r.get("id")) for r in (v or []) if r.get("id")]
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
    if t == "unique_id":
        d = v or {}
        num, pref = d.get("number"), d.get("prefix")
        if num is None:
            return None
        return f"{pref}-{num}" if pref else str(num)
    return None


def _file_url(f: Dict[str, Any]) -> Optional[str]:
    ftype = f.get("type")
    if ftype == "external":
        return (f.get("external") or {}).get("url")
    if ftype == "file":
        return (f.get("file") or {}).get("url")  # S3 caduca ~1h
    return None


def page_to_values(page: Dict[str, Any], users: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """`GET /v1/pages/{id}` → {field_name: value} for `POST /api/vault/pages`."""
    out: Dict[str, Any] = {}
    for name, prop in (page.get("properties") or {}).items():
        out[name] = value_to_gnosi(prop, users)
    return out


# ---------------------------------------------------------------------------
# Blocs → Markdown
# ---------------------------------------------------------------------------
def block_to_md(block: Dict[str, Any], depth: int = 0) -> str:
    """A single Notion block → Markdown line(s). NOT recursive (children are preprocessed)."""
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
        # Code is LITERAL text: the RAW plain_text is concatenated, without going
        # through `rich_text_to_md` (which would apply bold/link/`code`… → a link or
        # an annotation inside the block would come out as literal `[**docs**](url)`).
        raw = "".join(r.get("plain_text", "") for r in (data.get("rich_text") or []))
        return f"```{lang}\n{raw}\n```"
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
        # A GFM row must be a SINGLE line and `|` separates columns: each
        # cell escapes the literal `|` and collapses line breaks (a `|` or a `\n`
        # inside a Notion cell used to break the imported table's structure).
        cells = data.get("cells") or []
        md_cells = [
            rich_text_to_md(c).replace("|", "\\|").replace("\n", " ")
            for c in cells
        ]
        return "| " + " | ".join(md_cells) + " |"
    if t == "synced_block":
        return ""  # the content comes as children
    return rt() or ""


def blocks_to_md(blocks: List[Dict[str, Any]], depth: int = 0) -> str:
    """List of blocks (with `_children` already resolved) → Markdown.

    Each block can carry `_children` (list of child blocks, e.g. inside toggles/lists).
    The orchestrator fills `_children` by fetching them recursively.
    
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
# HTTP client (httpx) — throttle + 429 retry + pagination
# ---------------------------------------------------------------------------
class NotionClient:
    def __init__(self, token: str, min_interval: float = 0.34):
        self.token = token
        self.min_interval = min_interval  # ~3 req/s
        self._last = 0.0
        self._client = None

    def _http(self):
        if self._client is None:
            import httpx  # lazy: the pure transforms don't depend on httpx
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

    @staticmethod
    def _next_cursor(data: Dict[str, Any], current: Optional[str]) -> Optional[str]:
        """Cursor for the next page, or None if pagination should stop.

        Defensive against malformed responses: if `has_more` is true but
        `next_cursor` comes back empty OR equal to the current one, advancing is impossible and the
        `while True` loop would SPIN FOREVER, hanging the clone's thread
        (Notion's API sits behind Cloudflare; a rare response should not
        turn into a hang). In this case we stop the pagination."""
        if not data.get("has_more"):
            return None
        nxt = data.get("next_cursor")
        if not nxt or nxt == current:
            return None
        return nxt

    def _request(self, method: str, path: str, **kw) -> Dict[str, Any]:
        import httpx
        last_exc = None
        for attempt in range(6):
            self._throttle()
            try:
                resp = self._http().request(method, path, **kw)
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout,
                    httpx.ReadError, httpx.RemoteProtocolError, httpx.PoolTimeout) as e:
                # Transient network/DNS blip (e.g. "[Errno 8] nodename nor servname"):
                # retries with backoff instead of letting the whole DB drop out of the clone.
                last_exc = e
                time.sleep(min(2 ** attempt, 15))
                continue
            if resp.status_code == 429:
                # `Retry-After` can be seconds OR an HTTP date (RFC 7231); the
                # direct `float()` crashed with the date format and brought down the
                # clone. Tolerant parsing + 15s cap (like the blip backoff).
                from backend.utils.http_retry import retry_after_seconds
                time.sleep(retry_after_seconds(
                    resp.headers.get("Retry-After"), default=1.0, cap=15.0
                ))
                continue
            resp.raise_for_status()
            return resp.json()
        if last_exc is not None:
            raise last_exc
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
            cursor = self._next_cursor(data, cursor)
            if cursor is None:
                break
        return users

    def search_databases(self) -> List[Dict[str, Any]]:
        results, cursor = [], None
        while True:
            body = {"filter": {"property": "object", "value": "database"}, "page_size": 100}
            if cursor:
                body["start_cursor"] = cursor
            data = self._request("POST", "/search", json=body)
            results.extend(data.get("results", []))
            cursor = self._next_cursor(data, cursor)
            if cursor is None:
                break
        return results

    def search_pages(self) -> List[Dict[str, Any]]:
        """All pages shared with the integration (object=page), paginated."""
        results, cursor = [], None
        while True:
            body = {"filter": {"property": "object", "value": "page"}, "page_size": 100}
            if cursor:
                body["start_cursor"] = cursor
            data = self._request("POST", "/search", json=body)
            results.extend(data.get("results", []))
            cursor = self._next_cursor(data, cursor)
            if cursor is None:
                break
        return results

    def get_database(self, db_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/databases/{db_id}")

    def get_page(self, page_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/pages/{page_id}")

    def get_block(self, block_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/blocks/{block_id}")

    def query_database(self, db_id: str) -> Iterable[Dict[str, Any]]:
        cursor = None
        while True:
            body = {"page_size": 100}
            if cursor:
                body["start_cursor"] = cursor
            data = self._request("POST", f"/databases/{db_id}/query", json=body)
            for row in data.get("results", []):
                yield row
            cursor = self._next_cursor(data, cursor)
            if cursor is None:
                break

    def get_block_children(self, block_id: str) -> List[Dict[str, Any]]:
        """Children of a block/page, recursive: fills `_children` when `has_children`."""
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
            cursor = self._next_cursor(data, cursor)
            if cursor is None:
                break
        return results

    def get_block_children_shallow(self, block_id: str) -> List[Dict[str, Any]]:
        """DIRECT children of a block/page (a single level, no recursion) — to quickly
        scan which blocks exist without downloading the whole tree."""
        results, cursor = [], None
        while True:
            params = {"page_size": 100}
            if cursor:
                params["start_cursor"] = cursor
            data = self._request("GET", f"/blocks/{block_id}/children", params=params)
            results.extend(data.get("results", []))
            cursor = self._next_cursor(data, cursor)
            if cursor is None:
                break
        return results

    def database_kind(self, db_id: str) -> str:
        """Classifies a DB without raising an exception (reads the body of the Notion error):
        'source' (accessible source DB), 'linked' (linked view: the API can't read it),
        'page' (the id is a page, not a DB), 'inaccessible' (no access to it), or 'error'."""
        self._throttle()
        resp = self._http().request("GET", f"/databases/{db_id}")
        if resp.status_code == 200:
            return "source"
        try:
            body = resp.json()
        except Exception:  # noqa: BLE001
            return "error"
        msg = (body.get("message") or "").lower()
        code = body.get("code") or ""
        if "linked database" in msg:
            return "linked"
        if "is a page" in msg:
            return "page"
        if code == "object_not_found" or "could not find" in msg:
            return "inaccessible"
        return "error"


def _page_title(page: Dict[str, Any]) -> str:
    """Title of a Notion page (value of the `title` field)."""
    for prop in (page.get("properties") or {}).values():
        if prop.get("type") == "title":
            return rich_text_to_md(prop.get("title"))
    return ""
