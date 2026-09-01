"""Contracts for serialized cross-record formula recomputation."""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path

from backend.domains.vault.tables import formula_recalculation


def test_formula_recalculation_updates_every_matching_visible_row(
    tmp_path: Path,
) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    rows = {
        "first.md": {"id": "first", "table_id": "table-1", "value": 1},
        "second.md": {"id": "second", "database_table_id": "table-1", "value": 2},
        "other.md": {"id": "other", "table_id": "table-2", "value": 3},
        "template.md": {
            "id": "template",
            "table_id": "table-1",
            "is_template": True,
        },
    }
    for name, metadata in rows.items():
        (vault / name).write_text(json.dumps(metadata), encoding="utf-8")
    hidden = vault / ".history"
    hidden.mkdir()
    (hidden / "hidden.md").write_text(
        json.dumps({"id": "hidden", "table_id": "table-1"}),
        encoding="utf-8",
    )
    saved: list[str] = []
    refreshed: list[str] = []
    invalidations: list[bool] = []
    states: dict[str, formula_recalculation.RecalculationState] = {}

    def parse_frontmatter(raw: str, _path: Path) -> tuple[dict[str, object], str]:
        loaded = json.loads(raw)
        assert isinstance(loaded, dict)
        return loaded, "body"

    def process_updates(
        page_id: str,
        _old: dict[str, object],
        new: dict[str, object],
    ) -> dict[str, object]:
        new["rollup"] = page_id
        return new

    dependencies = formula_recalculation.FormulaRecalculationDependencies(
        lock=threading.Lock(),
        states=states,
        monotonic=lambda: 10.0,
        cooldown_seconds=0.5,
        vault_root=lambda: vault,
        parse_frontmatter=parse_frontmatter,
        table_has_cross_record_formulas=lambda _table_id: True,
        process_updates=process_updates,
        save_page=lambda path, _metadata, _body: saved.append(path.name),
        refresh_page_index=lambda path, _metadata, _body: refreshed.append(path.name),
        invalidate_pages_cache=lambda: invalidations.append(True),
        logger=logging.getLogger(__name__),
    )

    formula_recalculation.recompute_cross_record_formulas_for_table(
        "table-1",
        None,
        dependencies,
    )

    assert saved == ["first.md", "second.md"]
    assert refreshed == saved
    assert invalidations == [True]
    assert states["table-1"] == {
        "running": False,
        "pending": False,
        "last_run": 10.0,
    }


def test_formula_recalculation_coalesces_a_concurrent_request(tmp_path: Path) -> None:
    states: dict[str, formula_recalculation.RecalculationState] = {
        "table-1": {"running": True, "pending": False, "last_run": 0.0}
    }
    dependencies = formula_recalculation.FormulaRecalculationDependencies(
        lock=threading.Lock(),
        states=states,
        monotonic=lambda: 10.0,
        cooldown_seconds=0.5,
        vault_root=lambda: tmp_path,
        parse_frontmatter=lambda _raw, _path: ({}, ""),
        table_has_cross_record_formulas=lambda _table_id: True,
        process_updates=lambda _page_id, _old, new: new,
        save_page=lambda _path, _metadata, _body: None,
        refresh_page_index=lambda _path, _metadata, _body: None,
        invalidate_pages_cache=lambda: None,
        logger=logging.getLogger(__name__),
    )

    formula_recalculation.recompute_cross_record_formulas_for_table(
        "table-1",
        None,
        dependencies,
    )

    assert states["table-1"]["pending"] is True


def test_formula_recalculation_domain_does_not_import_http_facade() -> None:
    source_path = Path(formula_recalculation.__file__ or "")
    assert source_path.is_file()
    assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
