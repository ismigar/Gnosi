"""Typed Notion importer domain (public REST API → Gnosi Vault).

Reproduces databases → tables, pages → pages, relations, content → Markdown
and files. Design: the transformation functions are PURE and do NOT import the backend, so
they can be tested with synthetic fixtures without a token or server (cf.
directive `notion_api_importer.md` and memory `feedback_local_backend_test_verification`).

Writing to the vault is delegated to injected "writers" (the endpoint passes functions that
reuse `POST /api/vault/{tables,pages,views}`), so that this module doesn't couple with
the routers or the vault's I/O.
"""

from __future__ import annotations

import time as time
import uuid as uuid
from typing import TYPE_CHECKING, Dict, Iterable, List, Optional, TypedDict

if TYPE_CHECKING:
    import httpx

JsonMap = Dict[str, object]
QueryParams = Dict[str, str | int | float | bool | None]


class MappedDatabaseSchema(TypedDict):
    """Exact table shape produced by :func:`map_database_schema`."""

    id: str
    name: str
    icon: Optional[str]
    properties: List[Dict[str, object]]


def _as_dict(value: object) -> JsonMap:
    return dict(value) if isinstance(value, dict) else {}


def _as_dict_list(value: object) -> List[JsonMap]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


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
    "default": "gray",
    "gray": "gray",
    "brown": "orange",
    "orange": "orange",
    "yellow": "yellow",
    "green": "green",
    "blue": "blue",
    "purple": "purple",
    "pink": "pink",
    "red": "red",
}


def _color(notion_color: Optional[str]) -> str:
    base = str(notion_color or "default").replace("_background", "")
    return _COLOR_MAP.get(base, "gray")


# ---------------------------------------------------------------------------
# Property type mapping (DB schema)
# ---------------------------------------------------------------------------
# Notion type -> Gnosi field type (for direct types with no special logic)
_PROP_TYPE_MAP = {
    "title": "title",
    "rich_text": "text",
    "number": "number",
    "select": "select",
    "multi_select": "multi_select",
    "status": "status",
    "checkbox": "checkbox",
    "url": "url",
    "email": "email",
    # Notion "files" (files/images) → Gnosi "files" (valid canonical type). NOT "file" (singular):
    # it's not a real Gnosi type (the modal and VaultTable only know "files"/"image"), and
    # leaving it caused the <select> to get corrupted when opening the schema config (bug 2026-07-02:
    # Articles/Image → "authorship"). The user can switch image fields to "image".
    "phone_number": "phone",
    "people": "text",
    "files": "files",
    "created_time": "created_time",
    "last_edited_time": "last_edited_time",
    "created_by": "created_by",
    "last_edited_by": "last_edited_by",
    "formula": "text",
    "rollup": "text",
    "unique_id": "text",
}

# Notion types that are computed: we save the value but they must NOT be written back to Notion
READ_ONLY_TYPES = {
    "formula",
    "rollup",
    "created_time",
    "last_edited_time",
    "created_by",
    "last_edited_by",
}


def map_property_schema(name: str, prop: Dict[str, object]) -> Dict[str, object]:
    """A Notion schema property → a Gnosi table property.

    `prop` is the value of the `properties` dict from `GET /v1/databases/{id}`.

    """
    ntype = str(prop.get("type", "rich_text"))
    field: Dict[str, object] = {
        "id": str(uuid.uuid5(_GNOSI_NS, f"prop:{prop.get('id') or name}")),
        "name": name,
    }

    if ntype == "date":
        # A date property may contain a range (end) → it's decided per row; here
        # we declare `date` and the renderer promotes it to a period if there's an end.
        field["type"] = "date"
    elif ntype == "relation":
        field["type"] = "relation"
        target = _as_dict(prop.get("relation")).get("database_id")
        if target:
            field["relation_database_id"] = table_id_for(str(target))
    elif ntype in ("select", "status"):
        field["type"] = "select" if ntype == "select" else "status"
        opts = _as_dict(prop.get(ntype)).get("options")
        option_rows = _as_dict_list(opts)
        field["options"] = [
            {"name": o.get("name", ""), "color": _color(str(o.get("color") or ""))}
            for o in option_rows
        ]
    elif ntype == "multi_select":
        field["type"] = "multi_select"
        opts = _as_dict(prop.get("multi_select")).get("options")
        option_rows = _as_dict_list(opts)
        field["options"] = [
            {"name": o.get("name", ""), "color": _color(str(o.get("color") or ""))}
            for o in option_rows
        ]
    else:
        field["type"] = _PROP_TYPE_MAP.get(ntype, "text")

    if ntype in READ_ONLY_TYPES:
        field["read_only"] = True
    return field


