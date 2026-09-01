"""Raw-title and registry contracts, exercised only in isolated child processes."""

from __future__ import annotations

import importlib
from array import array
from datetime import date, datetime
import os
import subprocess
import sys
import tempfile
from collections.abc import Callable, Iterator, Mapping
from pathlib import Path
from types import MappingProxyType

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("first", ["keys", "facade"])
def test_shared_contracts_in_isolated_subprocess(first: str) -> None:
    with tempfile.TemporaryDirectory(prefix="gnosi-citation-shared-") as temporary:
        root = Path(temporary).resolve()
        for name in ("data", "vault", "host"):
            (root / name).mkdir()
        environment = {
            "PATH": os.defpath,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
            "GNOSI_VALIDATION_ROOT": str(root),
            "GNOSI_DATA_DIR": str(root / "data"),
            "DIGITAL_BRAIN_VAULT_PATH": str(root / "vault"),
            "VAULT_HOST_PATH": str(root / "vault"),
            "HOME_HOST_PATH": str(root / "host"),
            "GNOSI_DISABLE_SCHEDULER": "1",
            "GNOSI_FILES_PROVIDER": "local",
            "GNOSI_RUN_LIVE_E2E": "0",
            "GNOSI_REQUIRE_AUTH": "1",
            "GNOSI_JWT_SECRET": "synthetic-citation-shared-fixture",
            "GNOSI_CITATION_SHARED_IMPORT_FIRST": first,
        }
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                "-q",
                "--tb=short",
                "-p",
                "no:cacheprovider",
                "--basetemp",
                str(root / "tests"),
                "-o",
                "python_functions=check_*",
                str(Path(__file__).resolve()),
            ],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        sys.stdout.write(result.stdout)


@pytest.fixture(scope="session", autouse=True)
def isolated_backend() -> None:
    if "GNOSI_CITATION_SHARED_IMPORT_FIRST" not in os.environ:
        return
    # Pytest imports backend.tests while collecting; application owners must
    # remain unloaded until the complete isolated selectors have been checked.
    assert "backend.api.vault_routes" not in sys.modules
    assert "backend.domains.vault.citations.keys" not in sys.modules
    assert "backend.domains.vault.citations.export_routes" not in sys.modules
    root = Path(os.environ["GNOSI_VALIDATION_ROOT"])
    assert root.is_absolute() and root.is_dir()
    for selector, suffix in (
        ("GNOSI_DATA_DIR", "data"),
        ("DIGITAL_BRAIN_VAULT_PATH", "vault"),
        ("VAULT_HOST_PATH", "vault"),
        ("HOME_HOST_PATH", "host"),
    ):
        assert Path(os.environ[selector]) == root / suffix
        assert (root / suffix).is_dir()
    assert os.environ["GNOSI_DISABLE_SCHEDULER"] == "1"
    assert os.environ["GNOSI_RUN_LIVE_E2E"] == "0"
    assert not {"OPENAI_API_KEY", "GNOSI_SHARED_ENV_FILE", "GNOSI_API_TOKEN"} & os.environ.keys()
    first = (
        "backend.domains.vault.citations.keys"
        if os.environ["GNOSI_CITATION_SHARED_IMPORT_FIRST"] == "keys"
        else "backend.api.vault_routes"
    )
    importlib.import_module(first)
    importlib.import_module("backend.api.vault_routes")
    from backend.config.validation_runtime import validation_runtime_enabled

    assert validation_runtime_enabled()


class UnreadableTitle:
    def __bool__(self) -> bool:
        raise LookupError("raw title truthiness was evaluated")

    def __str__(self) -> str:
        raise AssertionError("raw title was converted")


class FalseTitle:
    def __init__(self) -> None:
        self.reads = 0

    def __bool__(self) -> bool:
        self.reads += 1
        return False

    def __str__(self) -> str:
        raise AssertionError("falsey title was converted")


class TitleString(str):
    def __str__(self) -> str:
        raise AssertionError("string title was converted")


def _generators() -> tuple[Callable[[object, object, object, set[str] | None], str], ...]:
    from backend.domains.vault.citations import export_routes, keys

    return keys.generate_citation_key, export_routes.generate_citation_key


@pytest.mark.parametrize(
    "authors,expected",
    [
        ([{"cognom1": "García", "cognom2": "Fernández"}], "garciafernandez2026"),
        ("García Fernández, Ismael", "garciafernandez2026"),
        ([{"family": "Real Academia Española"}], "rae2026"),
        ([{"literal": "Mercè Rodoreda"}], "rodoreda2026"),
        ([{"family": "Görür"}], "gorur2026"),
    ],
)
def check_author_family_does_not_read_raw_title(authors: object, expected: str) -> None:
    occupied = {expected, expected + "a", expected + "b"}
    for generate in _generators():
        assert generate(authors, 2026, UnreadableTitle(), None) == expected
        assert generate(authors, 2026, UnreadableTitle(), occupied) == expected + "c"
    assert occupied == {expected, expected + "a", expected + "b"}


