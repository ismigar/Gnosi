"""Isolated contracts for system-date complexity refactors; synthetic data only."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from copy import deepcopy
from datetime import date
from pathlib import Path
from types import ModuleType

import pytest


def test_system_date_structure_in_isolated_subprocess(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep real settings and parent-suite backend imports outside child checks."""
    monkeypatch.delenv("GNOSI_VALIDATION_ROOT", raising=False)
    if "backend.config.paths_config" not in sys.modules:
        monkeypatch.setitem(
            sys.modules, "backend.config.paths_config", ModuleType("backend.config.paths_config")
        )
    with tempfile.TemporaryDirectory(prefix="gnosi-system-date-structure-") as temporary:
        root = Path(temporary).resolve()
        for directory in ("data", "vault", "host"):
            (root / directory).mkdir()
        environment = {
            "PATH": os.defpath,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
            "GNOSI_VALIDATION_ROOT": str(root),
            "GNOSI_DATA_DIR": str(root / "data"),
            "DIGITAL_BRAIN_VAULT_PATH": str(root / "vault"),
            "VAULT_HOST_PATH": str(root / "vault"),
            "HOME_HOST_PATH": str(root / "host"),
            "GNOSI_SHARED_ENV_FILE": str(root / "disabled.env"),
            "GNOSI_DISABLE_SCHEDULER": "1",
            "GNOSI_FILES_PROVIDER": "local",
            "GNOSI_RUN_LIVE_E2E": "0",
        }
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
             "--basetemp", str(root / "pytest"), "-o", "python_functions=check_*",
             "pipeline/tests/test_system_date_structure.py"],
            cwd=Path(__file__).resolve().parents[2], env=environment,
            capture_output=True, text=True, timeout=180, check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr


@pytest.fixture
def isolated_runtime() -> None:
    from backend.config.validation_runtime import validation_runtime_enabled

    assert validation_runtime_enabled()


@pytest.mark.parametrize("container", [None, [], "old", {7: "old", "groupBy": "old"}])
@pytest.mark.usefixtures("isolated_runtime")
def check_view_nonrecords_are_untouched(container: object) -> None:
    from pipeline.scripts.migrate_table_system_dates import _replace_view_field_refs

    before = deepcopy(container)
    assert _replace_view_field_refs(container, {"old": "new"}) is False
    assert container == before


@pytest.mark.parametrize("key", ["visibleProperties", "visible_properties", "columns"])
@pytest.mark.usefixtures("isolated_runtime")
def check_view_list_identity_and_first_matching_field(key: str) -> None:
    from pipeline.scripts.migrate_table_system_dates import _replace_view_field_refs

    item = {"field": "old", "fieldKey": "old", "key": "old", "value": "old"}
    fallback = {"field": "unmapped", "fieldKey": "old", "key": "old"}
    last = {"field": None, "key": "old"}
    opaque: dict[object, object] = {7: "opaque", "field": "old"}
    values: list[object] = [item, fallback, last, opaque, None]
    view: dict[str, object] = {key: values}
    assert _replace_view_field_refs(view, {"old": "new"}) is False
    assert view[key] is values and values[0] is item
    assert item == {"field": "new", "fieldKey": "old", "key": "old", "value": "old"}
    assert fallback == {"field": "unmapped", "fieldKey": "new", "key": "old"}
    assert last == {"field": None, "key": "new"}
    assert opaque == {7: "opaque", "field": "old"}
    values.append("old")
    assert _replace_view_field_refs(view, {"old": "new"}) is True
    assert view[key] is not values and values[-1] == "old"
    updated = view[key]
    assert isinstance(updated, list) and updated[0] is item and updated[-1] == "new"


@pytest.mark.parametrize("key", ["filterTree", "rules", "conditions", "children", "groups"])
@pytest.mark.parametrize("as_list", [False, True])
@pytest.mark.usefixtures("isolated_runtime")
def check_view_recursion_and_opaque_payloads(key: str, as_list: bool) -> None:
    from pipeline.scripts.migrate_table_system_dates import _replace_view_field_refs

    opaque: dict[object, object] = {7: "opaque", "groupBy": "old"}
    payload = {"groupBy": "old", "sort": {"field": "old"}}
    leaf: dict[str, object] = {"groupBy": "old", "filters": [{"field": "old", "value": payload}]}
    nested: dict[str, object] = {"children": [leaf, opaque]}
    view: dict[str, object] = {
        key: [None, "old", nested] if as_list else nested,
        "config": payload, "field": "old", "value": payload,
    }
    assert _replace_view_field_refs(view, {"old": "new"}) is True
    assert leaf == {"groupBy": "new", "filters": [{"field": "new", "value": payload}]}
    assert view["config"] is payload and view["value"] is payload
    assert payload == {"groupBy": "old", "sort": {"field": "old"}}
    assert opaque == {7: "opaque", "groupBy": "old"} and view["field"] == "old"
    assert _replace_view_field_refs(view, {"old": "new"}) is False


