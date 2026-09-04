"""Typed filesystem and registry adapter for the Notion clone route."""

from __future__ import annotations

from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Protocol
import uuid

import yaml

from backend.domains.notion.clone_runtime import CloneRestClient
from backend.services.notion_attachments import download_file, download_to

JsonMap = Dict[str, object]


def _map_list(value: object) -> List[JsonMap]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _report_messages(report: JsonMap) -> List[object]:
    value = report.get("warnings")
    return value if isinstance(value, list) else []


class VaultRoutesPort(Protocol):
    def registry_mutation(self) -> AbstractContextManager[None]: ...

    def load_registry(self) -> JsonMap: ...

    def save_registry(self, registry: JsonMap) -> None: ...

    def register_page_in_index(self, path: Path) -> None: ...

    def _schema_revision(self, value: object) -> int: ...

    def _table_schema_signature(self, value: object) -> object: ...

    def _property_config_value(self, prop: Optional[JsonMap], key: str) -> object: ...

    def _move_page_to_trash(self, page_id: str, path: Path) -> None: ...

    def remove_from_link_index(self, page_id: str) -> None: ...

    def _remove_page_from_index_cache(self, page_id: str, path: Path) -> None: ...


@dataclass(frozen=True)
class RouteCloneDependencies:
    get_token: Callable[[], Optional[str]]
    mcp_connected: Callable[[], bool]
    active_vault_path: Callable[[], Optional[Path]]
    client_factory: Callable[[str], CloneRestClient]
    fetch_page: Callable[[str], str]
    mcp_to_markdown: Callable[[str], str]
    clone_workspace: Callable[..., JsonMap]
    progress_callback: Callable[[str, int, int, JsonMap], None]
    should_cancel: Callable[[], bool]
    sanitize_folder: Callable[[str], str]
    sanitize_title: Callable[..., str]
    vault_routes: VaultRoutesPort
    log_warning: Callable[..., None]


