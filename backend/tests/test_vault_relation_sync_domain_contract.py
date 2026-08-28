"""Behavior and architecture contracts for relation synchronization IO."""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from backend.domains.vault.links import relation_sync


def test_inverse_change_is_idempotent_and_refreshes_derived_indexes(
    tmp_path: Path,
) -> None:
    target = tmp_path / "target.md"
    target.write_text("body", encoding="utf-8")
    stored: relation_sync.Metadata = {"id": "target", "ÀREES": ["existing"]}
    entries: relation_sync.PageCache = {}
    paths: relation_sync.PagePaths = {}
    link_updates: list[str] = []
    versions: list[str] = []

    def relation_ids(value: object) -> list[str]:
        return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []

    def parse_frontmatter(
        _raw: str,
        _path: Path,
    ) -> tuple[relation_sync.Metadata, str]:
        return dict(stored), "body"

    def save_page(
        _path: Path,
        metadata: relation_sync.Metadata,
        _body: str,
    ) -> None:
        stored.clear()
        stored.update(metadata)

    dependencies = relation_sync.RelationSyncDependencies(
        normalize_name=lambda value: str(value or "").lower(),
        relation_ids=relation_ids,
        relation_changes=lambda _old, _new, _origin, _table: [],
        table_by_id=lambda _table_id: None,
        find_page=lambda page_id: target if page_id == "target" else None,
        parse_frontmatter=parse_frontmatter,
        save_page=save_page,
        update_link_index=lambda path: link_updates.append(path.name),
        active_vault_path=lambda: tmp_path,
        build_page_cache_entry=lambda path, _stat: {
            "id": "target",
            "path": str(path),
        },
        page_index_lock=lambda: threading.RLock(),
        page_index_entries=lambda: entries,
        page_id_to_path=lambda: paths,
        bump_page_index_version=lambda vault_key: versions.append(vault_key),
        invalidate_page_responses=lambda: None,
        logger=logging.getLogger(__name__),
    )

    assert relation_sync.apply_inverse_change(
        "target",
        "àrees",
        "host",
        "add",
        dependencies,
    )
    assert stored["ÀREES"] == ["existing", "host"]
    assert not relation_sync.apply_inverse_change(
        "target",
        "àrees",
        "host",
        "add",
        dependencies,
    )
    assert link_updates == ["target.md"]
    assert entries[str(tmp_path)][str(target)]["id"] == "target"
    assert paths[str(tmp_path)]["target"] == str(target)
    assert versions == [str(tmp_path)]


def test_propagation_ignores_self_reference_and_invalidates_after_write(
    tmp_path: Path,
) -> None:
    target = tmp_path / "target.md"
    target.write_text("body", encoding="utf-8")
    stored: relation_sync.Metadata = {"id": "target"}
    invalidations: list[bool] = []

    def relation_ids(value: object) -> list[str]:
        return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []

    def parse_frontmatter(
        _raw: str,
        _path: Path,
    ) -> tuple[relation_sync.Metadata, str]:
        return dict(stored), "body"

    def save_page(
        _path: Path,
        metadata: relation_sync.Metadata,
        _body: str,
    ) -> None:
        stored.clear()
        stored.update(metadata)

    dependencies = relation_sync.RelationSyncDependencies(
        normalize_name=lambda value: str(value or "").lower(),
        relation_ids=relation_ids,
        relation_changes=lambda _old, _new, _origin, _table: [
            ("host", "Backlinks", "add"),
            ("target", "Backlinks", "add"),
        ],
        table_by_id=lambda table_id: {"id": table_id},
        find_page=lambda page_id: target if page_id == "target" else None,
        parse_frontmatter=parse_frontmatter,
        save_page=save_page,
        update_link_index=lambda _path: None,
        active_vault_path=lambda: None,
        build_page_cache_entry=lambda _path, _stat: {},
        page_index_lock=lambda: threading.RLock(),
        page_index_entries=dict,
        page_id_to_path=dict,
        bump_page_index_version=lambda _vault_key: None,
        invalidate_page_responses=lambda: invalidations.append(True),
        logger=logging.getLogger(__name__),
    )

    relation_sync.propagate_inverse("host", "origin", {}, {}, dependencies)

    assert stored["Backlinks"] == ["host"]
    assert invalidations == [True]


def test_relation_sync_domain_does_not_import_http_facade() -> None:
    source_path = Path(relation_sync.__file__ or "")
    assert source_path.is_file()
    assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