@pytest.mark.parametrize("key", ["groupBy", "dateField", "coverField", "groupSort"])
@pytest.mark.usefixtures("isolated_runtime")
def check_view_scalar_identity_replacement_still_reports_change(key: str) -> None:
    from pipeline.scripts.migrate_table_system_dates import _replace_view_field_refs

    view: dict[str, object] = {key: "old"}
    assert _replace_view_field_refs(view, {"old": "old"}) is True
    view[key] = {"field": "old"}
    assert _replace_view_field_refs(view, {"old": "new"}) is False


@pytest.mark.parametrize("key", ["sort", "sorts", "filters"])
@pytest.mark.parametrize("as_list", [False, True])
@pytest.mark.usefixtures("isolated_runtime")
def check_view_sort_shapes_and_literals(key: str, as_list: bool) -> None:
    from pipeline.scripts.migrate_table_system_dates import _replace_view_field_refs

    item = {"field": "old", "fieldKey": "old", "value": "old"}
    opaque: dict[object, object] = {7: "old", "field": "old"}
    values: object = [None, "old", item, opaque] if as_list else item
    view: dict[str, object] = {key: values}
    expected = as_list or key == "sort"
    assert _replace_view_field_refs(view, {"old": "new"}) is expected
    assert view[key] is values
    assert item == {"field": "new" if expected else "old", "fieldKey": "old", "value": "old"}
    assert opaque == {7: "old", "field": "old"}


@pytest.mark.parametrize("key", ["columnWidths", "aggregations"])
@pytest.mark.usefixtures("isolated_runtime")
def check_view_mapping_collisions_and_insertion_order(key: str) -> None:
    from pipeline.scripts.migrate_table_system_dates import _replace_view_field_refs

    marker: dict[str, object] = {"field": "old"}
    values: dict[str, object] = {"old": marker, "new": "overwritten", "tail": 3}
    view: dict[str, object] = {key: values}
    assert _replace_view_field_refs(view, {"old": "new", "new": "final"}) is True
    assert view[key] is values and values == {"tail": 3, "final": marker}
    assert list(values) == ["tail", "final"] and values["final"] is marker
    same: dict[str, object] = {"old": 1, "tail": 2}
    assert _replace_view_field_refs({key: same}, {"old": "old"}) is True
    assert list(same) == ["tail", "old"]


@pytest.mark.usefixtures("isolated_runtime")
def check_view_shared_objects_follow_existing_phase_order() -> None:
    from pipeline.scripts.migrate_table_system_dates import _replace_view_field_refs

    shared = {"field": "old"}
    columns = [shared]
    view: dict[str, object] = {
        "columns": columns, "sort": shared, "sorts": [shared], "filters": [shared],
        "children": [{"sort": shared}],
    }
    assert _replace_view_field_refs(view, {
        "old": "one", "one": "two", "two": "three", "three": "four", "four": "five",
    }) is True
    assert shared == {"field": "five"} and view["columns"] is columns


@pytest.mark.usefixtures("isolated_runtime")
def check_view_recursive_callback_remains_late_bound(monkeypatch: pytest.MonkeyPatch) -> None:
    from pipeline.scripts import migrate_table_system_dates as migration

    original = migration._replace_view_field_refs
    children: list[object] = [None, {"groupBy": "old"}]
    calls: list[object] = []

    def callback(container: object, replacements: dict[str, str]) -> bool:
        calls.append(container)
        return original(container, replacements)

    monkeypatch.setattr(migration, "_replace_view_field_refs", callback)
    assert original({"groupBy": "old", "children": children}, {"old": "new"}) is True
    assert len(calls) == 2 and calls[0] is None and calls[1] is children[1]


