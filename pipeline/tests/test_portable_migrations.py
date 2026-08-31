"""Synthetic migration contracts; no application startup or operational data.

Only the subprocess wrapper is collected in the parent suite. The child selects
the portable checks and existing backend consumers after configuring isolation,
regardless of which backend modules the parent suite has already imported.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from collections.abc import Iterator, Mapping
from copy import deepcopy
from datetime import date, datetime, timezone
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session


def test_portable_migrations_in_isolated_subprocess(monkeypatch: pytest.MonkeyPatch) -> None:
    """Run without inheriting credentials, data selectors or imported services."""
    # Exercise the global-suite case without importing backend configuration:
    # a parent may already have cached it and may have no validation selector.
    monkeypatch.delenv("GNOSI_VALIDATION_ROOT", raising=False)
    if "backend.config.paths_config" not in sys.modules:
        monkeypatch.setitem(
            sys.modules, "backend.config.paths_config", ModuleType("backend.config.paths_config")
        )
    with tempfile.TemporaryDirectory(prefix="gnosi-portable-migrations-") as temporary:
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
            [
                sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
                "-o", "python_functions=test_* check_*",
                "-k", "not test_portable_migrations_in_isolated_subprocess",
                "pipeline/tests/test_portable_migrations.py",
                "backend/tests/test_migrate_table_system_dates.py",
                "backend/tests/test_set_user_password_script.py",
            ],
            cwd=Path(__file__).resolve().parents[2], env=environment,
            capture_output=True, text=True, timeout=180, check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr


@pytest.fixture
def isolated_runtime() -> None:
    """Required by every portable child check, never by the parent wrapper."""
    from backend.config.validation_runtime import validation_runtime_enabled

    assert validation_runtime_enabled()


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _json_object(path: Path) -> dict[str, object]:
    value: object = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    assert all(isinstance(key, str) for key in value)
    return dict(value)


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ("Body only\n", {}),
        ("---\n[one, two]\n---\nBody\n", {}),
        ("---\nname: [broken\n---\nBody\n", {}),
        ("---\nid: row\ncreated: 2024-01-02\n---\nBody\n",
         {"id": "row", "created": date(2024, 1, 2)}),
    ],
)
@pytest.mark.usefixtures("isolated_runtime")
def check_option_frontmatter_keeps_yaml_types(
    tmp_path: Path, content: str, expected: dict[str, object]
) -> None:
    from pipeline.scripts.migrate_option_catalogs import read_frontmatter

    page = tmp_path / "row.md"
    _write(page, content)
    assert read_frontmatter(page) == expected
    assert read_frontmatter(tmp_path / "missing.md") == {}


@pytest.mark.parametrize("existing", ["name", "id", "legacy", "none"])
@pytest.mark.usefixtures("isolated_runtime")
def check_option_folder_fallbacks(tmp_path: Path, existing: str) -> None:
    from pipeline.scripts.migrate_option_catalogs import resolve_table_folder

    table: dict[str, object] = {"database_id": "db-id", "folder": "Rows"}
    registry: dict[str, object] = {"databases": [{"id": "db-id", "name": "Library"}]}
    candidates = {
        "name": tmp_path / "BD" / "Library" / "Rows",
        "id": tmp_path / "BD" / "db-id" / "Rows",
        "legacy": tmp_path / "Rows",
    }
    if existing != "none":
        candidates[existing].mkdir(parents=True)
    assert resolve_table_folder(table, registry, tmp_path) == candidates.get(
        existing, candidates["name"]
    )
    candidates["name"].mkdir(parents=True, exist_ok=True)
    assert resolve_table_folder(table, registry, tmp_path) == candidates["name"]


@pytest.mark.usefixtures("isolated_runtime")
def check_option_merge_counts_precedence_frequency_and_shared_catalogs(tmp_path: Path) -> None:
    from backend.services.option_catalogs import get_prop_options
    from pipeline.scripts.migrate_option_catalogs import (
        collect_field_values,
        merge_values_into_catalogs,
    )

    folder = tmp_path / "BD" / "Library" / "Rows"
    pages = {
        "a.md": "---\nfld: [Known, New, New]\nTags: [ignored]\n---\nA\n",
        "b.md": "---\nfld: []\nTags: 'Other, New'\n---\nB\n",
        "c.md": "---\nOld tags: ['Other', 12, ' ']\n---\nC\n",
    }
    for name, raw in pages.items():
        _write(folder / name, raw)
    _write(folder / "nested" / "ignored.md", "---\nfld: Nested\n---\nNested\n")
    prop: dict[str, object] = {
        "id": "fld", "name": "Tags", "aliases": ["Old tags"],
        "type": "multi_select", "config": {"options": ["Known"]},
    }
    shared: dict[str, object] = {
        "id": "shared", "name": "Tags", "type": "multi_select",
        "config": {"catalog_ref": "global", "options": []},
    }
    table: dict[str, object] = {
        "database_id": "db", "folder": "Rows", "properties": [prop, shared],
    }
    registry: dict[str, object] = {"databases": [{"id": "db", "name": "Library"}]}
    assert collect_field_values(folder, prop) == {"Known": 1, "New": 3, "Other": 2, "12": 1}
    assert collect_field_values(tmp_path / "missing", prop) == {}
    assert merge_values_into_catalogs(table, registry, tmp_path) == [
        ("Tags", ["New", "Other", "12"]),
    ]
    assert [option["name"] for option in get_prop_options(prop)] == ["Known", "New", "Other", "12"]
    assert get_prop_options(shared) == []
    assert merge_values_into_catalogs(table, registry, tmp_path) == []
    assert {name: (folder / name).read_text() for name in pages} == pages


@pytest.mark.usefixtures("isolated_runtime")
def check_option_cli_dry_run_backup_and_idempotence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pipeline.scripts import migrate_option_catalogs as migration

    registry = tmp_path / "BD" / "vault_db_registry.json"
    raw = json.dumps({"databases": [], "tables": [{
        "id": "table", "name": "Rows", "folder": "Rows",
        "properties": [{"id": "tags", "name": "Tags", "type": "multi_select"}],
    }]})
    _write(registry, raw)
    _write(tmp_path / "Rows" / "one.md", "---\nTags: [One, Two]\n---\nBody\n")
    monkeypatch.setattr(sys, "argv", ["migration", "--registry", str(registry)])
    assert migration.main() == 0
    assert registry.read_text() == raw
    assert list(registry.parent.glob("*.backup-*.json")) == []
    monkeypatch.setattr(sys, "argv", ["migration", "--registry", str(registry), "--apply"])
    assert migration.main() == 0
    backups = list(registry.parent.glob("*.backup-*.json"))
    assert len(backups) == 1
    assert backups[0].read_text() == raw
    migrated = registry.read_bytes()
    assert migration.main() == 0
    assert registry.read_bytes() == migrated
    assert list(registry.parent.glob("*.backup-*.json")) == backups


@pytest.mark.usefixtures("isolated_runtime")
def check_sidecar_migration_preserves_public_metadata_and_is_idempotent(tmp_path: Path) -> None:
    from pipeline.scripts import migrate_sidecar_metadata as migration

    (tmp_path / ".gnosi").mkdir()
    page = tmp_path / "Rows" / "row.md"
    original = (
        "---\nid: row\nis_template: false\ncover_manual: true\n"
        "created: 2024-01-02\nTags: [One, Two]\n---\n\nBody\n"
    )
    _write(page, original)
    sidecar = tmp_path / ".gnosi" / "page_meta" / "row.json"
    assert migration.find_vault_root(page.parent) == tmp_path.resolve()
    assert migration.migrate_file(page, tmp_path, True) == "migrated"
    assert page.read_text() == original
    assert not sidecar.exists()
    assert migration.migrate_file(page, tmp_path, False) == "migrated"
    assert _json_object(sidecar) == {"is_template": False, "cover_manual": True}
    metadata, body = migration.parse_frontmatter_raw(page.read_text())
    assert metadata == {"id": "row", "created": date(2024, 1, 2), "Tags": ["One", "Two"]}
    assert body.lstrip() == "Body\n"
    migrated = page.read_bytes()
    assert migration.migrate_file(page, tmp_path, False) == "clean"
    assert page.read_bytes() == migrated


@pytest.mark.parametrize(
    ("raw", "status"),
    [
        ("Body only", "no-frontmatter"),
        ("---\n[one, two]\n---\nBody", "no-frontmatter"),
        ("---\nid: [broken\n---\nBody", "no-frontmatter"),
        ("---\nis_template: true\n---\nBody", "no-id"),
        ("---\nid: row\nTitle: Clean\n---\nBody", "clean"),
    ],
)
@pytest.mark.usefixtures("isolated_runtime")
def check_sidecar_non_migratable_files_are_unchanged(tmp_path: Path, raw: str, status: str) -> None:
    from pipeline.scripts.migrate_sidecar_metadata import migrate_file

    page = tmp_path / "row.md"
    _write(page, raw)
    assert migrate_file(page, tmp_path, False) == status
    assert page.read_text() == raw
    assert list(tmp_path.rglob("*.json")) == []
    assert migrate_file(tmp_path / "missing.md", tmp_path, False).startswith("error:read:")


@pytest.mark.usefixtures("isolated_runtime")
def check_sidecar_failures_keep_frontmatter_for_retry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pipeline.scripts import migrate_sidecar_metadata as migration

    page = tmp_path / "row.md"
    original = "---\nid: row\nis_template: true\n---\nBody\n"
    _write(page, original)

    def fail_sidecar(vault: Path, page_id: str, metadata: dict[str, object]) -> None:
        raise RuntimeError("synthetic sidecar failure")

    def fail_write(path: Path, content: str) -> None:
        raise OSError("synthetic page failure")

    with monkeypatch.context() as patch:
        patch.setattr(migration, "write_sidecar", fail_sidecar)
        assert migration.migrate_file(page, tmp_path, False) == "error:sidecar:synthetic sidecar failure"
    assert page.read_text() == original
    with monkeypatch.context() as patch:
        patch.setattr(migration, "safe_write_text", fail_write)
        assert migration.migrate_file(page, tmp_path, False) == "error:write:synthetic page failure"
    assert page.read_text() == original
    assert migration.migrate_file(page, tmp_path, False) == "migrated"


@pytest.mark.usefixtures("isolated_runtime")
def check_sidecar_cli_skips_internal_directories(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from pipeline.scripts import migrate_sidecar_metadata as migration

    raw = "---\nid: row\nis_template: true\n---\nBody\n"
    for folder in (".gnosi", ".trash", "local_data", ".hidden", "Rows"):
        _write(tmp_path / folder / "row.md", raw)
    assert list(migration.iter_markdown_files(tmp_path)) == [tmp_path / "Rows" / "row.md"]
    monkeypatch.setattr(sys, "argv", ["migration", "--vault", str(tmp_path), "--dry-run"])
    assert migration.main() == 0
    output = capsys.readouterr().out
    assert "DRY-RUN" in output and "migrated: 1" in output
    assert not (tmp_path / ".gnosi" / "page_meta").exists()


class _TimestampClient:
    def __init__(self, rows: list[dict[str, object]], fail: bool = False) -> None:
        self.rows = rows
        self.fail = fail
        self.queried: list[str] = []

    def query_database(self, database_id: str) -> Iterator[Mapping[str, object]]:
        self.queried.append(database_id)
        yield from self.rows
        if self.fail:
            raise RuntimeError("synthetic pagination failure")


@pytest.mark.usefixtures("isolated_runtime")
def check_notion_index_preserves_generator_errors_and_counts() -> None:
    from backend.services.notion_clone import clone_page_id, clone_table_id
    from pipeline.scripts.migrate_table_system_dates import build_notion_timestamp_index

    rows: list[dict[str, object]] = [
        {"id": "   "},
        {"id": " page-one ", "created_time": " 2024-01-02 ", "last_edited_time": "2024-03-04"},
        {"id": "page-two", "created_time": None},
    ]
    client = _TimestampClient(rows)
    config: dict[str, object] = {"databases": [None, {}, {"id": " database-one "}]}
    index, report = build_notion_timestamp_index(client, config)
    assert client.queried == ["database-one"]
    assert index[clone_table_id("database-one")][clone_page_id("page-one")] == {
        "created": "2024-01-02", "modified": "2024-03-04",
    }
    assert report == {"notion_databases": 1, "notion_source_rows": 2, "notion_rows_without_dates": 1}
    with pytest.raises(RuntimeError, match="synthetic pagination failure"):
        build_notion_timestamp_index(_TimestampClient(rows, fail=True), config)


@pytest.mark.parametrize("databases", [None, [], {}, "invalid"])
@pytest.mark.usefixtures("isolated_runtime")
def check_notion_index_rejects_missing_database_configuration(databases: object) -> None:
    from pipeline.scripts.migrate_table_system_dates import build_notion_timestamp_index

    client = _TimestampClient([])
    with pytest.raises(RuntimeError, match="has no databases"):
        build_notion_timestamp_index(client, {"databases": databases})
    assert client.queried == []


def _date_registry() -> dict[str, object]:
    return {
        "databases": [{"id": "db", "folder": "BD/Library"}],
        "tables": [{
            "id": "table", "database_id": "db", "folder": "Rows",
            "properties": [
                {"id": "created", "name": "Date Added", "type": "created_time"},
                {"id": "modified", "name": "Last edited", "type": "last_edited_time"},
            ],
        }],
        "views": [{
            "table_id": "table", "visibleProperties": ["Date Added", "Title"],
            "sort": {"field": "Last edited", "direction": "desc"},
            "filters": [{"field": "Date Added", "value": "Date Added"}],
        }],
    }


@pytest.mark.usefixtures("isolated_runtime")
def check_date_registry_preserves_input_and_filter_literals() -> None:
    from pipeline.scripts.migrate_table_system_dates import migrate_registry

    registry = _date_registry()
    original = deepcopy(registry)
    migrated, report = migrate_registry(registry, "ca")
    assert registry == original
    assert report == {"tables": 1, "properties_removed": 0, "views_updated": 1}
    assert migrated["views"] == [{
        "table_id": "table", "visibleProperties": ["Data de creació", "Title"],
        "sort": {"field": "Última modificació", "direction": "desc"},
        "filters": [{"field": "Data de creació", "value": "Date Added"}],
    }]
    again, second_report = migrate_registry(migrated, "ca")
    assert again == migrated
    assert second_report == {"tables": 0, "properties_removed": 0, "views_updated": 0}


@pytest.mark.usefixtures("isolated_runtime")
def check_date_migration_preserves_yaml_dates_and_exact_backups(tmp_path: Path) -> None:
    from pipeline.scripts import migrate_table_system_dates as migration

    vault = tmp_path / "vault"
    registry = vault / "BD" / "vault_db_registry.json"
    raw_registry = json.dumps(_date_registry())
    _write(registry, raw_registry)
    page = vault / "BD" / "Library" / "Rows" / "one.md"
    raw_page = (
        "---\nid: one\nDate Added: 2020-01-02\n"
        "Last edited: 2024-03-04T05:06:07Z\ncreated_at: 2019-01-01\n---\nBody\n"
    )
    _write(page, raw_page)
    hidden = page.parent / ".history" / "hidden.md"
    _write(hidden, raw_page)
    unrelated = vault / "Elsewhere" / "other.md"
    _write(unrelated, raw_page)
    backup = tmp_path / "backup"
    dry = migration.run_migration(vault, "ca", True, backup_root=backup)
    assert dry["pages"] == 1 and dry["backup_files"] == 0
    assert "backup_root" not in dry
    assert not backup.exists()
    assert page.read_text() == raw_page and registry.read_text() == raw_registry
    result = migration.run_migration(vault, "ca", False, backup_root=backup)
    assert result["pages"] == 1 and result["backup_files"] == 2
    assert result["page_errors"] == 0 and result["registry_backup"] == 1
    assert result["backup_root"] == str(backup)
    sibling_backup = result["registry_backup_path"]
    assert isinstance(sibling_backup, str)
    assert Path(sibling_backup).read_text() == raw_registry
    assert (backup / registry.relative_to(vault)).read_text() == raw_registry
    assert (backup / page.relative_to(vault)).read_text() == raw_page
    metadata, body = migration._parse_frontmatter(page.read_text())
    assert metadata == {
        "id": "one", "Data de creació": date(2020, 1, 2),
        "Última modificació": datetime(2024, 3, 4, 5, 6, 7, tzinfo=timezone.utc),
        "created_at": date(2019, 1, 1),
    }
    assert body == "Body\n"
    assert hidden.read_text() == raw_page and unrelated.read_text() == raw_page
    migrated_bytes = page.read_bytes(), registry.read_bytes()
    again = migration.run_migration(vault, "ca", False)
    assert again["pages"] == 0 and again["registry_backup"] == 0
    assert (page.read_bytes(), registry.read_bytes()) == migrated_bytes


@pytest.mark.usefixtures("isolated_runtime")
def check_date_cli_dry_run_and_notion_match_report(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from pipeline.scripts import migrate_table_system_dates as migration

    registry = tmp_path / "BD" / "vault_db_registry.json"
    _write(registry, json.dumps(_date_registry()))
    rows = tmp_path / "BD" / "Library" / "Rows"
    _write(rows / "one.md", "---\nid: one\n---\nBody\n")
    _write(rows / "two.md", "---\nid: two\n---\nBody\n")
    (rows / "unreadable.md").write_bytes(b"\xff")
    index: migration.NotionTimestampIndex = {"table": {
        "one": {"created": "2020-01-01", "modified": "2024-01-01"},
        "absent": {"created": "2020-01-01", "modified": "2024-01-01"},
    }}
    report = migration.run_migration(tmp_path, "en", True, notion_index=index)
    assert report["notion_local_matches"] == 1
    assert report["notion_local_unmatched"] == 1
    assert report["notion_source_unmatched"] == 1
    assert report["page_errors"] == 1
    monkeypatch.setattr(sys, "argv", [
        "migration", "--vault", str(tmp_path), "--locale", "en", "--dry-run",
        "--backup-dir", str(tmp_path / "backups"),
    ])
    assert migration.main() == 1
    output: object = json.loads(capsys.readouterr().out)
    assert isinstance(output, dict) and output["page_errors"] == 1
    assert not (tmp_path / "backups").exists()


@pytest.fixture
def account_db() -> Iterator[Session]:
    from backend.data.management_db import Base
    from backend.models.management import Membership, User, Workspace

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            db.add(User(
                id="synthetic-owner", email="user@example.com", name="Owner",
                password_hash=None, auto_provisioned=True,
            ))
            db.add(Workspace(id="synthetic-workspace", name="Synthetic"))
            db.add(Membership(
                user_id="synthetic-owner", workspace_id="synthetic-workspace", role="owner",
            ))
            db.commit()
            yield db
    finally:
        engine.dispose()


@pytest.mark.usefixtures("isolated_runtime")
def check_password_listing_and_cli_leave_accounts_unchanged(
    account_db: Session, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from backend.models.management import User
    from pipeline.scripts import set_user_password as migration

    def fake_db() -> Iterator[Session]:
        yield account_db

    monkeypatch.setattr(migration, "get_mgmt_db", fake_db)
    monkeypatch.setattr(sys, "argv", ["set-password", "--list"])
    assert migration.main() == 0
    output = capsys.readouterr().out
    assert "WITHOUT password" in output and "synthetic-workspace:owner" in output
    user = account_db.query(User).one()
    assert user.password_hash is None and user.email == "user@example.com"


@pytest.mark.usefixtures("isolated_runtime")
def check_password_commit_failure_rolls_back_all_account_fields(
    account_db: Session, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from backend.models.management import User
    from backend.services import auth_service
    from pipeline.scripts import set_user_password as migration

    def password() -> str:
        return "synthetic-password"

    def fail_commit() -> None:
        raise RuntimeError("synthetic commit failure")

    monkeypatch.setattr(auth_service, "BCRYPT_ROUNDS", 4)
    monkeypatch.setattr(migration, "_read_password", password)
    monkeypatch.setattr(account_db, "commit", fail_commit)
    assert migration.set_password(
        account_db, "synthetic-owner", "new@example.org", "New name", False, True,
    ) == 1
    user = account_db.query(User).one()
    assert user.email == "user@example.com" and user.name == "Owner"
    assert user.password_hash is None and user.auto_provisioned is True
    output = capsys.readouterr()
    assert "synthetic commit failure" in output.err
    assert "synthetic-password" not in output.out + output.err


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {"tables": "invalid"},
        {"databases": [None], "tables": []},
        {"tables": [{"properties": [{"type": "select", "aliases": "invalid"}]}]},
        {"tables": [{"properties": [{"type": "select", "config": [], "options": ["One"]}]}]},
        {"tables": [{"properties": [{"type": "select", "id": ["unhashable"]}]}]},
    ],
)
@pytest.mark.usefixtures("isolated_runtime")
def check_invalid_option_registry_never_writes(tmp_path: Path, payload: object) -> None:
    from pipeline.scripts.migrate_option_catalogs import migrate

    registry = tmp_path / "BD" / "vault_db_registry.json"
    raw = json.dumps(payload)
    _write(registry, raw)
    for apply in (False, True):
        assert migrate(registry, apply) == 1
        assert registry.read_text() == raw
        assert list(registry.parent.iterdir()) == [registry]


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {"tables": "invalid"},
        {"tables": [{"properties": [None]}]},
        {"tables": [{"properties": [{"type": "created_time", "aliases": "invalid"}]}]},
        {"tables": [{"id": "valid", "properties": []}, "invalid-later-table"]},
        {"views": [None]},
    ],
)
@pytest.mark.usefixtures("isolated_runtime")
def check_invalid_date_registry_never_writes(
    tmp_path: Path, payload: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pipeline.scripts import migrate_table_system_dates as migration

    registry = tmp_path / "BD" / "vault_db_registry.json"
    backup = tmp_path / "backup"
    raw = json.dumps(payload)
    _write(registry, raw)
    for dry_run in (True, False):
        with pytest.raises(ValueError):
            migration.run_migration(tmp_path, "ca", dry_run, backup_root=backup)
        assert registry.read_text() == raw
        assert not backup.exists()
        assert list(registry.parent.iterdir()) == [registry]
    monkeypatch.setattr(sys, "argv", ["migration", "--vault", str(tmp_path), "--dry-run"])
    assert migration.main() == 1


@pytest.mark.usefixtures("isolated_runtime")
def check_yaml_nontext_keys_survive_sidecar_and_date_migrations(tmp_path: Path) -> None:
    from pipeline.scripts import migrate_option_catalogs as options
    from pipeline.scripts import migrate_sidecar_metadata as sidecars
    from pipeline.scripts import migrate_table_system_dates as dates

    page = tmp_path / "row.md"
    raw = (
        "---\nid: row\n7: [One, Two]\ntrue: opaque\n2020-01-02: {nested: value}\n"
        "is_template: false\nDate Added: 2021-01-01\n---\nBody\n"
    )
    _write(page, raw)
    original = options.read_frontmatter(page)
    assert original[7] == ["One", "Two"]
    assert original[True] == "opaque"
    assert original[date(2020, 1, 2)] == {"nested": "value"}
    assert options.collect_field_values(tmp_path, {"id": 7}) == {"One": 1, "Two": 1}
    assert sidecars.migrate_file(page, tmp_path, False) == "migrated"
    public, body = sidecars.parse_frontmatter_raw(page.read_text())
    assert list(public) == [key for key in original if key != "is_template"]
    assert public == {key: value for key, value in original.items() if key != "is_template"}
    assert body.lstrip() == "Body\n"
    table: dict[str, object] = {"properties": []}
    assert dates._migrate_page(page, table, "ca", False) == ("migrated", False, "row")
    after, _ = dates._parse_frontmatter(page.read_text())
    for key in (7, True, date(2020, 1, 2)):
        assert after[key] == original[key]
    assert after["Data de creació"] == date(2021, 1, 1)


@pytest.mark.usefixtures("isolated_runtime")
def check_date_registry_preserves_opaque_extensions() -> None:
    from pipeline.scripts.migrate_table_system_dates import migrate_registry

    registry = _date_registry()
    opaque = {"plugin": {"data": [None, True, {"arbitrary": 17}]}}
    registry["extensions"] = deepcopy(opaque)
    migrated, _ = migrate_registry(registry, "ca")
    assert migrated["extensions"] == opaque


@pytest.mark.parametrize("config", [None, ["plugin", {"opaque": True}], "plugin-data"])
@pytest.mark.usefixtures("isolated_runtime")
def check_option_migration_preserves_untouched_configs(tmp_path: Path, config: object) -> None:
    from pipeline.scripts.migrate_option_catalogs import migrate

    untouched: dict[str, object] = {
        "id": "text", "name": "Description", "type": "text", "config": config,
        "aliases": {"opaque": "plugin alias data"},
        "extensions": {"plugin": [None, {"custom": 7}]},
    }
    registry = tmp_path / "BD" / "vault_db_registry.json"
    payload: dict[str, object] = {"databases": [], "tables": [{
        "id": "table", "folder": "Rows", "properties": [untouched, {
            "id": "choice", "name": "Choice", "type": "select", "options": ["One"],
        }],
        "action_rules": ["opaque-inactive-rules"],
    }], "extensions": {"arbitrary": [None, 42]}}
    raw = json.dumps(payload)
    _write(registry, raw)
    assert migrate(registry, False) == 0
    assert registry.read_text() == raw
    assert migrate(registry, True) == 0
    result = _json_object(registry)
    tables = result["tables"]
    assert isinstance(tables, list) and len(tables) == 1
    table = tables[0]
    assert isinstance(table, dict)
    assert table["properties"][0] == untouched
    assert table["action_rules"] == ["opaque-inactive-rules"]
    assert result["extensions"] == payload["extensions"]
    migrated = registry.read_bytes()
    assert migrate(registry, True) == 0
    assert registry.read_bytes() == migrated