@dataclass
class RouteCloneContext:
    vault: Path
    target_folder: str
    dependencies: RouteCloneDependencies
    folder_by_table: Dict[str, str] = field(default_factory=dict)
    path_by_id: Dict[str, Path] = field(default_factory=dict)
    written_ids_by_table: Dict[str, set[str]] = field(default_factory=dict)

    def frontmatter_meta(self, path: Path) -> JsonMap:
        try:
            with path.open(encoding="utf-8") as handle:
                if handle.readline().strip() != "---":
                    return {}
                lines: List[str] = []
                for line in handle:
                    if line.strip() == "---":
                        loaded = yaml.safe_load("".join(lines))
                        return dict(loaded) if isinstance(loaded, dict) else {}
                    lines.append(line)
        except Exception:  # noqa: BLE001
            return {}
        return {}

    def scan_existing_paths(self) -> None:
        for root_name in ("BD", "Wiki", ".Dashboards"):
            root = self.vault / root_name
            if not root.is_dir():
                continue
            for path in root.rglob("*.md"):
                page_id = self.frontmatter_meta(path).get("id")
                if page_id:
                    self.path_by_id.setdefault(str(page_id), path)

    @staticmethod
    def _ensure_database(registry: JsonMap) -> None:
        databases = _map_list(registry.setdefault("databases", []))
        registry["databases"] = databases
        entry = next(
            (
                item
                for item in databases
                if isinstance(item, dict) and item.get("id") == "notion_clone_db"
            ),
            None,
        )
        if entry is None:
            databases.append({"id": "notion_clone_db", "name": "Notion", "folder": "BD"})
            return
        if not entry.get("name"):
            entry["name"] = "Notion"
        if entry.get("folder") != "BD":
            entry["folder"] = "BD"

    def _merge_table(self, tables: List[JsonMap], table: JsonMap) -> None:
        index = next(
            (
                item_index
                for item_index, existing in enumerate(tables)
                if existing.get("id") == table["id"]
            ),
            None,
        )
        if index is None:
            table["schema_revision"] = 1
            tables.append(table)
            return
        existing = tables[index]
        if not (table.get("properties") or []) and (existing.get("properties") or []):
            self.dependencies.log_warning(
                "notion clone: refusing to overwrite table %r (%s) with an empty "
                "properties list; keeping the %d existing propert(ies).",
                existing.get("name"),
                table.get("id"),
                len(existing["properties"] if isinstance(existing["properties"], list) else []),
            )
            table["properties"] = existing["properties"]
        previous_revision = self.dependencies.vault_routes._schema_revision(
            existing.get("schema_revision")
        )
        current_signature = self.dependencies.vault_routes._table_schema_signature(
            table.get("properties")
        )
        previous_signature = self.dependencies.vault_routes._table_schema_signature(
            existing.get("properties")
        )
        if current_signature != previous_signature:
            table["schema_revision"] = previous_revision + 1
        elif previous_revision:
            table["schema_revision"] = previous_revision
        tables[index] = table

    def write_table(self, table: JsonMap) -> None:
        with self.dependencies.vault_routes.registry_mutation():
            registry = self.dependencies.vault_routes.load_registry()
            raw_tables = registry.setdefault("tables", [])
            tables = _map_list(raw_tables)
            registry["tables"] = tables
            registry.setdefault("views", [])
            self._ensure_database(registry)
            table["database_id"] = "notion_clone_db"
            self._merge_table(tables, table)
            physical = f"BD/{table['folder']}"
            self.folder_by_table[str(table["id"])] = physical
            self.dependencies.vault_routes.save_registry(registry)
        (self.vault / physical).mkdir(parents=True, exist_ok=True)

    def write_view(self, view: JsonMap) -> None:
        with self.dependencies.vault_routes.registry_mutation():
            registry = self.dependencies.vault_routes.load_registry()
            raw_views = registry.setdefault("views", [])
            views = _map_list(raw_views)
            registry["views"] = views
            index = next(
                (
                    item_index
                    for item_index, existing in enumerate(views)
                    if isinstance(existing, dict) and existing.get("id") == view.get("id")
                ),
                None,
            )
            if index is None:
                views.append(view)
            else:
                views[index] = view
            self.dependencies.vault_routes.save_registry(registry)

    def _target_path(self, metadata: JsonMap) -> Path:
        table_id = metadata.get("table_id")
        folder = self.folder_by_table.get(str(table_id)) if table_id else None
        if folder is None:
            folder = ".Dashboards" if metadata.get("is_dashboard") else "Wiki"
        target_directory = self.vault / folder
        target_directory.mkdir(parents=True, exist_ok=True)
        existing = self.path_by_id.get(str(metadata["id"]))
        if existing is not None and existing.exists() and existing.parent != target_directory:
            existing.unlink()
            existing = None
        if existing is not None and existing.exists():
            return existing
        safe_title = self.dependencies.sanitize_title(metadata["title"])
        path = target_directory / f"{safe_title}.md"
        current_id = self.frontmatter_meta(path).get("id") if path.exists() else None
        if path.exists() and str(current_id) != str(metadata["id"]):
            path = target_directory / f"{safe_title} {str(metadata['id'])[:8]}.md"
        return path

    def write_page(self, page: JsonMap) -> None:
        metadata_value = page.get("metadata")
        metadata = dict(metadata_value) if isinstance(metadata_value, dict) else {}
        metadata["title"] = page.get("title") or "Untitled"
        metadata["id"] = page.get("id") or str(uuid.uuid4())
        metadata = {key: value for key, value in metadata.items() if value is not None}
        path = self._target_path(metadata)
        page_id = str(metadata["id"])
        self.path_by_id[page_id] = path
        table_id = metadata.get("table_id")
        if table_id:
            self.written_ids_by_table.setdefault(str(table_id), set()).add(page_id)
        frontmatter = yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False).strip()
        content = str(page.get("content") or "").lstrip()
        path.write_text(f"---\n{frontmatter}\n---\n\n{content}\n", encoding="utf-8")
        self.dependencies.vault_routes.register_page_in_index(path)

    def save_asset(self, url: str, prop: Optional[str], table: JsonMap) -> Optional[str]:
        properties = _map_list(table.get("properties"))
        prop_dict = (
            next(
                (
                    item
                    for item in properties
                    if isinstance(item, dict) and item.get("name") == prop
                ),
                None,
            )
            if prop
            else None
        )
        storage = (
            str(
                self.dependencies.vault_routes._property_config_value(prop_dict, "storage_folder")
                if prop_dict
                else ""
            )
            .strip()
            .lower()
        )
        timeout = 90.0
        if storage == "library":
            filename = download_file(url, self.vault / "Library", timeout=timeout)
            return f"/api/vault/library/{filename}" if filename else None
        leaf = self.dependencies.sanitize_title(table.get("name"), fallback="Taula")
        subfolder = self.dependencies.sanitize_title(prop, fallback="") if prop else "_cos"
        destination = self.vault / "Assets"
        if self.target_folder:
            destination = destination / self.target_folder
        destination = destination / leaf / (subfolder or "_camp")
        downloaded = download_to(url, destination, self.vault, timeout=timeout)
        return str(downloaded) if downloaded else None

    def _orphan_paths(self, table_id: str, physical: str) -> List[Path]:
        table_directory = self.vault / physical
        if not table_directory.is_dir():
            return []
        written = self.written_ids_by_table.get(table_id, set())
        return [
            path
            for path in sorted(table_directory.glob("*.md"))
            if str(self.frontmatter_meta(path).get("table_id")) == table_id
            and str(self.frontmatter_meta(path).get("id")) not in written
        ]

    def _prune_or_warn(self, report: JsonMap, path: Path, prune: bool) -> None:
        metadata = self.frontmatter_meta(path)
        page_id = str(metadata.get("id") or "")
        if prune and page_id:
            try:
                self.dependencies.vault_routes._move_page_to_trash(page_id, path)
                self.dependencies.vault_routes.remove_from_link_index(page_id)
                self.dependencies.vault_routes._remove_page_from_index_cache(page_id, path)
                pruned = report.get("orphan_rows_pruned")
                report["orphan_rows_pruned"] = (pruned if isinstance(pruned, int) else 0) + 1
                return
            except Exception as exc:  # noqa: BLE001
                warnings = _report_messages(report)
                warnings.append(
                    f"Could not move orphan row «{path.relative_to(self.vault)}» "
                    f"(id {page_id}) to trash: {exc}"
                )
                report["warnings"] = warnings
        warnings = _report_messages(report)
        warnings.append(
            f"Orphan row (id no longer exists in Notion): «{path.relative_to(self.vault)}» "
            f"(id {metadata.get('id')}). It was not deleted automatically."
        )
        report["warnings"] = warnings

    def process_orphans(self, report: JsonMap, prune: bool, cancelled: bool) -> None:
        report["orphan_rows_pruned"] = 0
        if report.get("truncated") or report.get("errors") or cancelled:
            return
        for table_id, physical in self.folder_by_table.items():
            for path in self._orphan_paths(table_id, physical):
                self._prune_or_warn(report, path, prune)


