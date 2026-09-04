from __future__ import annotations

import json
import sqlite3
import subprocess
from collections.abc import Iterator, Mapping
from pathlib import Path

import pytest

from backend.migrations.families import FAMILIES
from backend.migrations.runner import _current_revision, _run_alembic, ensure_database_schema
from backend.migrations.schema_audit import database_fingerprint


INVENTORY_PATH = (
    Path(__file__).parents[1] / "migrations" / "gnosi_2x_schema_variants.json"
)
FINGERPRINTS_PATH = (
    Path(__file__).parents[1] / "migrations" / "schema_fingerprints.json"
)


def _load_json(path: Path) -> Mapping[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def _family_matrix() -> Mapping[str, object]:
    value = _load_json(INVENTORY_PATH)["family_matrix"]
    assert isinstance(value, dict)
    return value


def _known_variants() -> Iterator[tuple[str, str]]:
    for family_name, raw_entry in _family_matrix().items():
        assert isinstance(family_name, str)
        assert isinstance(raw_entry, dict)
        predecessors = raw_entry["source_demonstrable_predecessors"]
        assert isinstance(predecessors, list)
        for revision in predecessors:
            assert isinstance(revision, str)
            yield family_name, revision
        release_variants = raw_entry["release_variants"]
        assert isinstance(release_variants, dict)
        for revisions in release_variants.values():
            assert isinstance(revisions, list)
            for revision in revisions:
                assert isinstance(revision, str)
                yield family_name, revision


KNOWN_VARIANTS = sorted(set(_known_variants()))


def _quoted(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _synthetic_value(column_name: str, declared_type: str) -> object:
    normalized = declared_type.upper()
    if "INT" in normalized:
        return 101
    if any(token in normalized for token in ("REAL", "FLOA", "DOUB", "NUM")):
        return 101.25
    if "BLOB" in normalized:
        return b"gnosi-2x-synthetic"
    if "json" in column_name.lower():
        return "{}"
    return f"gnosi-2x-{column_name}"


def _insert_synthetic_row(connection: sqlite3.Connection, table: str) -> tuple[object, ...]:
    columns = [
        row
        for row in connection.execute(f"PRAGMA table_xinfo({_quoted(table)})")
        if int(row[6]) == 0
    ]
    names = [str(row[1]) for row in columns]
    values = [_synthetic_value(str(row[1]), str(row[2])) for row in columns]
    placeholders = ", ".join("?" for _ in names)
    connection.execute(
        f"INSERT INTO {_quoted(table)} ({', '.join(map(_quoted, names))}) "
        f"VALUES ({placeholders})",
        values,
    )
    connection.commit()
    return tuple(values)


def _remove_version_table(connection: sqlite3.Connection) -> None:
    connection.execute("DROP TABLE alembic_version")
    connection.commit()


def test_inventory_covers_every_registered_fingerprint_and_release_tag() -> None:
    inventory = _load_json(INVENTORY_PATH)
    fingerprints = _load_json(FINGERPRINTS_PATH)
    registered = fingerprints["families"]
    assert isinstance(registered, dict)

    assert set(_family_matrix()) == set(FAMILIES) == set(registered)
    all_registered = {
        (family.name, revision)
        for family in FAMILIES.values()
        for revision in family.revisions
    }
    raw_post_2x = inventory["post_2x_revisions"]
    assert isinstance(raw_post_2x, dict)
    post_2x = {
        (family_name, revision)
        for family_name, revisions in raw_post_2x.items()
        if isinstance(family_name, str) and isinstance(revisions, list)
        for revision in revisions
        if isinstance(revision, str)
    }
    assert set(KNOWN_VARIANTS).isdisjoint(post_2x)
    assert set(KNOWN_VARIANTS) | post_2x == all_registered

    release_groups = inventory["release_groups"]
    assert isinstance(release_groups, dict)
    tags = {
        tag
        for raw_group in release_groups.values()
        if isinstance(raw_group, dict)
        for raw_tags in [raw_group["tags"]]
        if isinstance(raw_tags, dict)
        for tag in raw_tags
    }
    assert tags == {f"v2.0.{patch}" for patch in range(7)}


def test_versioned_history_auditor_reproduces_tag_evidence() -> None:
    subprocess.run(
        [
            str(Path(__file__).parents[2] / "scripts" / "audit-gnosi-2x-schema-history.py"),
            "--check",
        ],
        cwd=Path(__file__).parents[2],
        check=True,
    )


@pytest.mark.parametrize(("family_name", "revision"), KNOWN_VARIANTS)
def test_every_source_demonstrable_2x_variant_has_a_synthetic_fixture(
    tmp_path: Path,
    family_name: str,
    revision: str,
) -> None:
    database = tmp_path / "fixtures" / family_name / f"{revision}.sqlite"
    database.parent.mkdir(parents=True)
    _run_alembic(database, "upgrade", revision)
    with sqlite3.connect(database) as connection:
        _remove_version_table(connection)

    fingerprints = _load_json(FINGERPRINTS_PATH)["families"]
    assert isinstance(fingerprints, dict)
    family_fingerprints = fingerprints[family_name]
    assert isinstance(family_fingerprints, dict)
    revisions = family_fingerprints["revisions"]
    assert isinstance(revisions, dict)
    accepted = revisions[revision]
    assert isinstance(accepted, list)
    assert database_fingerprint(database) in accepted

    result = ensure_database_schema(database, family_name, tmp_path)

    assert result["revision_before"] == revision
    assert result["revision_after"] == FAMILIES[family_name].head
    assert _current_revision(database) == FAMILIES[family_name].head
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)


@pytest.mark.parametrize(("family_name", "revision"), KNOWN_VARIANTS)
def test_every_source_demonstrable_2x_variant_preserves_synthetic_rows(
    tmp_path: Path,
    family_name: str,
    revision: str,
) -> None:
    raw_entry = _family_matrix()[family_name]
    assert isinstance(raw_entry, dict)
    table = raw_entry["preservation_table"]
    assert isinstance(table, str)
    database = tmp_path / "preservation" / family_name / f"{revision}.sqlite"
    database.parent.mkdir(parents=True)
    _run_alembic(database, "upgrade", revision)

    before: tuple[object, ...]
    with sqlite3.connect(database) as connection:
        if family_name == "vault":
            connection.execute(
                "INSERT INTO mail_tags(id,name,color) VALUES(?,?,?)",
                ("tag-1", "Synthetic", "#123456"),
            )
            before = (
                "message-1",
                "tag-1",
                "synthetic@example.invalid",
                "Synthetic subject",
                "Synthetic sender",
                "2026-01-01",
            )
            connection.execute(
                """INSERT INTO mail_message_tags(
                    message_id,tag_id,account_email,subject,sender,date_str
                ) VALUES(?,?,?,?,?,?)""",
                before,
            )
            connection.commit()
        else:
            before = _insert_synthetic_row(connection, table)
        _remove_version_table(connection)

    ensure_database_schema(database, family_name, tmp_path)

    with sqlite3.connect(database) as connection:
        if family_name == "vault":
            after = connection.execute(
                """SELECT message_id,tag_id,account_email,subject,sender,date_str
                FROM mail_message_tags LIMIT 1"""
            ).fetchone()
            assert after == before
            assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
            assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
            return
        columns = [
            row
            for row in connection.execute(f"PRAGMA table_xinfo({_quoted(table)})")
            if int(row[6]) == 0
        ]
        original_width = len(before)
        selected = ", ".join(_quoted(str(row[1])) for row in columns[:original_width])
        after = connection.execute(
            f"SELECT {selected} FROM {_quoted(table)} LIMIT 1"
        ).fetchone()
        assert after == before
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
