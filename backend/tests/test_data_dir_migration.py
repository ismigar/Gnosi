import json
import sqlite3
from pathlib import Path

import pytest

import backend.services.data_dir_migration as migration
from backend.services.data_dir_migration import (
    DataMigrationError,
    default_journal_path,
    finalize_data_migration,
    migrate_data_dir,
    plan_data_migration,
    rollback_data_migration,
)


def _source_fixture(root):
    source = root / "legacy-data"
    (source / "system").mkdir(parents=True)
    (source / "cache").mkdir()
    (source / "cache" / "index.json").write_text('{"ok": true}', encoding="utf-8")
    database = source / "system" / "management.sqlite"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT)")
        connection.execute("INSERT INTO notes (title) VALUES ('preserved')")
    return source


def _database_title(root):
    with sqlite3.connect(root / "system" / "management.sqlite") as connection:
        return connection.execute("SELECT title FROM notes").fetchone()[0]


def test_same_volume_migration_is_atomic_idempotent_and_reversible(tmp_path):
    source = _source_fixture(tmp_path)
    destination = tmp_path / "new-data"
    journal_path = default_journal_path(source, destination)

    plan = plan_data_migration(source, destination)
    completed = migrate_data_dir(source, destination, writers_stopped=True)
    repeated = migrate_data_dir(source, destination, writers_stopped=True)

    assert plan["method"] == "rename"
    assert completed["status"] == "completed"
    assert completed["source_preserved"] is False
    assert repeated["id"] == completed["id"]
    assert not source.exists()
    assert _database_title(destination) == "preserved"
    assert completed["destination_sqlite"][0]["integrity"] == "ok"

    rolled_back = rollback_data_migration(journal_path, writers_stopped=True)
    assert rolled_back["status"] == "rolled_back"
    assert source.is_dir()
    assert not destination.exists()
    assert _database_title(source) == "preserved"


def test_empty_destination_scaffold_is_restored_by_rollback(tmp_path):
    source = _source_fixture(tmp_path)
    destination = tmp_path / "new-data"
    destination.mkdir()
    journal_path = default_journal_path(source, destination)

    completed = migrate_data_dir(source, destination, writers_stopped=True)
    displaced = completed["displaced_empty_destination"]
    assert destination.is_dir()
    assert displaced

    rollback_data_migration(journal_path, writers_stopped=True)
    assert source.is_dir()
    assert destination.is_dir()
    assert list(destination.iterdir()) == []
    assert not Path(displaced).exists()


def test_forced_copy_preserves_source_and_rollback_removes_only_verified_copy(tmp_path):
    source = _source_fixture(tmp_path)
    destination = tmp_path / "copied-data"
    journal_path = default_journal_path(source, destination)

    completed = migrate_data_dir(
        source,
        destination,
        force_copy=True,
        writers_stopped=True,
    )

    assert completed["method"] == "copy"
    assert completed["source_preserved"] is True
    assert source.is_dir() and destination.is_dir()
    assert _database_title(destination) == "preserved"

    rollback_data_migration(journal_path, writers_stopped=True)
    assert source.is_dir()
    assert not destination.exists()


def test_nonempty_destination_is_never_replaced(tmp_path):
    source = _source_fixture(tmp_path)
    destination = tmp_path / "occupied"
    destination.mkdir()
    (destination / "foreign.txt").write_text("keep", encoding="utf-8")

    with pytest.raises(DataMigrationError, match="Destination is not empty"):
        plan_data_migration(source, destination)

    with pytest.raises(DataMigrationError, match="Destination is not empty"):
        migrate_data_dir(source, destination, writers_stopped=True)

    assert source.is_dir()
    assert (destination / "foreign.txt").read_text(encoding="utf-8") == "keep"


def test_corrupt_sqlite_aborts_before_moving_source(tmp_path):
    source = tmp_path / "legacy-data"
    source.mkdir()
    corrupt = source / "broken.sqlite"
    corrupt.write_bytes(b"SQLite format 3\x00" + b"not-a-real-database")
    destination = tmp_path / "new-data"

    with pytest.raises(DataMigrationError, match="Could not verify SQLite"):
        migrate_data_dir(source, destination, writers_stopped=True)

    assert source.is_dir()
    assert not destination.exists()


def test_destination_verification_failure_rolls_back_atomic_move(tmp_path, monkeypatch):
    source = _source_fixture(tmp_path)
    destination = tmp_path / "new-data"
    real_inventory = migration.inventory_tree
    calls = 0

    def fail_destination(root, *, hashes):
        nonlocal calls
        calls += 1
        if root == destination:
            raise DataMigrationError("simulated destination verification failure")
        return real_inventory(root, hashes=hashes)

    monkeypatch.setattr(migration, "inventory_tree", fail_destination)

    with pytest.raises(DataMigrationError, match="simulated"):
        migrate_data_dir(source, destination, writers_stopped=True)

    assert calls >= 2
    assert source.is_dir()
    assert not destination.exists()
    journal = json.loads(default_journal_path(source, destination).read_text(encoding="utf-8"))
    assert journal["status"] == "failed"
    assert journal["rollback"] == "automatic"

    monkeypatch.setattr(migration, "inventory_tree", real_inventory)
    completed = migrate_data_dir(source, destination, writers_stopped=True)

    assert completed["status"] == "completed"
    assert completed["failures"][0]["rollback"] == "automatic"
    assert "error" not in completed
    assert "rollback" not in completed


def test_external_symlink_is_rejected(tmp_path):
    source = _source_fixture(tmp_path)
    outside = tmp_path / "outside.txt"
    outside.write_text("outside", encoding="utf-8")
    (source / "escape").symlink_to(outside)

    with pytest.raises(DataMigrationError, match="Symlink escapes"):
        plan_data_migration(source, tmp_path / "new-data")


def test_finalize_removes_only_displaced_empty_scaffold(tmp_path):
    source = _source_fixture(tmp_path)
    destination = tmp_path / "new-data"
    destination.mkdir()
    journal_path = default_journal_path(source, destination)
    completed = migrate_data_dir(source, destination, writers_stopped=True)
    displaced = Path(completed["displaced_empty_destination"])

    finalized = finalize_data_migration(journal_path)

    assert finalized["status"] == "finalized"
    assert not displaced.exists()
    assert destination.is_dir()


def test_writer_confirmation_is_mandatory(tmp_path):
    source = _source_fixture(tmp_path)
    with pytest.raises(DataMigrationError, match="Stop every Gnosi writer"):
        migrate_data_dir(source, tmp_path / "new-data")


def test_sqlite_sidecars_are_not_durable_inventory_or_copy_payload(tmp_path):
    source = _source_fixture(tmp_path)
    database = source / "system" / "management.sqlite"
    sidecars = [
        database.with_name(database.name + suffix)
        for suffix in ("-wal", "-shm", "-journal")
    ]
    for sidecar in sidecars:
        sidecar.write_bytes(b"ephemeral")

    inventory = migration.inventory_tree(source, hashes=True)
    staging = tmp_path / "staging"
    migration._copy_tree(source, staging)

    for sidecar in sidecars:
        relative = sidecar.relative_to(source).as_posix()
        assert relative not in inventory
        assert not (staging / relative).exists()
    assert (staging / "system" / "management.sqlite").is_file()