@pytest.mark.parametrize("dry_run", [False, True])
@pytest.mark.usefixtures("isolated_runtime")
def check_page_exact_bytes_backups_and_idempotence(tmp_path: Path, dry_run: bool) -> None:
    from pipeline.scripts import migrate_table_system_dates as migration

    page = tmp_path / "row.md"
    backup = tmp_path / "backup"
    raw = (
        "---\nid: ' row '\n7: [One, Two]\ntrue: opaque\n2020-01-02: {nested: value}\n"
        "created_at: 2019-01-01\ncreated_by: Owner\nlast_edited_at: 2023-01-01\n"
        "last_edited_by: Editor\nCreation date: canonical-created\nLast modified: canonical-modified\n"
        "Date Added: 2021-01-01\nlegacy-created: alias-created\ncreated-id: id-created\n"
        "Modified: legacy-modified\n---\nBody **unchanged** — à\n\n"
    ).encode()
    page.write_bytes(raw)
    aliases: list[object] = ["legacy-created", 7, None, "created_at"]
    table: dict[str, object] = {"properties": [
        {"system_date_role": "created", "name": "Date Added", "aliases": aliases,
         "id": "created-id", "config": {7: "opaque"}},
        {"system_date_role": "modified", "name": "Modified"},
        {"system_date_role": ["created"], "aliases": "untouched"},
    ]}
    original = deepcopy(table)
    assert migration._migrate_page(
        page, table, "en", dry_run, vault=tmp_path, backup_root=backup,
    ) == ("migrated", False, "row")
    assert table == original
    if dry_run:
        assert page.read_bytes() == raw and not backup.exists()
        return
    expected = (
        "---\nid: ' row '\n7:\n- One\n- Two\ntrue: opaque\n2020-01-02:\n  nested: value\n"
        "created_at: 2019-01-01\ncreated_by: Owner\nlast_edited_at: 2023-01-01\n"
        "last_edited_by: Editor\nCreation date: 2021-01-01\nLast modified: legacy-modified\n"
        "---\nBody **unchanged** — à\n\n"
    ).encode()
    assert page.read_bytes() == expected
    assert (backup / "row.md").read_bytes() == raw
    assert migration._migrate_page(
        page, table, "en", False, vault=tmp_path, backup_root=backup,
    ) == ("clean", False, "row")
    assert page.read_bytes() == expected and (backup / "row.md").read_bytes() == raw
    metadata, _ = migration._parse_frontmatter(page.read_text())
    assert metadata[date(2020, 1, 2)] == {"nested": "value"}


@pytest.mark.parametrize("notion_dates", [None, {}, {"created": ""}, {"created": "source"}])
@pytest.mark.usefixtures("isolated_runtime")
def check_page_authority_and_stat_fallback_callbacks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, notion_dates: dict[str, str] | None,
) -> None:
    from pipeline.scripts import migrate_table_system_dates as migration

    page = tmp_path / "row.md"
    page.write_text("---\nid: row\nDate Added: []\nCreation date: ''\n---\nBody\n")
    events: list[object] = []

    def stat(path: Path, *, creation: bool) -> str:
        assert path == page
        events.append(("stat", creation))
        return "stat-created" if creation else "stat-modified"

    def render(metadata: dict[object, object], body: str) -> str:
        events.append(("render", dict(metadata), body))
        return "rendered bytes\n"

    def write(path: Path, text: str) -> None:
        assert path == page
        events.append(("write", text))

    monkeypatch.setattr(migration, "_iso_from_stat", stat)
    monkeypatch.setattr(migration, "_render_frontmatter", render)
    monkeypatch.setattr(migration, "safe_write_text", write)
    result = migration._migrate_page(
        page, {}, "en", False,
        notion_dates_by_page={"row": notion_dates} if notion_dates is not None else None,
    )
    assert result == ("migrated", notion_dates is not None, "row")
    authoritative = bool(notion_dates and notion_dates.get("created"))
    stat_events: list[object] = [("stat", False)] if authoritative else [
        ("stat", True), ("stat", False),
    ]
    assert events == stat_events + [
        ("render", {"id": "row", "Creation date": "source" if authoritative else "stat-created",
                    "Last modified": "stat-modified"}, "Body\n"),
        ("write", "rendered bytes\n"),
    ]


@pytest.mark.parametrize("notion_dates", [None, {}, {"created": "existing"}])
@pytest.mark.usefixtures("isolated_runtime")
def check_page_clean_notion_match_skips_all_writes(
    tmp_path: Path, notion_dates: dict[str, str] | None,
) -> None:
    from pipeline.scripts.migrate_table_system_dates import _migrate_page

    page = tmp_path / "row.md"
    raw = b"---\nid: row\nCreation date: existing\nLast modified: existing\n---\nBody\n"
    page.write_bytes(raw)
    backup = tmp_path / "backup"
    assert _migrate_page(
        page, {}, "en", False, vault=tmp_path, backup_root=backup,
        notion_dates_by_page={"row": notion_dates} if notion_dates is not None else None,
    ) == ("clean", notion_dates is not None, "row")
    assert page.read_bytes() == raw and not backup.exists()