def map_database_schema(db: Dict[str, object]) -> MappedDatabaseSchema:
    """`GET /v1/databases/{id}` → Gnosi table dict (for `POST /api/vault/tables`)."""
    title = _plain_title(db.get("title")) or "Sense títol"
    props = _as_dict(db.get("properties"))
    properties = [map_property_schema(name, _as_dict(prop)) for name, prop in props.items()]
    return {
        "id": table_id_for(str(db.get("id") or "")),
        "name": title,
        "icon": _emoji_icon(db.get("icon")),
        "properties": properties,
    }


def _plain_title(title_array: object) -> str:
    if not isinstance(title_array, list):
        return ""
    return "".join(
        str(item.get("plain_text") or "") for item in title_array if isinstance(item, dict)
    )


def _emoji_icon(icon: object) -> Optional[str]:
    if isinstance(icon, dict) and icon.get("type") == "emoji":
        emoji = icon.get("emoji")
        return str(emoji) if emoji is not None else None
    return None


# ---------------------------------------------------------------------------
# Rich text → Markdown
# ---------------------------------------------------------------------------
def rich_text_to_md(rich: object) -> str:
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
def _basic_property_value(prop_type: str, value: object) -> tuple[bool, object]:
    if prop_type in ("title", "rich_text"):
        return True, rich_text_to_md(value)
    if prop_type == "number":
        return True, value
    if prop_type == "checkbox":
        return True, bool(value)
    if prop_type in ("url", "email", "phone_number", "created_time", "last_edited_time"):
        return True, value
    return False, None


def _selection_property_value(prop_type: str, value: object) -> tuple[bool, object]:
    if prop_type in ("select", "status"):
        return True, _as_dict(value).get("name") if isinstance(value, dict) else None
    if prop_type == "multi_select":
        return True, [item.get("name") for item in _as_dict_list(value) if item.get("name")]
    if prop_type == "date":
        date_value = _as_dict(value)
        if not date_value:
            return True, None
        start, end = date_value.get("start"), date_value.get("end")
        return True, {"start": start, "end": end} if end else start
    return False, None


def _collection_property_value(
    prop_type: str,
    value: object,
    users: Dict[str, str],
) -> tuple[bool, object]:
    items = _as_dict_list(value)
    if prop_type == "people":
        return True, ", ".join(
            users.get(str(item.get("id") or ""), str(item.get("id") or "")) for item in items
        )
    if prop_type == "files":
        urls = [_file_url(item) for item in items]
        return True, [url for url in urls if url]
    if prop_type == "relation":
        return True, [page_id_for(str(item.get("id"))) for item in items if item.get("id")]
    return False, None


def _computed_property_value(
    prop_type: str,
    value: object,
    users: Dict[str, str],
) -> tuple[bool, object]:
    value_map = _as_dict(value)
    if prop_type == "formula":
        value_type = str(value_map.get("type") or "")
        return True, value_map.get(value_type, "")
    if prop_type == "rollup":
        value_type = str(value_map.get("type") or "")
        if value_type == "number":
            return True, value_map.get("number")
        if value_type == "array":
            nested = _as_dict_list(value_map.get("array"))
            return True, ", ".join(str(value_to_gnosi(item, users)) for item in nested)
        return True, value_map.get(value_type, "")
    if prop_type in ("created_by", "last_edited_by"):
        return True, users.get(str(value_map.get("id") or ""), "")
    if prop_type == "unique_id":
        number, prefix = value_map.get("number"), value_map.get("prefix")
        if number is None:
            return True, None
        return True, f"{prefix}-{number}" if prefix else str(number)
    return False, None


