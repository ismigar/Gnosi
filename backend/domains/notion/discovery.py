"""Typed discovery of loose pages and linked Notion databases."""

from __future__ import annotations

from typing import Callable, Dict, List, Protocol

JsonMap = Dict[str, object]
LoosePage = Dict[str, str]


class DiscoveryClient(Protocol):
    def search_pages(self) -> List[JsonMap]: ...

    def search_databases(self) -> List[JsonMap]: ...

    def get_page(self, page_id: str) -> JsonMap: ...

    def get_block(self, block_id: str) -> JsonMap: ...

    def get_block_children_shallow(self, block_id: str) -> List[JsonMap]: ...

    def database_kind(self, database_id: str) -> str: ...


ClientFactory = Callable[[str], DiscoveryClient]
TitleResolver = Callable[[Dict[str, object]], str]


def _parent_of(
    node_id: str,
    fetch: Callable[[str], JsonMap],
    pages_by_id: Dict[str, JsonMap],
) -> JsonMap:
    node = pages_by_id.get(node_id)
    if node is None:
        try:
            node = fetch(node_id)
            pages_by_id[node_id] = node
        except Exception:  # noqa: BLE001
            return {}
    parent = node.get("parent")
    return dict(parent) if isinstance(parent, dict) else {}


def _is_loose(
    node_id: str,
    kind: str,
    seen: set[tuple[str, str]],
    cache: Dict[tuple[str, str], bool],
    pages_by_id: Dict[str, JsonMap],
    client: DiscoveryClient,
) -> bool:
    key = (kind, node_id)
    if key in cache:
        return cache[key]
    if key in seen:
        return True
    seen.add(key)
    fetch = client.get_block if kind == "block" else client.get_page
    parent = _parent_of(node_id, fetch, pages_by_id)
    parent_type = parent.get("type")
    if parent_type == "database_id":
        result = False
    elif parent_type == "workspace":
        result = True
    elif parent_type == "page_id":
        result = _is_loose(str(parent["page_id"]), "page", seen, cache, pages_by_id, client)
    elif parent_type == "block_id":
        result = _is_loose(str(parent["block_id"]), "block", seen, cache, pages_by_id, client)
    else:
        result = True
    cache[key] = result
    return result


def collect_loose_pages(
    token: str,
    client_factory: ClientFactory,
    page_title: TitleResolver,
) -> List[LoosePage]:
    """Return pages whose complete parent chain reaches the workspace."""
    client = client_factory(token)
    pages = list(client.search_pages())
    pages_by_id = {str(page["id"]): page for page in pages}
    cache: Dict[tuple[str, str], bool] = {}
    return [
        {"id": str(page["id"]), "title": page_title(page) or "Untitled"}
        for page in pages
        if _is_loose(str(page["id"]), "page", set(), cache, pages_by_id, client)
    ]


def find_linked_databases(
    token: str,
    client_factory: ClientFactory,
    collect_pages: Callable[[str], List[LoosePage]],
    max_pages: int = 400,
) -> Dict[str, object]:
    """Find child-database blocks whose source database is unavailable."""
    client = client_factory(token)
    accessible = {str(database["id"]) for database in client.search_databases()}
    found: Dict[str, JsonMap] = {}
    scanned = 0
    capped = False
    for page in collect_pages(token):
        if scanned >= max_pages:
            capped = True
            break
        scanned += 1
        try:
            blocks = client.get_block_children_shallow(page["id"])
        except Exception:  # noqa: BLE001
            continue
        for block in blocks:
            database_id = str(block.get("id") or "")
            if block.get("type") != "child_database" or not database_id:
                continue
            if database_id in accessible or database_id in found:
                continue
            kind = client.database_kind(database_id)
            if kind not in ("linked", "inaccessible", "page"):
                continue
            raw_child = block.get("child_database")
            child = raw_child if isinstance(raw_child, dict) else {}
            found[database_id] = {
                "title": child.get("title") or "Untitled",
                "page_title": page.get("title") or "Untitled",
                "kind": kind,
            }
    return {"linked": list(found.values()), "scanned": scanned, "capped": capped}