@pytest.mark.parametrize("content", [None, b"\xff", b"Body\n", b"---\n[]\n---\nBody\n",
                                     b"---\nx: [broken\n---\nBody\n"])
@pytest.mark.usefixtures("isolated_runtime")
def check_page_read_and_frontmatter_failures_return_before_validation(
    tmp_path: Path, content: bytes | None,
) -> None:
    from pipeline.scripts.migrate_table_system_dates import _migrate_page

    page = tmp_path / "row.md"
    if content is not None:
        page.write_bytes(content)
    result = _migrate_page(page, {"properties": "invalid"}, "en", False)
    expected = "error:read" if content in (None, b"\xff") else "skipped:no-frontmatter"
    assert result == (expected, False, "")


@pytest.mark.parametrize(("properties", "message"), [
    ("invalid", "Table properties must be a list"),
    ([None], "Table properties must be an object with text keys"),
    ([{7: "opaque"}], "Table properties must be an object with text keys"),
    ([{"system_date_role": "created", "aliases": "invalid"}], "Property aliases must be a list"),
])
@pytest.mark.usefixtures("isolated_runtime")
def check_page_validation_errors_precede_backup_and_write(
    tmp_path: Path, properties: object, message: str,
) -> None:
    from pipeline.scripts.migrate_table_system_dates import _migrate_page

    page = tmp_path / "row.md"
    raw = b"---\nid: row\n---\nBody\n"
    page.write_bytes(raw)
    backup = tmp_path / "backup"
    for dry_run in (True, False):
        with pytest.raises(ValueError) as error:
            _migrate_page(page, {"properties": properties}, "en", dry_run,
                          vault=tmp_path, backup_root=backup)
        assert str(error.value) == message
        assert page.read_bytes() == raw and not backup.exists()


@pytest.mark.parametrize("failure", ["stat", "copy", "render", "write"])
@pytest.mark.usefixtures("isolated_runtime")
def check_page_io_error_identity_and_backup_order(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: str,
) -> None:
    from pipeline.scripts import migrate_table_system_dates as migration

    page = tmp_path / "row.md"
    raw = b"---\nid: row\n---\nBody\n"
    page.write_bytes(raw)
    backup = tmp_path / "backup"
    events: list[str] = []
    failure_error = OSError("synthetic failure")
    original_copy = shutil.copy2

    def visit(stage: str) -> None:
        events.append(stage)
        if failure == stage:
            raise failure_error

    def stat(path: Path, *, creation: bool) -> str:
        visit("stat")
        return "synthetic-stat"

    def copy(source: Path, destination: Path) -> None:
        visit("copy")
        original_copy(source, destination)

    def render(metadata: dict[object, object], body: str) -> str:
        visit("render")
        return "synthetic rendered bytes"

    def write(path: Path, text: str) -> None:
        visit("write")

    monkeypatch.setattr(migration, "_iso_from_stat", stat)
    monkeypatch.setattr(shutil, "copy2", copy)
    monkeypatch.setattr(migration, "_render_frontmatter", render)
    monkeypatch.setattr(migration, "safe_write_text", write)
    with pytest.raises(OSError) as error:
        migration._migrate_page(page, {}, "en", False, vault=tmp_path, backup_root=backup)
    assert error.value is failure_error and page.read_bytes() == raw
    order = ["stat", "stat", "copy", "render", "write"]
    assert events == order[:order.index(failure) + 1]
    if failure in ("render", "write"):
        assert (backup / "row.md").read_bytes() == raw
    else:
        assert not (backup / "row.md").exists()


@pytest.mark.usefixtures("isolated_runtime")
def check_page_outside_backup_vault_retains_relative_path_error(tmp_path: Path) -> None:
    from pipeline.scripts.migrate_table_system_dates import _migrate_page

    page = tmp_path / "row.md"
    raw = b"---\nid: row\nDate Added: created\nModified: modified\n---\nBody\n"
    page.write_bytes(raw)
    backup = tmp_path / "backup"
    assert _migrate_page(
        page, {}, "en", True, vault=tmp_path / "elsewhere", backup_root=backup,
    ) == ("migrated", False, "row")
    with pytest.raises(ValueError, match="is not in the subpath"):
        _migrate_page(page, {}, "en", False, vault=tmp_path / "elsewhere", backup_root=backup)
    assert page.read_bytes() == raw and not backup.exists()
