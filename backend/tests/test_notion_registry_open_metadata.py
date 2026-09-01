"""Notion verification reads open registries through its late-bound facade."""

from __future__ import annotations

from collections.abc import Callable

import pytest

from backend.api import notion_routes, vault_routes
from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData


def _outcome(operation: Callable[[], object]) -> tuple[object, ...]:
    try:
        return ("value", operation())
    except Exception as error:
        return (type(error), error.args)


def test_verification_registry_callback_copies_root_only_and_resolves_late(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    marker = object()
    tables: list[object] = [{"id": "synthetic", None: marker}]
    registry: RegistryData = {7: marker, "tables": tables}
    dependencies = notion_routes._verification_dependencies()

    def load() -> RegistryData:
        calls.append("load")
        return registry

    monkeypatch.setattr(vault_routes, "load_registry", load)
    copied: object = dependencies.load_registry()
    assert is_record(copied)
    assert copied is not registry and copied[7] is marker and copied["tables"] is tables
    assert calls == ["load"]
    copied[None] = marker
    assert None not in registry


@pytest.mark.parametrize("root", [None, False, 7, "bad", [], [(7, "value")], [(7,)]])
def test_verification_registry_copy_keeps_native_dict_contract(
    monkeypatch: pytest.MonkeyPatch, root: object
) -> None:
    dependencies = notion_routes._verification_dependencies()
    monkeypatch.setattr(vault_routes, "load_registry", lambda: root)

    def native() -> object:
        result: object = eval("dict(root)", {}, {"root": root})
        return result

    assert _outcome(dependencies.load_registry) == _outcome(native)
