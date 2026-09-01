"""Synthetic open-record and native-error contracts for action rules."""

from __future__ import annotations

from collections.abc import Callable, Iterator

import pytest

from backend.domains.vault.registry.records import is_object_list, is_record
from backend.domains.vault.registry.state import RegistryData
from backend.services import action_rules as ar
from backend.services import option_catalogs as oc


def _outcome(operation: Callable[[], object]) -> tuple[object, ...]:
    try:
        return ("value", operation())
    except Exception as error:
        return (type(error), error.args)


def _native_get(value: object, key: object) -> object:
    result: object = eval("value.get(key)", {}, {"value": value, "key": key})
    return result


@pytest.mark.parametrize("root", [None, False, 0, "malformed", [], ()])
def test_seed_preserves_malformed_rule_root_and_native_error(root: object) -> None:
    opaque = object()
    table: RegistryData = {"translation_enabled": True, "action_rules": root, 7: opaque}
    assert _outcome(lambda: ar.ensure_action_rules(table)) == _outcome(
        lambda: _native_get(root, ar.ACTION_TRANSLATE)
    )
    assert table["action_rules"] is root and table[7] is opaque


@pytest.mark.parametrize("root", [None, False, 0, "malformed", [], ()])
def test_rule_lookup_keeps_default_identity_for_nonrecord_root(root: object) -> None:
    table: RegistryData = {"translation_enabled": True, "action_rules": root}
    assert (
        ar.get_action_rules(table, ar.ACTION_TRANSLATE)
        is ar.DEFAULT_ACTION_RULES[ar.ACTION_TRANSLATE]
    )
    table["translation_enabled"] = False
    assert ar.get_action_rules(table, ar.ACTION_TRANSLATE) is None


def test_rule_lookup_preserves_separate_get_and_item_reads() -> None:
    calls: list[tuple[str, object]] = []
    value = object()

    class Rules(dict[object, object]):
        def get(self, key: object, default: object = None) -> object:
            calls.append(("get", key))
            return {}

        def __getitem__(self, key: object) -> object:
            calls.append(("item", key))
            return value

    table: RegistryData = {"action_rules": Rules()}
    assert ar.get_action_rules(table, ar.ACTION_TRANSLATE) is value
    assert calls == [("get", ar.ACTION_TRANSLATE), ("item", ar.ACTION_TRANSLATE)]


def test_seed_copies_defaults_without_replacing_existing_records() -> None:
    opaque = object()
    existing: RegistryData = {None: opaque, "requires": []}
    rules: RegistryData = {ar.ACTION_TRANSLATE: existing, 7: opaque}
    table: RegistryData = {
        "translation_enabled": True,
        "drupal_sync_enabled": True,
        "action_rules": rules,
        None: opaque,
    }
    assert ar.ensure_action_rules(table)
    assert table["action_rules"] is rules and table[None] is opaque
    assert rules[ar.ACTION_TRANSLATE] is existing and rules[7] is opaque
    seeded = rules[ar.ACTION_SYNC_DRUPAL]
    assert is_record(seeded) and seeded is not ar.DEFAULT_ACTION_RULES[ar.ACTION_SYNC_DRUPAL]
    requirements = seeded["requires"]
    assert is_object_list(requirements)
    requirements.append({"synthetic": True})
    assert requirements != ar.DEFAULT_ACTION_RULES[ar.ACTION_SYNC_DRUPAL]["requires"]
    assert ar.ensure_action_rules(table) is False


class LegacyAliases:
    def __getitem__(self, index: int) -> str:
        return ["Former", "Older"][index]


def test_alias_reads_preserve_priority_legacy_iteration_and_identity() -> None:
    payload = [False, None, {"nested": 0}]
    prop: RegistryData = {"id": "fld_status", "name": "Current", "aliases": LegacyAliases()}
    metadata: RegistryData = {7: object(), "Former": payload}
    assert ar.read_prop_value(metadata, prop) is payload
    assert ar.effect_write_key(metadata, prop) == "Former"
    metadata["Current"] = False
    assert ar.read_prop_value(metadata, prop) is False
    assert ar.effect_write_key(metadata, prop) == "Current"
    metadata["fld_status"] = 0
    assert ar.read_prop_value(metadata, prop) == 0
    assert ar.effect_write_key(metadata, prop) == "fld_status"


@pytest.mark.parametrize("aliases", [7, True, object()])
def test_aliases_keep_noniterable_failure(aliases: object) -> None:
    prop: RegistryData = {"id": "fld_status", "aliases": aliases}
    expected = _outcome(lambda: eval("iter(aliases)", {}, {"aliases": aliases}))
    assert _outcome(lambda: ar.read_prop_value({}, prop)) == expected
    assert _outcome(lambda: ar.effect_write_key({}, prop)) == expected


@pytest.mark.parametrize("effects", [7, True, "bad", [1]])
def test_effects_keep_native_error_for_truthy_nonmapping_root(effects: object) -> None:
    table: RegistryData = {"action_rules": {ar.ACTION_TRANSLATE: {"effects": effects}}}
    assert _outcome(lambda: ar.status_effect(table, ar.ACTION_TRANSLATE, "source")) == _outcome(
        lambda: _native_get(effects, "source")
    )


