"""Page-node loading, cache reuse and graph insertion."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Tuple, cast

from backend.domains.graph.adapters import Graph
from backend.domains.vault.registry.records import RecordReader
from backend.domains.graph.scanning import (
    COLOR_PALETTE,
    _KIND_PATTERNS,
    _STATUS_IDEA_RE,
    parse_frontmatter,
    parse_section_links,
)
from backend.services.relation_links import (
    relation_keys_from_table,
    strip_relation_wikilinks,
)

NodeData = Dict[str, Any]


def build_folder_lookups(
    registry: Dict[str, Any],
) -> Tuple[Dict[str, str], Dict[str, str]]:
    """Map table folders to their stable table and database IDs."""
    table_ids: Dict[str, str] = {}
    database_ids: Dict[str, str] = {}
    for table in cast(List[Dict[str, Any]], registry.get("tables", [])):
        folder = table.get("folder")
        if folder:
            table_ids[str(folder)] = str(table["id"])
            database_ids[str(folder)] = str(table.get("database_id", ""))
    return table_ids, database_ids


def relative_skipped_dirs(vault_path: Path, paths: List[str]) -> List[str]:
    """Hide host paths when reporting unreadable vault directories."""
    result: List[str] = []
    for directory in paths:
        try:
            result.append(str(Path(directory).relative_to(vault_path)))
        except ValueError:
            result.append(directory)
    return result


def load_page_data(
    file_path: Path,
    path_str: str,
    mtime: float,
    cfg: Any,
    cache: Dict[str, NodeData],
) -> NodeData:
    """Return cached page data or parse and cache the current file."""
    cache_key = str(file_path)
    cached = cache.get(cache_key)
    if cached and cached.get("mtime") == mtime:
        return cached

    raw_content = file_path.read_text(encoding="utf-8")
    raw_metadata, body = parse_frontmatter(raw_content, file_path)
    file_id = file_path.stem
    node_id = raw_metadata.get("id") or file_id
    metadata, managed_kind = _managed_metadata(raw_metadata, node_id)
    title = metadata.get("title") or file_id
    kind = _classify_kind(metadata, managed_kind, path_str, cfg)
    color = _node_color(metadata, kind, cfg)
    section_links = parse_section_links(raw_content)
    all_links = list({link for links in section_links.values() for link in links})
    data: NodeData = {
        "mtime": mtime,
        "id": node_id,
        "title": title,
        "kind": kind,
        "color": color,
        "size": 8 + min(len(body) // 1000, 10),
        "metadata": metadata,
        "links": all_links,
        "section_links": section_links,
    }
    cache[cache_key] = data
    return data


def _managed_metadata(metadata: RecordReader, node_id: object) -> tuple[RecordReader, str]:
    try:
        from backend.services import llm_wiki_config, llm_wiki_storage

        merged = llm_wiki_storage.merge_page_metadata(metadata, str(node_id))
        return merged, str(llm_wiki_config.metadata_note_type(merged))
    except Exception:  # noqa: BLE001
        return metadata, ""


def _classify_kind(metadata: RecordReader, managed_kind: str, path_str: str, cfg: Any) -> str:
    app_cfg = cast(Dict[str, Any], cfg.get("app", {}))
    type_property = str(app_cfg.get("type_property", "note_type"))
    raw_kind = (
        metadata.get("note_type")
        or metadata.get(type_property)
        or managed_kind
        or metadata.get("type")
        or "page"
    )
    kind = "page"
    for pattern, candidate in _KIND_PATTERNS:
        if pattern.search(str(raw_kind)):
            kind = candidate
            break
    if kind == "page" and (path_str.startswith("Contacts/") or path_str.startswith("Contactes/")):
        return "contact"
    if kind == "page" and path_str.startswith("Calendar/"):
        return "calendar"
    return kind


def _node_color(metadata: RecordReader, kind: str, cfg: Any) -> str:
    node_colors = cast(Dict[str, Dict[str, Any]], cfg.colors.get("node_types", {}))
    color_cfg = node_colors.get(kind, node_colors.get("default", {}))
    color = str(color_cfg.get("bg", COLOR_PALETTE.get(kind, COLOR_PALETTE["page"])))
    status = str(metadata.get("estat") or metadata.get("status") or "")
    return "#fcd34d" if _STATUS_IDEA_RE.search(status) else color


def infer_table_ids(
    metadata: Dict[str, Any],
    path_str: str,
    table_ids: Dict[str, str],
    database_ids: Dict[str, str],
) -> Tuple[Any, Any]:
    """Infer table identity from BD paths when frontmatter omits it."""
    table_id = metadata.get("table_id") or metadata.get("database_table_id")
    database_id = metadata.get("database_id")
    path_parts = path_str.replace("\\", "/").split("/")
    if not table_id and len(path_parts) >= 3 and path_parts[0] == "BD":
        folder = path_parts[2]
        table_id = table_ids.get(folder)
        database_id = database_id or database_ids.get(folder)
    return table_id, database_id


def relation_metadata(
    metadata: Dict[str, Any], table_id: Any, registry: Dict[str, Any]
) -> Dict[str, Any]:
    """Normalize only fields declared as relations by the table schema."""
    table = next(
        (
            item
            for item in cast(List[Dict[str, Any]], registry.get("tables", []))
            if item.get("id") == table_id
        ),
        None,
    )
    relation_keys = relation_keys_from_table(table)
    if relation_keys:
        return strip_relation_wikilinks(dict(metadata), relation_keys)
    return metadata


def add_page_node(
    graph: Graph,
    data: NodeData,
    metadata: Dict[str, Any],
    path_str: str,
    file_path: Path,
    table_id: Any,
    database_id: Any,
    page_nodes: List[Dict[str, Any]],
) -> None:
    """Insert one page in NetworkX and in the cached edge input list."""
    node_id = data["id"]
    graph.add_node(
        node_id,
        label=data["title"],
        kind=data["kind"],
        color=data["color"],
        size=data["size"],
        metadata=metadata,
        path=path_str,
        table_id=table_id,
        database_id=database_id,
    )
    page_nodes.append(
        {
            "id": node_id,
            "title": data["title"],
            "tags": metadata.get("tags", []),
            "metadata": metadata,
            "path": file_path,
            "links": data["links"],
            "section_links": data.get("section_links", {}),
            "table_id": table_id,
        }
    )