@pytest.mark.parametrize("title", [None, False, 0, 0.0, "", [], {}, (), b"", bytearray()])
def check_falsey_titles_keep_fallback(title: object) -> None:
    from backend.domains.vault.citations import export_routes, keys

    assert keys.title_token(title) == export_routes._title_token(title) == ""
    for generate in _generators():
        assert generate(None, None, title, None) == "refnd"
        assert generate([], 2026, title, {"ref2026", "ref2026a"}) == "ref2026b"


def check_title_truthiness_is_only_read_once_when_needed() -> None:
    from backend.domains.vault.citations import export_routes, keys

    for tokenize in (keys.title_token, export_routes._title_token):
        title = FalseTitle()
        assert tokenize(title) == ""
        assert title.reads == 1
    for generate in _generators():
        title = FalseTitle()
        assert generate(None, 2026, title, None) == "ref2026"
        assert title.reads == 1
        assert generate([{"family": "Rodoreda"}], 2026, title, None) == "rodoreda2026"
        assert title.reads == 1


@pytest.mark.parametrize(
    "title,token,key",
    [
        ("The Great Gatsby", "Great", "great2026"),
        ("La plaça del Diamant", "plaça", "placa2026"),
        ("de la and y", "", "ref2026"),
        ("123 números", "123", "1232026"),
        (TitleString("Ànima"), "Ànima", "anima2026"),
    ],
)
def check_title_tokens_keep_names(title: object, token: str, key: str) -> None:
    from backend.domains.vault.citations import export_routes, keys

    assert keys.title_token(title) == export_routes._title_token(title) == token
    for generate in _generators():
        assert generate(None, 2026, title, None) == key


@pytest.mark.parametrize(
    "title,message",
    [
        (True, "expected string or bytes-like object, got 'bool'"),
        (2026, "expected string or bytes-like object, got 'int'"),
        (1.25, "expected string or bytes-like object, got 'float'"),
        (["Title"], "expected string or bytes-like object, got 'list'"),
        ({"title": "Title"}, "expected string or bytes-like object, got 'dict'"),
        (object(), "expected string or bytes-like object, got 'object'"),
        (b"Title", "cannot use a string pattern on a bytes-like object"),
        (bytearray(b"Title"), "cannot use a string pattern on a bytes-like object"),
        (memoryview(b"Title"), "cannot use a string pattern on a bytes-like object"),
        (array("B", b"Title"), "cannot use a string pattern on a bytes-like object"),
        (date(2026, 8, 31), "expected string or bytes-like object, got 'datetime.date'"),
        (
            datetime(2026, 8, 31, 12),
            "expected string or bytes-like object, got 'datetime.datetime'",
        ),
    ],
)
def check_invalid_titles_keep_interpretation_errors(title: object, message: str) -> None:
    from backend.domains.vault.citations import export_routes, keys

    for tokenize in (keys.title_token, export_routes._title_token):
        with pytest.raises(TypeError) as error:
            tokenize(title)
        assert str(error.value) == message
    for generate in _generators():
        assert generate([{"family": "Rodoreda"}], 2026, title, None) == "rodoreda2026"
        with pytest.raises(TypeError) as error:
            generate([{"family": "---"}], 2026, title, None)
        assert str(error.value) == message


def check_title_truthiness_errors_are_not_swallowed() -> None:
    from backend.domains.vault.citations import export_routes, keys

    for tokenize in (keys.title_token, export_routes._title_token):
        with pytest.raises(LookupError, match="raw title truthiness was evaluated"):
            tokenize(UnreadableTitle())
    for generate in _generators():
        with pytest.raises(LookupError, match="raw title truthiness was evaluated"):
            generate(None, 2026, UnreadableTitle(), None)


def check_unusable_buffers_fail_only_when_the_title_is_interpreted() -> None:
    from backend.domains.vault.citations import export_routes, keys

    strided = memoryview(b"Title")[::2]
    released = memoryview(b"Title")
    released.release()
    for tokenize in (keys.title_token, export_routes._title_token):
        with pytest.raises(TypeError) as buffer_error:
            tokenize(strided)
        assert str(buffer_error.value) == "expected string or bytes-like object, got 'memoryview'"
        with pytest.raises(ValueError) as released_error:
            tokenize(released)
        assert str(released_error.value) == "operation forbidden on released memoryview object"
    for generate in _generators():
        assert generate([{"family": "Rodoreda"}], 2026, strided, None) == "rodoreda2026"
        assert generate([{"family": "Rodoreda"}], 2026, released, None) == "rodoreda2026"


