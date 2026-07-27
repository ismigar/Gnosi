"""Regression tests for stale full-table schema writes."""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.api.vault_routes import _reconcile_table_schema_revision  # noqa: E402


def _table(properties, *, revision=None, source=None):
    table = {"id": "table-1", "name": "Notes", "properties": properties}
    if revision is not None:
        table["schema_revision"] = revision
    if source is not None:
        table["schema_source"] = source
    return table


def test_stale_schema_write_is_rejected():
    current = _table(
        [{"id": "title", "name": "Title", "type": "title"}],
        revision=3,
    )
    stale = _table(
        [
            {"id": "title", "name": "Title", "type": "title"},
            {"id": "legacy", "name": "Legacy", "type": "text"},
        ],
        revision=2,
    )

    with pytest.raises(HTTPException) as exc:
        _reconcile_table_schema_revision(current, stale)

    assert exc.value.status_code == 409
    assert stale["schema_revision"] == 2


def test_matching_schema_revision_can_advance():
    source = {
        "provider": "notion",
        "database_id": "notion-db",
        "mode": "exact_clone",
    }
    current = _table(
        [{"id": "title", "name": "Title", "type": "title"}],
        revision=3,
        source=source,
    )
    incoming = _table(
        [
            {"id": "title", "name": "Title", "type": "title"},
            {"id": "status", "name": "Status", "type": "select"},
        ],
        revision=3,
    )

    _reconcile_table_schema_revision(current, incoming)

    assert incoming["schema_revision"] == 4
    assert incoming["schema_source"] == source


def test_legacy_non_schema_save_preserves_current_revision():
    properties = [{"id": "title", "name": "Title", "type": "title"}]
    current = _table(properties, revision=5)
    incoming = _table(properties)
    incoming["name"] = "Renamed notes"

    _reconcile_table_schema_revision(current, incoming)

    assert incoming["schema_revision"] == 5
