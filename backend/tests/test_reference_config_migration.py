"""Recovery and conflict tests use only small, explicitly owned synthetic files."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.services import reference_config_migration as migration
from backend.services.reference_migration_io import ReferenceMigrationError, migration_lock

PAYLOAD = (
    b'{"target_table":"", "references_configured":true,\n'
    b' "linked_attachments_base":"/synthetic/pdfs", "unknown":{"preserve":[1,null]}}\n'
)


@pytest.fixture
def inputs(tmp_path: Path) -> tuple[Path, Path]:
    source = tmp_path / "legacy.json"
    source.write_bytes(PAYLOAD)
    return source, tmp_path / "data"


def run(inputs: tuple[Path, Path]) -> dict[str, object]:
    return migration.migrate_reference_config(*inputs, writers_stopped=True)


def test_plan_is_read_only_and_omits_values(inputs: tuple[Path, Path]) -> None:
    source, data = inputs
    result = migration.plan_reference_migration(*inputs)
    assert result["size"] == len(PAYLOAD)
    assert result["status"] == "planned"
    assert not data.exists()
    assert source.read_bytes() == PAYLOAD
    assert "linked_attachments_base" not in json.dumps(result)


def test_migrate_repeat_status_and_recover_exact_bytes(inputs: tuple[Path, Path]) -> None:
    paths = migration.migration_paths(*inputs)
    first = run(inputs)
    assert first == run(inputs) == migration.reference_migration_status(*inputs)
    assert paths.target.read_bytes() == paths.source.read_bytes() == PAYLOAD
    assert paths.target.samefile(paths.payload)
    if os.name != "nt":
        for path in (paths.target, paths.payload, paths.journal):
            assert path.stat().st_mode & 0o777 == 0o600
    result = migration.rollback_reference_migration(*inputs, writers_stopped=True)
    assert result["status"] == "rolled_back"
    assert not paths.target.exists()
    assert paths.source.read_bytes() == paths.recovered.read_bytes() == PAYLOAD
    assert migration.rollback_reference_migration(*inputs, writers_stopped=True) == result
    with pytest.raises(ReferenceMigrationError, match="rolled back"):
        run(inputs)


def test_preexisting_identical_destination_is_never_owned(inputs: tuple[Path, Path]) -> None:
    paths = migration.migration_paths(*inputs)
    paths.target.parent.mkdir(parents=True)
    paths.target.write_bytes(PAYLOAD)
    before = paths.target.stat()
    result = run(inputs)
    assert result["ownership"] == "existing"
    assert not paths.payload.exists()
    migration.rollback_reference_migration(*inputs, writers_stopped=True)
    assert paths.target.stat().st_ino == before.st_ino
    assert paths.target.read_bytes() == PAYLOAD
    assert not paths.recovered.exists()


@pytest.mark.parametrize("operation", ["migrate", "rollback"])
def test_writers_must_be_stopped(inputs: tuple[Path, Path], operation: str) -> None:
    callback = (
        migration.migrate_reference_config
        if operation == "migrate"
        else migration.rollback_reference_migration
    )
    with pytest.raises(ReferenceMigrationError, match="Stop every Gnosi writer"):
        callback(*inputs)
    assert not inputs[1].exists()


@pytest.mark.parametrize(
    "raw",
    [
        b"bad-secret-value",
        b"[]",
        b"null",
        b"42",
        b'"secret"',
        b"\xff",
        b"\xef\xbb\xbf{}",
        "{}".encode("utf-16"),
    ],
)
def test_malformed_source_never_creates_output(
    inputs: tuple[Path, Path],
    raw: bytes,
) -> None:
    inputs[0].write_bytes(raw)
    with pytest.raises(ReferenceMigrationError) as captured:
        run(inputs)
    assert "secret-value" not in str(captured.value)
    assert not inputs[1].exists()


def test_different_destination_is_preserved(inputs: tuple[Path, Path]) -> None:
    paths = migration.migration_paths(*inputs)
    paths.target.parent.mkdir(parents=True)
    paths.target.write_bytes(b'{"target_table":"another"}')
    with pytest.raises(ReferenceMigrationError, match="differs"):
        run(inputs)
    assert paths.target.read_bytes() == b'{"target_table":"another"}'
    assert not paths.journal.exists()


@pytest.mark.parametrize("name", ["source", "target", "journal", "payload", "recovered"])
def test_symlink_files_are_rejected(inputs: tuple[Path, Path], name: str) -> None:
    paths = migration.migration_paths(*inputs)
    path = getattr(paths, name)
    sentinel = inputs[0].parent / "outside-sentinel"
    sentinel.write_bytes(PAYLOAD)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    path.symlink_to(sentinel)
    with pytest.raises(ReferenceMigrationError, match="Symlink"):
        run(inputs)
    assert sentinel.read_bytes() == PAYLOAD


def test_symlink_ancestor_and_relative_paths_rejected(inputs: tuple[Path, Path]) -> None:
    source, data = inputs
    outside = source.parent / "outside"
    outside.mkdir()
    data.symlink_to(outside, target_is_directory=True)
    with pytest.raises(ReferenceMigrationError, match="Symlink"):
        run(inputs)
    assert list(outside.iterdir()) == []
    with pytest.raises(ReferenceMigrationError, match="absolute"):
        migration.plan_reference_migration("relative.json", source.parent / "clean-data")


@pytest.mark.parametrize(
    "field,value",
    [
        ("version", 2),
        ("source", "/wrong/source"),
        ("destination", "/wrong/target"),
        ("sha256", "not-a-digest"),
        ("size", True),
        ("ownership", "unknown"),
        ("status", "unknown"),
    ],
)
def test_mismatched_journal_fails_closed(
    inputs: tuple[Path, Path],
    field: str,
    value: object,
) -> None:
    run(inputs)
    paths = migration.migration_paths(*inputs)
    journal = json.loads(paths.journal.read_bytes())
    journal[field] = value
    paths.journal.write_text(json.dumps(journal))
    with pytest.raises(ReferenceMigrationError, match="journal"):
        run(inputs)
    assert paths.target.read_bytes() == paths.source.read_bytes() == PAYLOAD


@pytest.mark.parametrize("name", ["source", "target"])
def test_modified_files_prevent_resume_and_rollback(inputs: tuple[Path, Path], name: str) -> None:
    run(inputs)
    paths = migration.migration_paths(*inputs)
    path = getattr(paths, name)
    path.write_bytes(b'{"edited":true}')
    with pytest.raises(ReferenceMigrationError, match="differs"):
        run(inputs)
    with pytest.raises(ReferenceMigrationError, match="differs"):
        migration.rollback_reference_migration(*inputs, writers_stopped=True)
    assert path.read_bytes() == b'{"edited":true}'


@pytest.mark.parametrize("phase", ["prepared", "completed"])
def test_resume_after_journal_update_interrupted(
    inputs: tuple[Path, Path],
    monkeypatch: pytest.MonkeyPatch,
    phase: str,
) -> None:
    original = migration._save

    def fail(paths: migration.MigrationPaths, journal: migration.MigrationJournal) -> None:
        if journal.status == phase:
            raise OSError("synthetic interruption")
        original(paths, journal)

    with monkeypatch.context() as patch:
        patch.setattr(migration, "_save", fail)
        with pytest.raises(OSError, match="synthetic"):
            run(inputs)
    assert run(inputs)["status"] == "completed"
    assert migration.migration_paths(*inputs).target.read_bytes() == PAYLOAD


def test_late_competing_destination_cannot_be_overwritten(
    inputs: tuple[Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original = migration._publish

    def competing(paths: migration.MigrationPaths, journal: migration.MigrationJournal) -> None:
        paths.target.write_bytes(PAYLOAD)
        original(paths, journal)

    monkeypatch.setattr(migration, "_publish", competing)
    with pytest.raises(ReferenceMigrationError, match="independently"):
        run(inputs)
    paths = migration.migration_paths(*inputs)
    assert paths.target.read_bytes() == PAYLOAD
    assert not paths.target.samefile(paths.payload)


def test_replaced_identical_target_is_not_removed(inputs: tuple[Path, Path]) -> None:
    run(inputs)
    paths = migration.migration_paths(*inputs)
    paths.target.unlink()
    paths.target.write_bytes(PAYLOAD)
    with pytest.raises(ReferenceMigrationError, match="replaced"):
        migration.rollback_reference_migration(*inputs, writers_stopped=True)
    assert paths.target.read_bytes() == PAYLOAD


def test_exclusive_lock_rejects_second_operator(inputs: tuple[Path, Path]) -> None:
    paths = migration.migration_paths(*inputs)
    paths.target.parent.mkdir(parents=True)
    with migration_lock(paths.journal):
        with pytest.raises(ReferenceMigrationError, match="Another"):
            run(inputs)
    assert run(inputs)["status"] == "completed"


def test_cli_without_runtime_environment(inputs: tuple[Path, Path]) -> None:
    script = Path(__file__).resolve().parents[2] / "scripts/migrate-reference-config.py"
    for command in ("plan", "migrate", "status", "rollback"):
        result = subprocess.run(
            [sys.executable, str(script), command, *map(str, inputs), "--writers-stopped"],
            env={"GNOSI_VALIDATION_ROOT": "/deliberately-invalid-runtime-root"},
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        assert "linked_attachments_base" not in result.stdout + result.stderr
        assert json.loads(result.stdout)["source_preserved"] is True


@pytest.mark.parametrize("phase", ["link", "journal"])
def test_interrupted_rollback_resumes_without_losing_files(
    inputs: tuple[Path, Path],
    monkeypatch: pytest.MonkeyPatch,
    phase: str,
) -> None:
    run(inputs)
    from backend.services.reference_migration_io import link_exclusive

    original_link, original_save = link_exclusive, migration._save

    def fail_link(source: Path, target: Path) -> None:
        original_link(source, target)
        raise OSError("interrupted after recovery publication")

    def fail_save(paths: migration.MigrationPaths, journal: migration.MigrationJournal) -> None:
        if journal.status == "rolled_back":
            raise OSError("interrupted before final journal")
        original_save(paths, journal)

    with monkeypatch.context() as patch:
        if phase == "link":
            patch.setattr(migration, "link_exclusive", fail_link)
        else:
            patch.setattr(migration, "_save", fail_save)
        with pytest.raises(OSError, match="interrupted"):
            migration.rollback_reference_migration(*inputs, writers_stopped=True)
    result = migration.rollback_reference_migration(*inputs, writers_stopped=True)
    paths = migration.migration_paths(*inputs)
    assert result["status"] == "rolled_back"
    assert paths.recovered.read_bytes() == paths.source.read_bytes() == PAYLOAD
    assert not paths.target.exists()


def test_missing_published_target_is_not_reported_as_success(inputs: tuple[Path, Path]) -> None:
    run(inputs)
    paths = migration.migration_paths(*inputs)
    paths.target.unlink()
    with pytest.raises(ReferenceMigrationError, match="missing"):
        migration.reference_migration_status(*inputs)
    with pytest.raises(ReferenceMigrationError, match="missing"):
        migration.rollback_reference_migration(*inputs, writers_stopped=True)


def test_incomplete_preparation_can_be_rolled_back(
    inputs: tuple[Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail(paths: migration.MigrationPaths, journal: migration.MigrationJournal) -> None:
        raise OSError("before payload")

    with monkeypatch.context() as patch:
        patch.setattr(migration, "_prepare", fail)
        with pytest.raises(OSError, match="before payload"):
            run(inputs)
    assert (
        migration.rollback_reference_migration(*inputs, writers_stopped=True)["status"]
        == "rolled_back"
    )
    assert inputs[0].read_bytes() == PAYLOAD


def test_aliasing_source_and_target_is_rejected(inputs: tuple[Path, Path]) -> None:
    paths = migration.migration_paths(*inputs)
    paths.target.parent.mkdir(parents=True)
    os.link(paths.source, paths.target)
    with pytest.raises(ReferenceMigrationError, match="share a file"):
        run(inputs)


def test_unsupported_publication_preserves_original_and_resume_state(
    inputs: tuple[Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:

    def unsupported(*args: object, **kwargs: object) -> None:
        raise OSError("synthetic unsupported hard links")

    with monkeypatch.context() as patch:
        patch.setattr(os, "link", unsupported)
        with pytest.raises(ReferenceMigrationError, match="hard-link"):
            run(inputs)
    paths = migration.migration_paths(*inputs)
    assert paths.source.read_bytes() == paths.payload.read_bytes() == PAYLOAD
    assert not paths.target.exists()
    assert run(inputs)["status"] == "completed"


def test_windows_lock_adapter_releases_after_body_failure(
    inputs: tuple[Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.services import reference_migration_io as filesystem

    operations: list[tuple[int, int]] = []

    def lock(descriptor: int, mode: int, count: int) -> None:
        assert descriptor >= 0
        operations.append((mode, count))

    adapter = SimpleNamespace(locking=lock, LK_NBLCK=2, LK_UNLCK=0)
    # Replace only this module's OS adapter; never alter pathlib's global platform.
    monkeypatch.setattr(
        filesystem,
        "os",
        SimpleNamespace(
            name="nt",
            O_RDWR=os.O_RDWR,
            O_CREAT=os.O_CREAT,
            O_NOFOLLOW=getattr(os, "O_NOFOLLOW", 0),
            open=os.open,
            fdopen=os.fdopen,
            fstat=os.fstat,
        ),
    )
    monkeypatch.setattr(filesystem, "importlib", SimpleNamespace(import_module=lambda _: adapter))
    journal = inputs[0].parent / "synthetic-windows-journal.json"
    with pytest.raises(RuntimeError, match="synthetic body failure"):
        with filesystem.migration_lock(journal):
            raise RuntimeError("synthetic body failure")
    assert operations == [(2, 1), (0, 1)]


def test_windows_lock_conflict_does_not_enter_body(
    inputs: tuple[Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.services import reference_migration_io as filesystem

    def lock(descriptor: int, mode: int, count: int) -> None:
        raise OSError("synthetic lock conflict")

    adapter = SimpleNamespace(locking=lock, LK_NBLCK=2, LK_UNLCK=0)
    monkeypatch.setattr(
        filesystem,
        "os",
        SimpleNamespace(
            name="nt",
            O_RDWR=os.O_RDWR,
            O_CREAT=os.O_CREAT,
            open=os.open,
            fdopen=os.fdopen,
            fstat=os.fstat,
        ),
    )
    monkeypatch.setattr(filesystem, "importlib", SimpleNamespace(import_module=lambda _: adapter))
    with pytest.raises(ReferenceMigrationError, match="Another"):
        with filesystem.migration_lock(inputs[0].parent / "conflicting-journal.json"):
            pytest.fail("Lock conflict must not enter the migration")


@pytest.mark.parametrize("name", ["payload", "recovered"])
def test_orphaned_recovery_files_are_not_claimed(inputs: tuple[Path, Path], name: str) -> None:
    paths = migration.migration_paths(*inputs)
    paths.target.parent.mkdir(parents=True)
    getattr(paths, name).write_bytes(PAYLOAD)
    with pytest.raises(ReferenceMigrationError, match="without their journal"):
        run(inputs)
    assert not paths.target.exists()
    assert not paths.journal.exists()


def test_nonprivate_staging_is_not_published(
    inputs: tuple[Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if os.name == "nt":
        # Windows privacy is enforced by directory ACLs, not POSIX mode bits.
        return
    original = migration._publish

    def fail(paths: migration.MigrationPaths, journal: migration.MigrationJournal) -> None:
        paths.payload.chmod(0o644)
        raise OSError("before publication")

    with monkeypatch.context() as patch:
        patch.setattr(migration, "_publish", fail)
        with pytest.raises(OSError, match="before publication"):
            run(inputs)
    with pytest.raises(ReferenceMigrationError, match="not private"):
        run(inputs)
    paths = migration.migration_paths(*inputs)
    assert not paths.target.exists()
    assert paths.source.read_bytes() == PAYLOAD
    assert migration._publish is original