def check_collision_suffix_crosses_alphabet_without_mutating_keys() -> None:
    occupied = {
        "rodoreda2026",
        *(f"rodoreda2026{letter}" for letter in "abcdefghijklmnopqrstuvwxyz"),
    }
    occupied.add("rodoreda2026aa")
    for generate in _generators():
        assert (
            generate([{"family": "Rodoreda"}], "2026.0", UnreadableTitle(), occupied)
            == "rodoreda2026ab"
        )
    assert len(occupied) == 28 and "rodoreda2026ab" not in occupied


@pytest.mark.parametrize("name", ["Citation Key", "citationkey", "  CItation  KEY  "])
def check_property_accepts_real_registry_mapping_without_copying(name: str) -> None:
    from backend.domains.vault.citations.export_routes import _citation_key_prop_name

    extension = UnreadableTitle()
    property_record: dict[str, object] = {"name": name, "unknown": extension}
    properties: list[Mapping[str, object]] = [
        {"name": "Title", "unknown": extension},
        MappingProxyType(property_record),
    ]
    table: dict[str, object] = {"properties": properties, "unknown": extension}
    assert _citation_key_prop_name(table) is name
    assert _citation_key_prop_name(MappingProxyType(table)) is name
    assert table["properties"] is properties
    assert properties[1]["unknown"] is extension and table["unknown"] is extension
    assert property_record == {"name": name, "unknown": extension}
    assert len(table) == 2 and len(properties) == 2


@pytest.mark.parametrize("properties", [None, False, 0, "", [], ()])
def check_falsey_property_collections_keep_absence(properties: object) -> None:
    from backend.domains.vault.citations.export_routes import _citation_key_prop_name

    assert _citation_key_prop_name({"properties": properties}) is None
    assert _citation_key_prop_name({}) is None
    assert _citation_key_prop_name(None) is None


def check_property_name_preserves_spelling_identity_and_lazy_iteration() -> None:
    from backend.domains.vault.citations.export_routes import _citation_key_prop_name

    class PropertyName(str):
        pass

    name = PropertyName(" Citation KEY ")

    def properties() -> Iterator[Mapping[str, object]]:
        yield {"name": "Citation\tKey"}
        yield {"name": name}
        raise AssertionError("properties were inspected beyond the first match")

    source = properties()
    table: dict[str, object] = {"properties": source}
    assert _citation_key_prop_name(table) is name
    assert table["properties"] is source


def check_property_reads_keep_the_original_lookup_order() -> None:
    from backend.domains.vault.citations.export_routes import _citation_key_prop_name

    calls: list[str] = []
    original = " Citation Key "
    returned = "CITATION KEY"

    class Property(Mapping[str, object]):
        def __getitem__(self, key: str) -> object:
            calls.append(key)
            assert key == "name"
            return original if len(calls) == 1 else returned

        def __iter__(self) -> Iterator[str]:
            raise AssertionError("property fields must not be copied or enumerated")

        def __len__(self) -> int:
            raise AssertionError("property size must not be read")

    prop = Property()
    properties = [prop]
    table: dict[str, object] = {"properties": properties}
    assert _citation_key_prop_name(table) is returned
    assert calls == ["name", "name"]
    assert table["properties"] is properties and properties[0] is prop


def check_nonmatching_property_names_and_unknown_fields_are_preserved() -> None:
    from backend.domains.vault.citations.export_routes import _citation_key_prop_name

    names: list[object] = [None, False, 0, 42, [], "Citation-Key", "Other"]
    properties = [{"name": value} for value in names]
    table: dict[str, object] = {"properties": properties}
    assert _citation_key_prop_name(table) is None
    assert table["properties"] is properties
    assert [prop["name"] for prop in properties] == [
        None,
        False,
        0,
        42,
        [],
        "Citation-Key",
        "Other",
    ]


def check_export_wrappers_resolve_replaced_helpers_at_call_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.domains.vault.citations import export_routes, keys

    raw_title = UnreadableTitle()
    calls: list[object] = []

    def tokenize(title: object) -> str:
        calls.append(title)
        return "late-token"

    monkeypatch.setattr(keys, "title_token", tokenize)
    assert export_routes._title_token(raw_title) == "late-token"
    assert export_routes.generate_citation_key(None, 2026, raw_title) == "latetoken2026"
    assert calls[0] is raw_title and calls[1] is raw_title

    def generate(authors: object, year: object, title: object, existing: set[str] | None) -> str:
        assert title is raw_title
        return "late-key"

    monkeypatch.setattr(keys, "generate_citation_key", generate)
    assert export_routes.generate_citation_key(None, 2026, raw_title) == "late-key"
