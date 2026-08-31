"""Synthetic open-record and native-protocol contracts for the rule engine."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import pytest

from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.tables.rules import automations, definitions, records, rollups
from backend.domains.vault.tables.rules.engine import RuleEngine as DomainRuleEngine
from backend.domains.vault.tables.rules.types import Evaluator, FunctionMap, Metadata
from backend.services import rule_engine


def _engine(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, table: RegistryData | None = None
) -> rule_engine.RuleEngine:
    engine = rule_engine.RuleEngine(tmp_path)
    registry: RegistryData = {"tables": [table] if table is not None else []}
    monkeypatch.setattr(engine, "_load_registry", lambda: registry)
    return engine


def test_process_updates_keeps_unknown_keys_and_native_copy_boundaries(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key = object()
    extension = object()
    prop: RegistryData = {
        "name": "computed",
        "type": "formula",
        "formula": "source * 2",
        key: extension,
    }
    table: RegistryData = {
        "id": "table",
        "properties": [prop],
        key: extension,
        "automations": [
            {
                "trigger": {"type": "always"},
                "actions": [
                    {"type": "set_property", "target": "opaque", "value": extension},
                    {"type": "increment", "target": "computed", "by": 3},
                ],
            }
        ],
    }
    engine = _engine(tmp_path, monkeypatch, table)
    metadata: Metadata = {"table_id": "table", "source": 5, key: extension, 7: extension}
    engine._lookup_cache[("old", "old", "old")] = extension
    old_cache = engine._lookup_cache
    result = engine.process_updates("synthetic", {}, metadata)
    assert result is not metadata
    assert result[key] is extension and result[7] is extension
    assert result["computed"] == 13
    assert result["opaque"] is extension
    assert "computed" not in metadata and "opaque" not in metadata
    assert engine.evaluator.names is not result
    assert engine.evaluator.names[key] is extension
    assert engine.evaluator.names[7] is extension
    assert engine.evaluator.names["computed"] == 13
    assert engine._lookup_cache is not old_cache and engine._lookup_cache == {}
    assert engine._current_note_id == "synthetic"


@pytest.mark.parametrize("key", [7, None, ("opaque",)])
def test_manual_flags_keep_native_error_for_non_string_existing_keys(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    key: object,
) -> None:
    engine = _engine(tmp_path, monkeypatch)
    with pytest.raises(AttributeError) as expected:
        eval("key.endswith('_manual')", {"key": key})
    metadata: Metadata = {key: "original"}
    with pytest.raises(type(expected.value)) as actual:
        engine.process_updates("synthetic", metadata, metadata)
    assert str(actual.value) == str(expected.value)
    assert metadata == {key: "original"}
    # The exception must still leave the process lock usable.
    assert engine.process_updates("next", {}, {}) == {}


class _Truth:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def __bool__(self) -> bool:
        self.events.append("truth")
        return True


class _ManualKey:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def endswith(self, suffix: str) -> object:
        assert suffix == "_manual"
        self.events.append("endswith")
        return _Truth(self.events)


def test_manual_suffix_preserves_custom_return_truth_and_key_identity() -> None:
    events: list[str] = []
    key = _ManualKey(events)
    value = object()
    old: Metadata = {key: value}
    updated: Metadata = {}
    DomainRuleEngine._preserve_manual_flags(old, updated)
    assert events == ["endswith", "truth"]
    assert next(iter(updated)) is key and updated[key] is value


@pytest.mark.parametrize("expression", ["1 / 0", "unknown_name + 1", "{missing} + 1"])
def test_formula_errors_keep_native_exception_and_clear_temporary_tokens(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    expression: str,
) -> None:
    engine = _engine(tmp_path, monkeypatch)
    key = object()
    marker = object()
    engine.evaluator.names = {key: marker}
    native_expression = expression.replace("{missing}", "__field_0")
    native_names: Metadata = {key: marker, "__field_0": None}
    native = rule_engine._scoped_evaluator(native_names, engine.evaluator.functions)
    with pytest.raises(Exception) as expected:
        native.eval(native_expression)
    with pytest.raises(type(expected.value)) as actual:
        engine._evaluate_expression(expression)
    assert str(actual.value) == str(expected.value)
    assert engine.evaluator.names == {key: marker}


def test_formula_result_remains_opaque_in_metadata_and_evaluator(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = _engine(tmp_path, monkeypatch)
    opaque = object()
    metadata: Metadata = {"source": opaque, 7: opaque}
    result = engine._evaluate_derived(
        metadata,
        {
            "properties": [{"name": "result", "type": "formula", "formula": "source"}],
        },
    )
    assert result is metadata
    assert result["result"] is opaque and engine.evaluator.names["result"] is opaque


class _SingleIterator(Iterator[object]):
    def __init__(self, values: list[object], events: list[str]) -> None:
        self.values = iter(values)
        self.events = events

    def __iter__(self) -> Iterator[object]:
        self.events.append("iterator-iter")
        raise AssertionError("A native for loop must not re-iterate this iterator")

    def __next__(self) -> object:
        return next(self.values)


class _ProtocolList(list[object]):
    def __init__(self, value: object, events: list[str]) -> None:
        super().__init__([value])
        self.value = value
        self.events = events

    def __iter__(self) -> Iterator[object]:
        self.events.append("list-iter")
        return _SingleIterator([self.value], self.events)


@pytest.mark.parametrize("operation", ["tables", "formulas", "rollups", "ids", "numbers"])
def test_guarded_list_loops_consume_iterator_exactly_once(operation: str) -> None:
    events: list[str] = []
    value: RegistryData = {
        "name": "result",
        "type": "formula",
        "formula": "1",
        7: object(),
    }
    source = _ProtocolList(value, events)
    if operation == "tables":
        assert records.registry_tables({"tables": source})[0] is value
    elif operation == "formulas":
        assert (
            definitions.extract_formula_definitions({"properties": source})[0]["name"] == "result"
        )
    elif operation == "rollups":
        value.update({"type": "rollup", "relationField": "related", "aggregation": "count_all"})
        assert definitions.extract_rollup_definitions({"properties": source})[0]["name"] == "result"
    elif operation == "ids":
        assert definitions.normalize_record_ids(source) == [str(value)]
    else:
        assert records.normalize_column_values([_ProtocolList("5", events)]) == [5.0]
    assert events == ["list-iter"]


class _LengthList(_ProtocolList):
    def __len__(self) -> int:
        self.events.append("list-length")
        return super().__len__()


@pytest.mark.parametrize("method", ["lookup", "rollup"])
def test_list_extension_keeps_native_iteration_and_length_hint(method: str) -> None:
    events: list[str] = []
    expected_events: list[str] = []
    value = object()
    expected: list[object] = []
    expected.extend(_LengthList(value, expected_events))
    values = _LengthList(value, events)
    if method == "lookup":
        output: list[object] = []
        records._extend_result(output, values)
    else:
        output = rollups._flatten([values])
    assert output == expected == [value]
    assert events == expected_events == ["list-iter", "list-length"]


def test_parse_preserves_object_keys_and_relation_callback_order(tmp_path: Path) -> None:
    path = tmp_path / "synthetic.md"
    path.write_text("---\n7: extension\ntable_id: 23\n---\nBody\n", encoding="utf-8")
    events: list[str] = []
    table: RegistryData = {11: "unknown"}
    seen: list[Metadata] = []

    def resolve(table_id: str) -> RegistryData:
        assert table_id == "23"
        events.append("resolve")
        return table

    def relation_keys(value: RegistryData | None) -> set[str]:
        assert value is table
        events.append("keys")
        return {"related"}

    def strip(metadata: Metadata, keys: set[str] | None) -> Metadata:
        assert metadata[7] == "extension" and keys == {"related"}
        events.append("strip")
        seen.append(metadata)
        return metadata

    dependencies = replace(
        rule_engine._dependencies(),
        relation_keys_from_table=relation_keys,
        strip_relation_wikilinks=strip,
    )
    metadata = records.parse_metadata(path, resolve, dependencies)
    assert metadata is seen[0]
    assert events == ["resolve", "keys", "strip"]


@pytest.mark.parametrize("yaml_value", ["42", "[1, 2]", "{broken"])
def test_malformed_or_scalar_metadata_keeps_empty_fallback(tmp_path: Path, yaml_value: str) -> None:
    path = tmp_path / "synthetic.md"
    path.write_text(f"---\n{yaml_value}\n---\nBody\n", encoding="utf-8")
    assert records.parse_metadata(path, lambda table_id: None, rule_engine._dependencies()) == {}


class _Resolver:
    def __init__(self, path: Path) -> None:
        self.path = path

    def find_path(self, record_id: str, vault_path: Path) -> Path:
        return self.path

    def list_all_files(self, vault_path: Path) -> list[Path]:
        return [self.path]


def test_query_reuses_metadata_and_function_map_and_caches_result_identity(tmp_path: Path) -> None:
    path = tmp_path / "synthetic.md"
    key = object()
    value = object()
    metadata: Metadata = {key: value, "database_table_id": "table", "field": value}
    functions: FunctionMap = {"opaque": lambda: value}
    calls: list[str] = []

    class Scoped:
        def __init__(self, names: Metadata, function_map: FunctionMap) -> None:
            self.names = names
            self.functions = function_map

        def eval(self, expression: str) -> object:
            assert expression == "predicate"
            assert self.names is metadata and self.functions is functions
            calls.append("eval")
            return True

    def scoped(names: Metadata, functions: FunctionMap) -> Evaluator:
        calls.append("scoped")
        return Scoped(names, functions)

    dependencies = replace(
        rule_engine._dependencies(), scoped_evaluator=scoped, path_resolver=lambda: _Resolver(path)
    )
    cache: dict[tuple[str, str, str | None], object] = {}
    result = records.query(
        tmp_path,
        "table",
        "predicate",
        "field",
        cache,
        lambda path: metadata,
        functions,
        dependencies,
    )
    assert result == [value]
    assert (
        records.query(
            tmp_path,
            "table",
            "predicate",
            "field",
            cache,
            lambda path: metadata,
            functions,
            dependencies,
        )
        is result
    )
    assert calls == ["scoped", "eval"]


def test_numeric_table_identifier_is_not_coerced_for_column_lookup(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = _engine(tmp_path, monkeypatch)
    path = tmp_path / "synthetic.md"
    engine.dependencies = replace(engine.dependencies, path_resolver=lambda: _Resolver(path))
    engine.evaluator.names = {"database_table_id": 23, "field": 4}
    monkeypatch.setattr(
        engine, "_parse_metadata", lambda path: {"database_table_id": 23, "field": 6}
    )
    assert engine._current_table_id() == 23
    assert engine._col_sum("field") == 10.0


class _Number:
    def __init__(self, events: list[str], label: str) -> None:
        self.events = events
        self.label = label

    def __float__(self) -> float:
        self.events.append(self.label)
        return 2.0


def test_increment_keeps_numeric_conversion_order_and_mutates_both_maps() -> None:
    events: list[str] = []
    metadata: Metadata = {"count": _Number(events, "current")}
    names: Metadata = {}
    action: RegistryData = {"type": "increment", "target": "count", "by": _Number(events, "by")}
    automations.apply_automation_action(action, metadata, names, lambda expression: None)
    assert events == ["by", "current"]
    assert metadata["count"] == names["count"] == 4


def test_rollup_preserves_opaque_fallback_identity_and_mixed_key_json_error() -> None:
    fallback = object()
    assert (
        rollups.evaluate_rollup_definition(
            {"aggregation": "min", "fallback_value": fallback}, [], []
        )
        is fallback
    )
    value: RegistryData = {7: "numeric", "text": "string"}
    with pytest.raises(TypeError) as expected:
        json.dumps(value, ensure_ascii=False, sort_keys=True)
    with pytest.raises(type(expected.value)) as actual:
        rollups.evaluate_rollup_definition({"aggregation": "show_original"}, [], [value])
    assert str(actual.value) == str(expected.value)


@pytest.mark.parametrize(
    "payload,expected",
    [
        ("{broken", {"databases": [], "tables": [], "views": []}),
        ("[]", {}),
        ('{"extension": 7}', {"extension": 7}),
    ],
)
def test_registry_json_keeps_existing_fallbacks(
    tmp_path: Path,
    payload: str,
    expected: RegistryData,
) -> None:
    (tmp_path / "vault_db_registry.json").write_text(payload, encoding="utf-8")
    assert records.load_registry(tmp_path, logging.getLogger(__name__)) == expected