def value_to_gnosi(prop: Dict[str, object], users: Optional[Dict[str, str]] = None) -> object:
    """A property value from `GET /v1/pages/{id}` → a flat value for Gnosi."""
    prop_type = str(prop.get("type") or "")
    value = prop.get(prop_type)
    user_names = users or {}
    handled, result = _basic_property_value(prop_type, value)
    if handled:
        return result
    handled, result = _selection_property_value(prop_type, value)
    if handled:
        return result
    handled, result = _collection_property_value(prop_type, value, user_names)
    if handled:
        return result
    handled, result = _computed_property_value(prop_type, value, user_names)
    if handled:
        return result
    return None


def _file_url(f: Dict[str, object]) -> Optional[str]:
    ftype = f.get("type")
    if ftype == "external":
        url = _as_dict(f.get("external")).get("url")
        return str(url) if url is not None else None
    if ftype == "file":
        url = _as_dict(f.get("file")).get("url")
        return str(url) if url is not None else None  # S3 caduca ~1h
    return None


def page_to_values(
    page: Dict[str, object], users: Optional[Dict[str, str]] = None
) -> Dict[str, object]:
    """`GET /v1/pages/{id}` → {field_name: value} for `POST /api/vault/pages`."""
    out: Dict[str, object] = {}
    for name, prop in _as_dict(page.get("properties")).items():
        out[name] = value_to_gnosi(_as_dict(prop), users)
    return out


# ---------------------------------------------------------------------------
# Blocs → Markdown
# ---------------------------------------------------------------------------
def _text_block_to_md(
    block_type: str,
    rich_text: str,
    indent: str,
) -> Optional[str]:
    if block_type == "paragraph":
        return f"{indent}{rich_text}"
    if block_type in ("heading_1", "heading_2", "heading_3"):
        level = {"heading_1": "#", "heading_2": "##", "heading_3": "###"}[block_type]
        return f"{level} {rich_text}"
    if block_type == "bulleted_list_item":
        return f"{indent}- {rich_text}"
    if block_type == "numbered_list_item":
        return f"{indent}1. {rich_text}"
    if block_type == "toggle":
        return f"{indent}- {rich_text}"
    if block_type == "quote":
        return f"> {rich_text}"
    return None


def _special_block_to_md(
    block_type: str,
    data: JsonMap,
    rich_text: str,
    indent: str,
) -> Optional[str]:
    if block_type == "to_do":
        mark = "x" if data.get("checked") else " "
        return f"{indent}- [{mark}] {rich_text}"
    if block_type == "callout":
        emoji = _as_dict(data.get("icon")).get("emoji") or ""
        return f"> {emoji} {rich_text}".rstrip()
    if block_type == "code":
        raw = "".join(
            str(item.get("plain_text") or "") for item in _as_dict_list(data.get("rich_text"))
        )
        return f"```{data.get('language', '')}\n{raw}\n```"
    if block_type == "divider":
        return "---"
    if block_type == "equation":
        return f"$$\n{data.get('expression', '')}\n$$"
    return None


def _linked_block_to_md(block_type: str, data: JsonMap) -> Optional[str]:
    if block_type in ("image", "file", "video", "pdf"):
        url = _file_url(data) or ""
        caption = rich_text_to_md(data.get("caption"))
        return f"![{caption}]({url})"
    if block_type == "bookmark":
        url = str(data.get("url", ""))
        return f"[bookmark: {url}]({url})"
    if block_type in ("child_page", "child_database"):
        return f"[[{data.get('title', '')}]]"
    if block_type == "table_row":
        raw_cells: object = data.get("cells")
        cells: List[object] = list(raw_cells) if isinstance(raw_cells, list) else []
        md_cells = [rich_text_to_md(cell).replace("|", "\\|").replace("\n", " ") for cell in cells]
        return "| " + " | ".join(md_cells) + " |"
    if block_type == "synced_block":
        return ""
    return None


