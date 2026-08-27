"""Behavior and architecture contracts for bulk Vault metadata mutations."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import cast

from backend.domains.vault.pages import metadata_mutations


Metadata = metadata_mutations.Metadata


def _read_record(path: Path) -> tuple[Metadata, str]:
    loaded = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    metadata = loaded.get("metadata")
    assert isinstance(metadata, dict)
    return cast(Metadata, metadata), str(loaded.get("body") or "")


def _write_record(path: Path, metadata: Metadata, body: str = "") -> None:
    path.write_text(
        json.dumps({"metadata": metadata, "body": body}, ensure_ascii=False),
        encoding="utf-8",
    )


def _dependencies(
    paths: dict[str, Path],
    registry: Metadata,
    refreshes: list[str],
    invalidations: list[str],
) -> metadata_mutations.MetadataMutationDependencies:
    @contextmanager
    def registry_mutation() -> Iterator[None]:
        yield

    async def page_write_lock(_page_id: str) -> asyncio.Lock:
        return asyncio.Lock()

    def save_page(path: Path, metadata: Metadata, body: str) -> None:
        _write_record(path, metadata, body)

    def table_by_id(table_id: str) -> Metadata | None:
        tables = registry.get("tables")
        if not isinstance(tables, list):
            return None
        return next(
            (
                cast(Metadata, table)
                for table in tables
                if isinstance(table, dict) and table.get("id") == table_id
            ),
            None,
        )

    return metadata_mutations.MetadataMutationDependencies(
        registry_mutation=registry_mutation,
        load_registry=lambda: registry,
        save_registry=lambda _registry: None,
        new_id=lambda: "new-property-id",
        page_snapshot=lambda: [],
        find_page=lambda page_id: paths.get(page_id),
        parse_frontmatter=lambda _raw, path: _read_record(path),
        save_page=save_page,
        file_etag=lambda path: path.read_text(encoding="utf-8"),
        refresh_page_index=lambda path, _metadata, _body: refreshes.append(path.name),
        invalidate_citation_index=lambda: invalidations.append("citations"),
        invalidate_page_cache=lambda: invalidations.append("pages"),
        table_id=lambda metadata: str(metadata.get("table_id") or ""),
        table_by_id=table_by_id,
        page_write_lock=page_write_lock,
    )


def test_promote_extra_creates_column_and_refreshes_page(tmp_path: Path) -> None:
    page = tmp_path / "page.json"
    _write_record(
        page,
        {
            "id": "p1",
            "table_id": "table-1",
            "Zotero Extras": {"patentNumber": "US123", "country": "US"},
        },
        "body",
    )
    registry: Metadata = {"tables": [{"id": "table-1", "properties": []}]}
    refreshes: list[str] = []
    invalidations: list[str] = []
    dependencies = _dependencies({"p1": page}, registry, refreshes, invalidations)

    result = asyncio.run(
        metadata_mutations.promote_zotero_extra(
            {
                "table_id": "table-1",
                "zotero_field": "patentNumber",
                "column_name": "Patent",
                "page_ids": ["p1"],
            },
            dependencies,
        )
    )

    metadata, body = _read_record(page)
    assert result["column_created"] is True
    assert result["migrated_ids"] == ["p1"]
    assert metadata["Patent"] == "US123"
    assert metadata["Zotero Extras"] == {"country": "US"}
    assert body == "body"
    assert refreshes == ["page.json"]
    assert invalidations == ["citations", "pages"]
    tables = cast(list[Metadata], registry["tables"])
    properties = cast(list[Metadata], tables[0]["properties"])
    assert properties == [{"id": "new-property-id", "name": "Patent", "type": "text"}]


def test_bulk_update_reports_conflict_without_overwriting(tmp_path: Path) -> None:
    page = tmp_path / "page.json"
    _write_record(page, {"id": "p1", "Status": "old"})
    dependencies = _dependencies({"p1": page}, {"tables": []}, [], [])

    result = asyncio.run(
        metadata_mutations.bulk_update_metadata(
            {
                "page_ids": ["p1"],
                "updates": {"Status": "new"},
                "expected_etags": {"p1": "stale"},
            },
            dependencies,
        )
    )

    assert result["updated"] == 0
    conflicts = cast(list[Metadata], result["conflicts"])
    assert conflicts[0]["page_id"] == "p1"
    assert _read_record(page)[0]["Status"] == "old"


def test_bulk_template_copies_only_schema_fields_and_body(tmp_path: Path) -> None:
    template = tmp_path / "template.json"
    target = tmp_path / "target.json"
    _write_record(
        template,
        {
            "id": "tpl",
            "table_id": "table-1",
            "is_template": True,
            "Status": "Ready",
            "Secret": "must-not-copy",
        },
        "template body",
    )
    _write_record(
        target,
        {"id": "p1", "table_id": "table-1", "status_alias": "Old", "Title": "Keep"},
        "old body",
    )
    registry: Metadata = {
        "tables": [
            {
                "id": "table-1",
                "properties": [{"id": "status-id", "name": "Status", "aliases": ["status_alias"]}],
            }
        ]
    }
    refreshes: list[str] = []
    invalidations: list[str] = []
    dependencies = _dependencies(
        {"tpl": template, "p1": target},
        registry,
        refreshes,
        invalidations,
    )

    result = asyncio.run(
        metadata_mutations.bulk_apply_template(
            {"page_ids": ["p1", "p1"], "template_id": "tpl"},
            dependencies,
        )
    )

    metadata, body = _read_record(target)
    assert result["updated_ids"] == ["p1"]
    assert metadata == {
        "id": "p1",
        "table_id": "table-1",
        "status_alias": "Ready",
        "Title": "Keep",
    }
    assert body == "template body"
    assert refreshes == ["target.json"]
    assert invalidations == ["citations", "pages"]


def test_metadata_mutation_domain_does_not_import_http_facade() -> None:
    source_path = Path(metadata_mutations.__file__ or "")
    assert source_path.is_file()
    assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