@pytest.mark.parametrize("key", ["requires", "on_stale"])
@pytest.mark.parametrize("value", [7, True, object()])
def test_rule_lists_keep_native_iteration_error(key: str, value: object) -> None:
    table: RegistryData = {"action_rules": {ar.ACTION_TRANSLATE: {key: value}}}
    operation = (
        (lambda: ar.check_requires(table, ar.ACTION_TRANSLATE, {}))
        if key == "requires"
        else (lambda: ar.on_stale_effect(table))
    )
    assert _outcome(operation) == _outcome(lambda: eval("iter(value)", {}, {"value": value}))


@pytest.mark.parametrize("stale", [False, True])
def test_effect_preserves_config_identity_and_normalizer_capture(
    monkeypatch: pytest.MonkeyPatch, stale: bool
) -> None:
    calls: list[str] = []
    assigned: list[object] = []

    def normalize(raw: object) -> list[RegistryData]:
        calls.append("normalize")
        assert raw == []
        return []

    def wrong_normalize(raw: object) -> list[RegistryData]:
        raise AssertionError("Normalizer resolved after evaluating its argument")

    class Config:
        def get(self, key: object) -> object:
            calls.append("get")
            assert key == "options"
            monkeypatch.setattr(oc, "normalize_options", wrong_normalize)
            return []

        def __setitem__(self, key: object, value: object) -> None:
            calls.append("set")
            assert key == "options"
            assigned.append(value)

    config = Config()
    prop: RegistryData = {"id": "status", "type": "status", "config": config}
    table: RegistryData = {"translation_enabled": True}
    monkeypatch.setattr(oc, "find_role_prop", lambda _table, _role: prop)
    monkeypatch.setattr(oc, "normalize_options", normalize)
    result = (
        ar.on_stale_effect(table)
        if stale
        else ar.status_effect(table, ar.ACTION_TRANSLATE, "source")
    )
    expected = oc.STATUS_DRAFT if stale else oc.STATUS_TRANSLATED
    assert result == (prop, expected, True)
    assert result[0] is prop and prop["config"] is config
    assert calls == ["get", "normalize", "set"]
    assert assigned == [[{"name": expected, "color": oc.auto_color(expected)}]]


@pytest.mark.parametrize("stale", [False, True])
@pytest.mark.parametrize("config", [None, False, 0, "bad", []])
def test_effect_keeps_native_config_failure(
    monkeypatch: pytest.MonkeyPatch, stale: bool, config: object
) -> None:
    prop: RegistryData = {"type": "status", "config": config}
    table: RegistryData = {"translation_enabled": True}
    monkeypatch.setattr(oc, "find_role_prop", lambda _table, _role: prop)
    operation = (
        (lambda: ar.on_stale_effect(table))
        if stale
        else (lambda: ar.status_effect(table, ar.ACTION_TRANSLATE, "source"))
    )
    assert _outcome(operation) == _outcome(lambda: _native_get(config, "options"))
    assert prop["config"] is config


@pytest.mark.parametrize("metadata", [None, False, 0, 7, "name", "other", ["name"], []])
def test_property_read_keeps_native_membership_before_get(metadata: object) -> None:
    prop: RegistryData = {"name": "name"}

    def native() -> object:
        result: object = eval(
            "metadata.get('name') if 'name' in (metadata or {}) else None",
            {},
            {"metadata": metadata},
        )
        return result

    assert _outcome(lambda: ar.read_prop_value(metadata, prop)) == _outcome(native)


def test_property_read_preserves_custom_membership_and_get_order() -> None:
    events: list[str] = []
    opaque = object()

    class Metadata:
        def __bool__(self) -> bool:
            events.append("bool")
            return True

        def __contains__(self, key: object) -> bool:
            events.append("contains")
            return True

        def get(self, key: object) -> object:
            events.append("get")
            return opaque

    assert ar.read_prop_value(Metadata(), {"name": "name"}) is opaque
    assert events == ["bool", "contains", "get"]


class IterationProbe(Iterator[object]):
    def __init__(self, values: list[object]) -> None:
        self.values = values
        self.position = 0
        self.events: list[str] = []

    def __iter__(self) -> Iterator[object]:
        self.events.append("iter")
        return self

    def __next__(self) -> object:
        self.events.append("next")
        if self.position >= len(self.values):
            raise StopIteration
        result = self.values[self.position]
        self.position += 1
        return result


@pytest.mark.parametrize("operation", ["read", "write_key", "requires", "status", "stale"])
def test_each_native_rule_iteration_runs_once(operation: str) -> None:
    values = IterationProbe(["Legacy"] if operation in {"read", "write_key"} else [None])
    prop: RegistryData = {"name": "name", "aliases": values}
    if operation == "read":
        assert ar.read_prop_value({"Legacy": 7}, prop) == 7
    elif operation == "write_key":
        assert ar.effect_write_key({"Legacy": 7}, prop) == "Legacy"
    elif operation == "requires":
        assert ar.check_requires(
            {"action_rules": {ar.ACTION_TRANSLATE: {"requires": values}}}, ar.ACTION_TRANSLATE, {}
        ) == (True, None)
    elif operation == "status":
        assert ar.status_effect(
            {"action_rules": {ar.ACTION_TRANSLATE: {"effects": {"source": values}}}},
            ar.ACTION_TRANSLATE,
            "source",
        ) == (None, None, False)
    else:
        assert ar.on_stale_effect(
            {"action_rules": {ar.ACTION_TRANSLATE: {"on_stale": values}}}
        ) == (None, None, False)
    assert values.events == ["iter", "next", "next"]