def block_to_md(block: Dict[str, object], depth: int = 0) -> str:
    """A single Notion block → Markdown line(s). NOT recursive (children are preprocessed)."""
    block_type = str(block.get("type") or "")
    data = _as_dict(block.get(block_type))
    rich_text = rich_text_to_md(data.get("rich_text"))
    indent = "  " * depth
    for rendered in (
        _text_block_to_md(block_type, rich_text, indent),
        _special_block_to_md(block_type, data, rich_text, indent),
        _linked_block_to_md(block_type, data),
    ):
        if rendered is not None:
            return rendered
    return rich_text or ""


def blocks_to_md(blocks: List[Dict[str, object]], depth: int = 0) -> str:
    """List of blocks (with `_children` already resolved) → Markdown.

    Each block can carry `_children` (list of child blocks, e.g. inside toggles/lists).
    The orchestrator fills `_children` by fetching them recursively.

    """
    lines: List[str] = []
    for b in blocks:
        md = block_to_md(b, depth)
        if md or md == "":
            lines.append(md)
        children = _as_dict_list(b.get("_children"))
        if children:
            lines.append(blocks_to_md(children, depth + 1))
    return "\n\n".join(l for l in lines if l != "")


# ---------------------------------------------------------------------------
# HTTP client (httpx) — throttle + 429 retry + pagination
# ---------------------------------------------------------------------------
class NotionClient:
    def __init__(self, token: str, min_interval: float = 0.34) -> None:
        self.token = token
        self.min_interval = min_interval  # ~3 req/s
        self._last = 0.0
        self._client: httpx.Client | None = None

    def _http(self) -> httpx.Client:
        if self._client is None:
            import httpx  # lazy: the pure transforms don't depend on httpx

            self._client = httpx.Client(
                base_url=NOTION_API,
                timeout=30.0,
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Notion-Version": NOTION_VERSION,
                    "Content-Type": "application/json",
                },
            )
        return self._client

    def _throttle(self) -> None:
        dt = time.monotonic() - self._last
        if dt < self.min_interval:
            time.sleep(self.min_interval - dt)
        self._last = time.monotonic()

    @staticmethod
    def _next_cursor(data: Dict[str, object], current: Optional[str]) -> Optional[str]:
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
        return str(nxt)

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: QueryParams | None = None,
        json: object = None,
    ) -> Dict[str, object]:
        import httpx

        last_exc: Exception | None = None
        response: httpx.Response | None = None
        for attempt in range(6):
            self._throttle()
            try:
                response = self._http().request(method, path, params=params, json=json)
            except (
                httpx.ConnectError,
                httpx.ConnectTimeout,
                httpx.ReadTimeout,
                httpx.ReadError,
                httpx.RemoteProtocolError,
                httpx.PoolTimeout,
            ) as e:
                # Transient network/DNS blip (e.g. "[Errno 8] nodename nor servname"):
                # retries with backoff instead of letting the whole DB drop out of the clone.
                last_exc = e
                time.sleep(min(2**attempt, 15))
                continue
            if response.status_code == 429:
                # `Retry-After` can be seconds OR an HTTP date (RFC 7231); the
                # direct `float()` crashed with the date format and brought down the
                # clone. Tolerant parsing + 15s cap (like the blip backoff).
                from backend.utils.http_retry import retry_after_seconds

                time.sleep(
                    retry_after_seconds(response.headers.get("Retry-After"), default=1.0, cap=15.0)
                )
                continue
            response.raise_for_status()
            return _as_dict(response.json())
        if last_exc is not None:
            raise last_exc
        if response is not None:
            response.raise_for_status()
        return {}

    def me(self) -> Dict[str, object]:
        return dict(self._request("GET", "/users/me"))

    def list_users(self) -> Dict[str, str]:
        users: Dict[str, str] = {}
        cursor: Optional[str] = None
        while True:
            params: QueryParams = {"page_size": 100}
            if cursor:
                params["start_cursor"] = cursor
            data = self._request("GET", "/users", params=params)
            for user in _as_dict_list(data.get("results")):
                user_id = str(user.get("id") or "")
                users[user_id] = str(user.get("name") or user_id)
            cursor = self._next_cursor(data, cursor)
            if cursor is None:
                break
        return users

    def search_databases(self) -> List[Dict[str, object]]:
        results: List[Dict[str, object]] = []
        cursor: Optional[str] = None
        while True:
            body: Dict[str, object] = {
                "filter": {"property": "object", "value": "database"},
                "page_size": 100,
            }
            if cursor:
                body["start_cursor"] = cursor
            data = self._request("POST", "/search", json=body)
            results.extend(_as_dict_list(data.get("results")))
            cursor = self._next_cursor(data, cursor)
            if cursor is None:
                break
        return results

    def search_pages(self) -> List[Dict[str, object]]:
        """All pages shared with the integration (object=page), paginated."""
        results: List[Dict[str, object]] = []
        cursor: Optional[str] = None
        while True:
            body: Dict[str, object] = {
                "filter": {"property": "object", "value": "page"},
                "page_size": 100,
            }
            if cursor:
                body["start_cursor"] = cursor
            data = self._request("POST", "/search", json=body)
            results.extend(_as_dict_list(data.get("results")))
            cursor = self._next_cursor(data, cursor)
            if cursor is None:
                break
        return results

    def get_database(self, db_id: str) -> Dict[str, object]:
        return self._request("GET", f"/databases/{db_id}")

    def get_page(self, page_id: str) -> Dict[str, object]:
        return self._request("GET", f"/pages/{page_id}")

    def get_block(self, block_id: str) -> Dict[str, object]:
        return self._request("GET", f"/blocks/{block_id}")

    def query_database(self, db_id: str) -> Iterable[Dict[str, object]]:
        cursor: Optional[str] = None
        while True:
            body: Dict[str, object] = {"page_size": 100}
            if cursor:
                body["start_cursor"] = cursor
            data = self._request("POST", f"/databases/{db_id}/query", json=body)
            for row in _as_dict_list(data.get("results")):
                yield row
            cursor = self._next_cursor(data, cursor)
            if cursor is None:
                break

    def get_block_children(self, block_id: str) -> List[Dict[str, object]]:
        """Children of a block/page, recursive: fills `_children` when `has_children`."""
        results: List[Dict[str, object]] = []
        cursor: Optional[str] = None
        while True:
            params: QueryParams = {"page_size": 100}
            if cursor:
                params["start_cursor"] = cursor
            data = self._request("GET", f"/blocks/{block_id}/children", params=params)
            for block in _as_dict_list(data.get("results")):
                if block.get("has_children"):
                    block["_children"] = self.get_block_children(str(block["id"]))
                results.append(block)
            cursor = self._next_cursor(data, cursor)
            if cursor is None:
                break
        return results

    def get_block_children_shallow(self, block_id: str) -> List[Dict[str, object]]:
        """DIRECT children of a block/page (a single level, no recursion) — to quickly
        scan which blocks exist without downloading the whole tree."""
        results: List[Dict[str, object]] = []
        cursor: Optional[str] = None
        while True:
            params: QueryParams = {"page_size": 100}
            if cursor:
                params["start_cursor"] = cursor
            data = self._request("GET", f"/blocks/{block_id}/children", params=params)
            results.extend(_as_dict_list(data.get("results")))
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
            body = _as_dict(resp.json())
        except Exception:  # noqa: BLE001
            return "error"
        msg = str(body.get("message") or "").lower()
        code = body.get("code") or ""
        if "linked database" in msg:
            return "linked"
        if "is a page" in msg:
            return "page"
        if code == "object_not_found" or "could not find" in msg:
            return "inaccessible"
        return "error"


def _page_title(page: Dict[str, object]) -> str:
    """Title of a Notion page (value of the `title` field)."""
    for raw_prop in _as_dict(page.get("properties")).values():
        prop = _as_dict(raw_prop)
        if prop.get("type") == "title":
            return rich_text_to_md(prop.get("title"))
    return ""