def run_route_clone(
    dependencies: RouteCloneDependencies,
    database_ids: Optional[List[str]],
    target_folder: str = "Clon Notion",
    schema_overrides: Optional[Dict[str, JsonMap]] = None,
    loose_page_types: Optional[Dict[str, str]] = None,
    download_assets: bool = True,
    prune_orphans: bool = False,
    follow_subpages: bool = True,
) -> JsonMap:
    """Run the exact clone with late-bound route and filesystem dependencies."""
    token = dependencies.get_token()
    if not token:
        raise RuntimeError("No Notion integration token is configured")
    if not dependencies.mcp_connected():
        raise RuntimeError("Connect Notion MCP (embedded views) before cloning")
    vault = dependencies.active_vault_path()
    if not vault:
        raise RuntimeError("There is no active vault")
    rest_client = dependencies.client_factory(token)
    sanitized_folder = dependencies.sanitize_folder(target_folder)
    context = RouteCloneContext(vault, sanitized_folder, dependencies)
    context.scan_existing_paths()
    selected_ids = (
        database_ids
        if database_ids is not None
        else [str(database["id"]) for database in rest_client.search_databases()]
    )
    registry = dependencies.vault_routes.load_registry()
    raw_tables = registry.get("tables")
    registry_tables = (
        [dict(table) for table in raw_tables if isinstance(table, dict)]
        if isinstance(raw_tables, list)
        else []
    )
    report = dependencies.clone_workspace(
        rest_client,
        fetch_page=dependencies.fetch_page,
        mcp_to_markdown=dependencies.mcp_to_markdown,
        write_table=context.write_table,
        write_page=context.write_page,
        write_view=context.write_view,
        database_ids=selected_ids,
        target_folder=sanitized_folder,
        schema_overrides=schema_overrides,
        save_asset=context.save_asset if download_assets else None,
        loose_page_types=loose_page_types,
        progress_cb=dependencies.progress_callback,
        should_cancel=dependencies.should_cancel,
        registry_tables=registry_tables,
        follow_subpages=follow_subpages,
    )
    result = dict(report)
    context.process_orphans(result, prune_orphans, dependencies.should_cancel())
    return result
