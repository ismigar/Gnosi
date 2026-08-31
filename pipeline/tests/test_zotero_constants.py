"""Validate pinned Zotero output in temporary paths, without refresh or network."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from pipeline.skills.zotero_schema.scripts import build_constants as build


def synthetic_schema() -> dict[str, object]:
    return {
        "version": 42,
        "itemTypes": [
            {"itemType": "book", "fields": [{"field": "title"}, {"field": "ISBN"}]},
            {"itemType": "annotation"},
        ],
        "csl": {"types": {"book": ["book"], "article": ["annotation"]}},
        "locales": {loc: {"itemTypes": {"book": "Llibre"}} for loc in build.LOCALES},
    }


def configure_temp_outputs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(build, "ROOT", tmp_path)
    monkeypatch.setattr(build, "OUT_PY", tmp_path / "backend" / "constants.py")
    monkeypatch.setattr(build, "OUT_TS", tmp_path / "frontend" / "constants.ts")


def configure_schema(
    schema: object,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_temp_outputs(tmp_path, monkeypatch)
    schema_path = tmp_path / "schema.json"
    schema_path.write_text(json.dumps(schema), encoding="utf-8")
    monkeypatch.setattr(build, "SCHEMA_PATH", schema_path)


def test_pinned_generation_byte_identical_without_touching_repository_outputs(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    pinned_path = build.SCHEMA_PATH
    original_py, original_ts = build.OUT_PY, build.OUT_TS
    expected_py, expected_ts = original_py.read_bytes(), original_ts.read_bytes()
    before = [p.stat().st_mtime_ns for p in (pinned_path, original_py, original_ts)]
    configure_temp_outputs(tmp_path, monkeypatch)
    assert build.main() == 0
    assert build.OUT_PY.read_bytes() == expected_py
    assert build.OUT_TS.read_bytes() == expected_ts
    first_stdout = capsys.readouterr()
    assert first_stdout.err == ""
    assert "OK schema v42" in first_stdout.out
    assert build.main() == 0
    assert build.OUT_PY.read_bytes() == expected_py
    assert build.OUT_TS.read_bytes() == expected_ts
    assert capsys.readouterr() == first_stdout
    assert [p.stat().st_mtime_ns for p in (pinned_path, original_py, original_ts)] == before
    schema, sha16 = build.load_schema()
    assert schema["version"] == 42
    assert sha16 == hashlib.sha256(pinned_path.read_bytes()).hexdigest()[:16]


def test_opaque_metadata_field_order_missing_labels_and_duplicates(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    schema = synthetic_schema()
    schema["unconsumed"] = {"opaque": [None, 12, {"nested": True}]}
    schema["itemTypes"] = [
        {
            "itemType": "book",
            "fields": [
                {"field": "ISBN", "opaque": None},
                {"unused": [False, 1]},
                {"field": "title"},
                {"field": "title"},
            ],
            "creatorTypes": None,
        },
        {"itemType": "annotation", "opaque": False},
    ]
    schema["locales"] = {
        **{
            loc: {"itemTypes": {"book": "Llibre", "unused": None}, "fields": False}
            for loc in build.LOCALES
        },
        "unused-locale": None,
    }
    schema["csl"] = {"types": {"book": ["book"]}, "unused": [None]}
    assert build.derive_item_type_fields(schema) == {
        "book": ["ISBN", "title", "title"],
        "annotation": [],
    }
    labels = build.derive_labels(schema, ["annotation", "book"])
    assert labels == {loc: {"annotation": "annotation", "book": "Llibre"} for loc in build.LOCALES}
    configure_schema(schema, tmp_path, monkeypatch)
    assert build.main() == 0
    assert "'ISBN', 'title', 'title'" in build.OUT_PY.read_text(encoding="utf-8")


def test_csl_multiple_parents_warning_is_stable(capsys: pytest.CaptureFixture[str]) -> None:
    assert build.derive_zotero_to_csl({"z": ["book"], "a": ["book", "book"], "m": ["book"]}) == {
        "book": "a"
    }
    assert capsys.readouterr().err == (
        "WARNING: zoteroType 'book' apareix sota CSL types ['a', 'a', 'm', 'z']; "
        "emetem 'a' (primer alfabètic).\n"
    )
    assert build.invert_labels({"fixture": {"z": "same", "a": "same", "b": "other"}}) == {
        "fixture": {"same": "a", "other": "b"},
    }


def test_missing_locales_fail_before_creating_outputs(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    schema = synthetic_schema()
    schema["locales"] = {}
    configure_schema(schema, tmp_path, monkeypatch)
    assert build.main() == 1
    assert (
        capsys.readouterr().err
        == f"ERROR: locales esperats no trobats al schema: {list(build.LOCALES)}\n"
    )
    assert not build.OUT_PY.parent.exists()
    assert not build.OUT_TS.parent.exists()
    assert build.derive_labels({}, ["book"]) == {loc: {"book": "book"} for loc in build.LOCALES}


@pytest.mark.parametrize(
    "key,value,location",
    [
        ("version", "42", "version"),
        ("version", True, "version"),
        ("itemTypes", None, "itemTypes"),
        ("itemTypes", [None], "itemTypes entry"),
        ("itemTypes", [{"itemType": 1}], "itemTypes.itemType"),
        ("itemTypes", [{"itemType": "book", "fields": None}], "itemTypes.fields"),
        ("itemTypes", [{"itemType": "book", "fields": [None]}], "itemTypes.fields entry"),
        (
            "itemTypes",
            [{"itemType": "book", "fields": [{"field": None}]}],
            "itemTypes.fields.field",
        ),
        ("csl", None, "csl"),
        ("csl", {"types": []}, "csl.types"),
        ("csl", {"types": {"book": "book"}}, "csl.types.book"),
        ("csl", {"types": {"book": [None]}}, "csl.types.book entry"),
        ("locales", None, "locales"),
        ("locales", {loc: None for loc in build.LOCALES}, "locales.ca-AD"),
        ("locales", {loc: {"itemTypes": []} for loc in build.LOCALES}, "locales.ca-AD.itemTypes"),
        (
            "locales",
            {loc: {"itemTypes": {"book": None}} for loc in build.LOCALES},
            "locales.ca-AD.itemTypes.book",
        ),
    ],
)
def test_malformed_consumed_fields_fail_before_writes(
    key: str,
    value: object,
    location: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    schema = synthetic_schema()
    schema[key] = value
    configure_schema(schema, tmp_path, monkeypatch)
    # Existing outputs must also remain untouched when validation fails.
    build.OUT_PY.parent.mkdir()
    build.OUT_TS.parent.mkdir()
    build.OUT_PY.write_bytes(b"existing python fixture\n")
    build.OUT_TS.write_bytes(b"existing typescript fixture\n")
    with pytest.raises(ValueError) as error:
        build.main()
    assert str(error.value).startswith(f"{location}: expected ")
    assert build.OUT_PY.read_bytes() == b"existing python fixture\n"
    assert build.OUT_TS.read_bytes() == b"existing typescript fixture\n"


@pytest.mark.parametrize("value", [None, [], 42, "schema"])
def test_nonobject_schema_is_rejected(
    value: object,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_schema(value, tmp_path, monkeypatch)
    with pytest.raises(ValueError, match="schema: expected an object"):
        build.load_schema()


def test_unused_non_json_metadata_is_not_recursively_validated() -> None:
    schema = {
        "itemTypes": [{"itemType": "book", "fields": [{"field": "title", 1: object()}]}],
        "locales": {
            loc: {"itemTypes": {"book": "Book", "ignored": object()}} for loc in build.LOCALES
        },
        "ignored": object(),
    }
    assert build.derive_item_type_fields(schema) == {"book": ["title"]}
    assert build.derive_labels(schema, ["book"]) == {loc: {"book": "Book"} for loc in build.LOCALES}
    with pytest.raises(ValueError, match="csl.types key: expected a string"):
        build.derive_zotero_to_csl({1: ["book"]})
