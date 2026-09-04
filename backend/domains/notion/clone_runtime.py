"""Typed phase orchestration for the exact Notion clone."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
import re
import time
from typing import Callable, Dict, Iterable, List, Optional, Protocol, TypedDict, cast

from backend.services import relation_sync
from backend.services.notion_attachments import (
    localize_body,
    localize_values,
    resolve_file_markers,
)
from backend.services.notion_schema_config import apply_override
from backend.services.relation_links import (
    decorate_relation_wikilinks,
    relation_keys_from_table,
)

JsonMap = Dict[str, object]
SaveAsset = Callable[[str, Optional[str], JsonMap], Optional[str]]
ProgressCallback = Callable[[str, int, int, JsonMap], None]
CollectedRow = tuple[JsonMap, JsonMap, JsonMap, str, set[str]]
InverseAdds = Dict[str, Dict[str, set[str]]]


class CloneReport(TypedDict):
    tables: int
    pages: int
    views: int
    attachments: int
    collected: int
    tables_total: int
    pages_total: int
    scan_done: int
    scan_total: int
    errors: List[JsonMap]
    warnings: List[str]
    truncated: bool


def _map_list(value: object) -> List[JsonMap]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


class CloneRestClient(Protocol):
    def list_users(self) -> Dict[str, str]: ...

    def search_databases(self) -> List[JsonMap]: ...

    def get_database(self, db_id: str) -> JsonMap: ...

    def query_database(self, db_id: str) -> Iterable[JsonMap]: ...

    def get_block(self, block_id: str) -> JsonMap: ...

    def get_page(self, page_id: str) -> JsonMap: ...

    def get_block_children(self, block_id: str) -> List[JsonMap]: ...


@dataclass(frozen=True)
class CloneDependencies:
    aborted_error: type[Exception]
    apply_icon_cover: Callable[[JsonMap, JsonMap, JsonMap, Optional[SaveAsset]], int]
    block_file_url: Callable[[JsonMap], Optional[str]]
    child_page_ids: Callable[[object], List[str]]
    clean_name: Callable[[object], object]
    clone_page_id: Callable[[str], str]
    clone_table_id: Callable[[str], str]
    clone_table_schema: Callable[[JsonMap], JsonMap]
    clone_values: Callable[[JsonMap, List[JsonMap]], JsonMap]
    page_title: Callable[[JsonMap], str]
    page_to_values: Callable[[JsonMap, Optional[Dict[str, str]]], JsonMap]
    plain_title: Callable[[object], str]
    resolve_view_markers: Callable[..., tuple[str, List[JsonMap]]]
    sanitize_title: Callable[..., str]
    strip_icon: Callable[[str], str]


@dataclass
class CloneRuntime:
    rest_client: CloneRestClient
    fetch_page: Callable[[str], str]
    mcp_to_markdown: Callable[[str], str]
    write_table: Callable[[JsonMap], None]
    write_page: Callable[[JsonMap], None]
    write_view: Callable[[JsonMap], None]
    database_ids: List[str]
    target_folder: str
    max_pages: int
    schema_overrides: Optional[Dict[str, JsonMap]]
    save_asset: Optional[SaveAsset]
    loose_page_types: Optional[Dict[str, str]]
    follow_subpages: bool
    progress_cb: Optional[ProgressCallback]
    should_cancel: Optional[Callable[[], bool]]
    registry_tables: Optional[List[JsonMap]]
    dependencies: CloneDependencies
    report: CloneReport = field(init=False)
    users: Dict[str, str] = field(init=False)
    clone_tables_by_name: Dict[str, JsonMap] = field(default_factory=dict)
    db_by_id: Dict[str, JsonMap] = field(default_factory=dict)
    collected: List[CollectedRow] = field(default_factory=list)
    clone_titles: Dict[str, str] = field(default_factory=dict)
    missing_title_cache: Dict[str, Optional[str]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.report = {
            "tables": 0,
            "pages": 0,
            "views": 0,
            "attachments": 0,
            "collected": 0,
            "tables_total": len(self.database_ids),
            "pages_total": 0,
            "scan_done": 0,
            "scan_total": 0,
            "errors": [],
            "warnings": [],
            "truncated": False,
        }
        self.users = dict(self.rest_client.list_users())

    def emit(self, phase: str, done: int, total: int) -> None:
        if self.should_cancel is not None and self.should_cancel():
            raise self.dependencies.aborted_error()
        if self.progress_cb is None:
            return
        try:
            self.progress_cb(phase, done, total, dict(self.report))
        except Exception:  # noqa: BLE001
            pass

    def table_key(self, name: object) -> str:
        return self.dependencies.strip_icon(str(name or ""))

    def resolve_clone_table(self, name: str) -> Optional[JsonMap]:
        return self.clone_tables_by_name.get(self.table_key(name))

    def id_to_title(self, row_id: str) -> Optional[str]:
        return self.clone_titles.get(row_id)

    def fresh_block_url(self, block_id: str) -> Optional[str]:
        try:
            block = self.rest_client.get_block(block_id)
            return self.dependencies.block_file_url(block)
        except Exception:  # noqa: BLE001
            return None

    def fetch_page_checked(self, page_id: str) -> str:
        markdown = self.fetch_page(page_id)
        for backoff in (2, 4):
            if markdown:
                return markdown
            time.sleep(backoff)
            markdown = self.fetch_page(page_id)
        if not markdown:
            self.report["errors"].append(
                {
                    "page": page_id,
                    "stage": "mcp_empty",
                    "error": "empty MCP fetch after three attempts (body not cloned)",
                }
            )
        return markdown

    def localize_file_markers(self, body: str, title: str, table: JsonMap) -> str:
        if not body or "gnosi-notion-file:" not in body:
            return body
        save_asset = self.save_asset
        resolver = self.fresh_block_url if save_asset is not None else lambda _block_id: None
        asset_writer = (
            (lambda url, prop: save_asset(url, prop, table)) if save_asset is not None else None
        )
        localized, downloaded, failed = resolve_file_markers(body, resolver, asset_writer)
        self.report["attachments"] += downloaded
        if failed and save_asset is not None:
            self.report["warnings"].append(
                f"“{title}”: {failed} Notion attachment(s) could not be downloaded; "
                "the file name is retained as text."
            )
        return localized

    def replace_body_link(self, match: re.Match[str]) -> str:
        notion_id = match.group(1)
        title = self.clone_titles.get(self.dependencies.clone_page_id(notion_id))
        if not title and notion_id not in self.missing_title_cache:
            try:
                page = self.rest_client.get_page(notion_id)
                self.missing_title_cache[notion_id] = self.dependencies.page_title(page) or None
            except Exception:  # noqa: BLE001
                self.missing_title_cache[notion_id] = None
        title = title or self.missing_title_cache.get(notion_id)
        if not title:
            return match.group(0)
        safe_title = re.sub(r"[\[\]|#]", "", title)
        return f"[[{safe_title}]]"

    def resolve_body_links(self, body: str) -> str:
        if not body or "[[" not in body:
            return body
        return re.sub(r"\[\[([0-9a-f]{32})\]\]", self.replace_body_link, body)

    def register_views(self, body: str, host_page_id: str, host_table_id: str) -> str:
        localized, views = self.dependencies.resolve_view_markers(
            body,
            host_page_id,
            host_table_id,
            fetch_view=self.fetch_page,
            resolve_clone_table=self.resolve_clone_table,
        )
        for view in views:
            self.write_view(view)
            self.report["views"] += 1
        return localized

    def localize_body(self, body: str, table: JsonMap) -> str:
        save_asset = self.save_asset
        if save_asset is None or not body:
            return body
        localized, downloaded = localize_body(
            body,
            lambda url, prop: save_asset(url, prop, table),
        )
        self.report["attachments"] += downloaded
        return localized

    def render_body(
        self,
        page_id: str,
        table: JsonMap,
        title: str,
        host_table_id: str,
    ) -> str:
        body = ""
        try:
            page_markdown = self.fetch_page_checked(page_id)
            body = self.mcp_to_markdown(page_markdown) if page_markdown else ""
            host_page_id = page_id.replace("-", "")
            body = self.register_views(body, host_page_id, host_table_id)
            body = self.localize_body(body, table)
            body = self.localize_file_markers(body, title, table)
        except Exception as exc:  # noqa: BLE001
            self.report["errors"].append({"page": page_id, "stage": "mcp", "error": str(exc)})
        return body

    def clone_standalone(self, page_id: str, page: JsonMap, extra_meta: JsonMap) -> None:
        title = self.dependencies.page_title(page) or "Sense títol"
        clone_id = self.dependencies.clone_page_id(page_id)
        self.clone_titles[clone_id] = title
        page_table: JsonMap = {"name": "Pàgines"}
        body = self.render_body(page_id, page_table, title, "")
        meta = dict(extra_meta)
        self.report["attachments"] += self.dependencies.apply_icon_cover(
            meta, page, page_table, self.save_asset
        )
        self.write_page(
            {
                "id": clone_id,
                "title": title,
                "content": self.resolve_body_links(body),
                "metadata": meta,
            }
        )
        self.report["pages"] += 1


def _seed_registry_tables(runtime: CloneRuntime) -> None:
    for table in runtime.registry_tables or []:
        key = runtime.table_key(table.get("name"))
        if key:
            runtime.clone_tables_by_name[key] = table


def _normalize_override_relations(runtime: CloneRuntime, table: JsonMap) -> None:
    selected_ids = {
        runtime.dependencies.clone_table_id(database_id) for database_id in runtime.database_ids
    }
    for prop in _map_list(table.get("properties")):
        prop["name"] = runtime.dependencies.clean_name(prop.get("name"))
        target = prop.get("relation_database_id")
        if prop.get("type") == "relation" and target and target not in selected_ids:
            prop["relation_database_id"] = runtime.dependencies.clone_table_id(str(target))


def _clone_schema_pass(runtime: CloneRuntime) -> None:
    for index, database_id in enumerate(runtime.database_ids):
        runtime.emit("schema", index, len(runtime.database_ids))
        try:
            database = runtime.rest_client.get_database(database_id)
            runtime.db_by_id[database_id] = database
            table = runtime.dependencies.clone_table_schema(database)
            if runtime.schema_overrides and database_id in runtime.schema_overrides:
                overridden = apply_override(table, runtime.schema_overrides[database_id])
                table = dict(overridden)
                _normalize_override_relations(runtime, table)
            table_name = runtime.dependencies.sanitize_title(table.get("name"), fallback="Taula")
            table["folder"] = (
                f"{runtime.target_folder}/{table_name}" if runtime.target_folder else table_name
            )
            runtime.write_table(table)
            runtime.report["tables"] += 1
            runtime.clone_tables_by_name[runtime.table_key(table.get("name"))] = table
        except Exception as exc:  # noqa: BLE001
            runtime.report["errors"].append(
                {"database": database_id, "stage": "schema", "error": str(exc)}
            )


def _warn_unselected_relations(runtime: CloneRuntime) -> None:
    cloned_ids = {table.get("id") for table in runtime.clone_tables_by_name.values()}
    for table in runtime.clone_tables_by_name.values():
        for prop in _map_list(table.get("properties")):
            target = prop.get("relation_database_id")
            if prop.get("type") != "relation" or not target or target in cloned_ids:
                continue
            runtime.report["warnings"].append(
                f"Table “{table.get('name')}” has relation field “{prop.get('name')}” pointing "
                "to an unselected database. These relations will have no destination; "
                "select every database."
            )


def _localize_row_values(runtime: CloneRuntime, values: JsonMap, table: JsonMap) -> JsonMap:
    save_asset = runtime.save_asset
    if save_asset is None:
        return values
    localized, downloaded = localize_values(
        values,
        _map_list(table.get("properties")),
        lambda url, prop: save_asset(url, prop, table),
    )
    runtime.report["attachments"] += downloaded
    return localized


def _collect_database_rows(
    runtime: CloneRuntime,
    database_id: str,
    database: JsonMap,
    database_index: int,
) -> None:
    table = runtime.resolve_clone_table(runtime.dependencies.plain_title(database.get("title")))
    if not table:
        return
    relation_keys = set(relation_keys_from_table(table))
    for row in runtime.rest_client.query_database(database_id):
        if len(runtime.collected) >= runtime.max_pages:
            runtime.report["truncated"] = True
            break
        runtime.emit("collect", database_index, len(runtime.db_by_id))
        try:
            raw_values = runtime.dependencies.page_to_values(row, runtime.users)
            values = runtime.dependencies.clone_values(
                raw_values, _map_list(table.get("properties"))
            )
            values = _localize_row_values(runtime, values, table)
            title = runtime.dependencies.page_title(row) or "Untitled"
            clone_id = runtime.dependencies.clone_page_id(str(row["id"]))
            runtime.clone_titles[clone_id] = title
            runtime.collected.append((table, row, values, title, relation_keys))
            runtime.report["collected"] = len(runtime.collected)
        except Exception as exc:  # noqa: BLE001
            runtime.report["errors"].append({"page": row.get("id"), "error": str(exc)})


def _collect_rows(runtime: CloneRuntime) -> None:
    for index, (database_id, database) in enumerate(runtime.db_by_id.items()):
        runtime.emit("collect", index, len(runtime.db_by_id))
        try:
            _collect_database_rows(runtime, database_id, database, index)
        except Exception as exc:  # noqa: BLE001
            runtime.report["errors"].append({"database": database_id, "error": str(exc)})


def _build_inverse_additions(runtime: CloneRuntime) -> InverseAdds:
    tables_by_id = {
        str(table.get("id") or ""): table for table in runtime.clone_tables_by_name.values()
    }
    inverse_adds: InverseAdds = {}
    for table, row, values, _title, relation_keys in runtime.collected:
        source_id = runtime.dependencies.clone_page_id(str(row["id"]))
        for key in relation_keys:
            targets = values.get(key)
            if not isinstance(targets, list) or not targets:
                continue
            pair = relation_sync.resolve_inverse_relation(
                table, key, lambda table_id: tables_by_id.get(str(table_id))
            )
            if not pair:
                continue
            inverse_field = str(pair[1])
            for target in targets:
                target_id = str(target)
                inverse_adds.setdefault(target_id, {}).setdefault(inverse_field, set()).add(
                    source_id
                )
    return inverse_adds


def _merge_inverse_values(values: JsonMap, additions: Optional[Dict[str, set[str]]]) -> None:
    for field_name, source_ids in (additions or {}).items():
        current = values.get(field_name)
        merged = list(current) if isinstance(current, list) else ([current] if current else [])
        for source_id in source_ids:
            if source_id not in merged:
                merged.append(source_id)
        values[field_name] = merged


def _write_collected_pages(runtime: CloneRuntime, inverse_adds: InverseAdds) -> None:
    runtime.report["pages_total"] = len(runtime.collected)
    for index, (table, row, values, title, relation_keys) in enumerate(runtime.collected):
        runtime.emit("pages", index, len(runtime.collected))
        try:
            page_id = str(row["id"])
            body = runtime.render_body(page_id, table, title, str(table["id"]))
            clone_id = runtime.dependencies.clone_page_id(page_id)
            _merge_inverse_values(values, inverse_adds.get(clone_id))
            metadata = {"table_id": table["id"], **values}
            decorate_relation_wikilinks(metadata, relation_keys, id_to_title=runtime.id_to_title)
            runtime.report["attachments"] += runtime.dependencies.apply_icon_cover(
                metadata, row, table, runtime.save_asset
            )
            runtime.write_page(
                {
                    "id": clone_id,
                    "title": title,
                    "content": runtime.resolve_body_links(body),
                    "metadata": metadata,
                }
            )
            runtime.report["pages"] += 1
        except Exception as exc:  # noqa: BLE001
            runtime.report["errors"].append({"page": row.get("id"), "error": str(exc)})


def _clone_loose_pages(runtime: CloneRuntime) -> None:
    loose_pages = list((runtime.loose_page_types or {}).items())
    runtime.report["pages_total"] += len(loose_pages)
    for index, (page_id, page_type) in enumerate(loose_pages):
        runtime.emit("loose", index, len(loose_pages))
        if runtime.report["pages"] >= runtime.max_pages:
            runtime.report["truncated"] = True
            break
        try:
            page = runtime.rest_client.get_page(page_id)
            metadata: JsonMap = (
                {"is_dashboard": True} if str(page_type).lower() == "dashboard" else {}
            )
            runtime.clone_standalone(page_id, page, metadata)
        except Exception as exc:  # noqa: BLE001
            runtime.report["errors"].append({"page": page_id, "stage": "loose", "error": str(exc)})


def _subpage_seed(runtime: CloneRuntime) -> List[str]:
    collected_ids = [str(row["id"]) for _table, row, _values, _title, _keys in runtime.collected]
    return collected_ids + list(runtime.loose_page_types or {})


def _clone_subpage(
    runtime: CloneRuntime,
    parent_id: str,
    child_id: str,
    queue: deque[str],
) -> bool:
    try:
        page = runtime.rest_client.get_page(child_id)
        runtime.clone_standalone(
            child_id,
            page,
            {"parent_id": runtime.dependencies.clone_page_id(parent_id)},
        )
        queue.append(child_id)
        runtime.report["scan_total"] += 1
        return True
    except Exception as exc:  # noqa: BLE001
        runtime.report["errors"].append({"page": child_id, "stage": "subpage", "error": str(exc)})
        return False


def _clone_subpages(runtime: CloneRuntime) -> None:
    if not runtime.follow_subpages:
        return
    seed = _subpage_seed(runtime)
    seen = {item.replace("-", "") for item in seed}
    queue: deque[str] = deque(seed)
    completed = 0
    runtime.report["scan_done"] = 0
    runtime.report["scan_total"] = len(queue)
    while queue and runtime.report["pages"] < runtime.max_pages:
        parent_id = queue.popleft()
        runtime.report["scan_done"] += 1
        runtime.emit("subpages", completed, 0)
        try:
            blocks = runtime.rest_client.get_block_children(parent_id)
        except Exception:  # noqa: BLE001
            continue
        for child_id in runtime.dependencies.child_page_ids(blocks):
            normalized = str(child_id).replace("-", "")
            if normalized in seen:
                continue
            seen.add(normalized)
            if runtime.report["pages"] >= runtime.max_pages:
                runtime.report["truncated"] = True
                break
            runtime.report["pages_total"] += 1
            runtime.emit("subpages", completed, 0)
            if _clone_subpage(runtime, parent_id, child_id, queue):
                completed += 1


def run_clone_workspace(runtime: CloneRuntime) -> JsonMap:
    """Execute the exact-clone phases without changing their observable order."""
    _seed_registry_tables(runtime)
    _clone_schema_pass(runtime)
    _warn_unselected_relations(runtime)
    _collect_rows(runtime)
    inverse_adds = _build_inverse_additions(runtime)
    _write_collected_pages(runtime, inverse_adds)
    _clone_loose_pages(runtime)
    _clone_subpages(runtime)
    runtime.emit("done", runtime.report["pages"], runtime.report["pages"])
    return dict(runtime.report)
