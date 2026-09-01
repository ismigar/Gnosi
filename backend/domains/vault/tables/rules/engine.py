"""Stateful facade over typed database-rule domain services."""

from __future__ import annotations

import math
import re
import threading
from datetime import datetime
from operator import methodcaller
from pathlib import Path

from backend.domains.vault.registry.records import is_object_list, is_record
from backend.domains.vault.tables.rules import automations, definitions, records, rollups
from backend.domains.vault.tables.rules.types import (
    Definition,
    FunctionMap,
    Metadata,
    RuleEngineDependencies,
)


def _first(value: object) -> object:
    return value[0] if isinstance(value, list) and value else None


def _last(value: object) -> object:
    return value[-1] if isinstance(value, list) and value else None


def _average(value: object) -> object:
    return sum(value) / len(value) if isinstance(value, list) and value else 0


def _manual_suffix(key: object) -> object:
    """Retain the native endswith lookup, return value and errors of opaque keys."""
    result: object = methodcaller("endswith", "_manual")(key)
    return result


class RuleEngine:
    """Evaluate formulas, rollups, lookups and automations for one Vault."""

    def __init__(
        self,
        vault_path: Path,
        dependencies: RuleEngineDependencies,
    ) -> None:
        self.vault_path = vault_path
        self.dependencies = dependencies
        self.evaluator = dependencies.new_evaluator()
        self._setup_evaluator()
        self.registry = self._load_registry()
        self._lookup_cache: dict[tuple[str, str, str], object] = {}
        self._query_cache: dict[tuple[str, str, str | None], object] = {}
        self._current_note_id: str | None = None
        self._eval_lock = threading.Lock()

    def _setup_evaluator(self) -> None:
        functions: FunctionMap = {
            "prop": self._get_prop,
            "lookup": self._lookup,
            "query": self._query,
            "col_sum": self._col_sum,
            "col_avg": self._col_avg,
            "col_count": self._col_count,
            "col_min": self._col_min,
            "col_max": self._col_max,
            "first": _first,
            "last": _last,
            "len": len,
            "sum": sum,
            "avg": _average,
            "min": min,
            "max": max,
            "round": round,
            "abs": abs,
            "ceil": math.ceil,
            "floor": math.floor,
        }
        self.evaluator.functions = functions

    def _load_registry(self) -> Metadata:
        return records.load_registry(self.vault_path, self.dependencies.logger)

    def _resolve_table(self, metadata: Metadata) -> Metadata | None:
        return records.resolve_table(self.registry, metadata)

    def _resolve_table_by_id(self, table_id: str) -> Metadata | None:
        return records.resolve_table_by_id(self.registry, table_id)

    @staticmethod
    def _expression_has_cross_record_calls(expression: str) -> bool:
        return definitions.expression_has_cross_record_calls(expression)

    def table_has_cross_record_formulas(self, table_id: str) -> bool:
        self.registry = self._load_registry()
        table = self._resolve_table_by_id(table_id)
        if not table:
            return False
        formulas = self._extract_formula_definitions(table)
        if any(
            self._expression_has_cross_record_calls(str(definition.get("expression") or ""))
            for definition in formulas
        ):
            return True
        if self._extract_rollup_definitions(table):
            return True
        raw_automations = table.get("automations") or []
        if not is_object_list(raw_automations):
            return False
        return any(self._automation_has_cross_record_call(item) for item in raw_automations)

    def _automation_has_cross_record_call(self, automation: object) -> bool:
        if not is_record(automation):
            return False
        action = automation.get("action")
        expression = action.get("expression") if is_record(action) else None
        return self._expression_has_cross_record_calls(str(expression or ""))

    def _extract_formula_definitions(self, table: Metadata) -> list[Definition]:
        return definitions.extract_formula_definitions(table)

    def _extract_rollup_definitions(self, table: Metadata) -> list[Definition]:
        return definitions.extract_rollup_definitions(table)

    def _extract_dependencies(
        self,
        expression: str,
        known_fields: set[str],
        field_name: str,
    ) -> set[str]:
        return definitions.extract_dependencies(expression, known_fields, field_name)

    def _definition_dependencies(
        self,
        definition: Definition,
        known_fields: set[str],
    ) -> set[str]:
        return definitions.definition_dependencies(definition, known_fields)

    def _order_definitions(
        self,
        rule_definitions: list[Definition],
    ) -> tuple[list[Definition], list[Definition]]:
        return definitions.order_definitions(rule_definitions, self.dependencies.logger)

    @staticmethod
    def _is_missing(value: object) -> bool:
        return value is None or value == ""

    def _evaluate_expression(self, expression: str) -> object:
        parsed_expression = expression
        token_names: list[str] = []
        for index, raw_name in enumerate(re.findall(r"\{([^}]+)\}", expression)):
            field_name = (raw_name or "").strip()
            token = f"__field_{index}"
            self.evaluator.names[token] = self.evaluator.names.get(field_name)
            token_names.append(token)
            parsed_expression = parsed_expression.replace(f"{{{raw_name}}}", token)
        try:
            return self.evaluator.eval(parsed_expression)
        finally:
            for token in token_names:
                self.evaluator.names.pop(token, None)

    def _evaluate_derived(self, updated_metadata: Metadata, table: Metadata) -> Metadata:
        formula_definitions = self._extract_formula_definitions(table)
        rollup_definitions = self._extract_rollup_definitions(table)
        for definition in formula_definitions:
            definition["kind"] = "formula"
        for definition in rollup_definitions:
            definition["kind"] = "rollup"
        combined = formula_definitions + rollup_definitions
        if not combined:
            return updated_metadata
        ordered, cycles = self._order_definitions(combined)
        self.evaluator.names = dict(updated_metadata)
        for definition in ordered + cycles:
            self._apply_definition(definition, updated_metadata)
        return updated_metadata

    def _apply_definition(self, definition: Definition, updated_metadata: Metadata) -> None:
        if definition.get("kind") == "rollup":
            self._apply_rollup_definition(definition, updated_metadata)
        else:
            self._apply_formula_definition(definition, updated_metadata)

    def _apply_formula_definition(
        self,
        definition: Definition,
        updated_metadata: Metadata,
    ) -> None:
        property_name = str(definition["name"])
        expression = definition.get("expression")
        if not expression or not self._formula_should_run(definition, updated_metadata):
            return
        try:
            result = self._evaluate_expression(str(expression))
            updated_metadata[property_name] = result
            self.evaluator.names[property_name] = result
        except Exception as error:
            self.dependencies.logger.error(
                "Error evaluating formula '%s' for field '%s': %s",
                expression,
                property_name,
                error,
            )
            updated_metadata.setdefault(property_name, None)
            self.evaluator.names[property_name] = updated_metadata.get(property_name)

    def _formula_should_run(self, definition: Definition, metadata: Metadata) -> bool:
        property_name = str(definition["name"])
        if definition.get("mode") != "missing":
            return True
        if bool(metadata.get(f"{property_name}_manual")):
            return False
        return self._is_missing(metadata.get(property_name))

    @staticmethod
    def _normalize_record_ids(record_ids: object) -> list[str]:
        return definitions.normalize_record_ids(record_ids)

    @staticmethod
    def _is_truthy_checkbox(value: object) -> bool:
        return definitions.is_truthy_checkbox(value)

    @staticmethod
    def _as_datetime(value: object) -> datetime | None:
        return definitions.as_datetime(value)

    def _load_related_metadata(self, record_id: str) -> Metadata | None:
        if not record_id:
            return None
        record_path = self._find_record_path(record_id)
        if not record_path:
            return None
        try:
            return self._parse_metadata(record_path)
        except Exception:
            return None

    def _collect_rollup_values(
        self,
        definition: Definition,
        updated_metadata: Metadata,
    ) -> tuple[list[Metadata], list[object]]:
        return rollups.collect_rollup_values(
            definition,
            updated_metadata,
            self._load_related_metadata,
            self.evaluator.functions,
            self.dependencies,
        )

    def _evaluate_rollup_definition(
        self,
        definition: Definition,
        updated_metadata: Metadata,
    ) -> object:
        rows, values = self._collect_rollup_values(definition, updated_metadata)
        return rollups.evaluate_rollup_definition(definition, rows, values)

    def _apply_rollup_definition(
        self,
        definition: Definition,
        updated_metadata: Metadata,
    ) -> None:
        property_name = definition.get("name")
        if not property_name:
            return
        name = str(property_name)
        try:
            result = self._evaluate_rollup_definition(definition, updated_metadata)
            updated_metadata[name] = result
            self.evaluator.names[name] = result
        except Exception as error:
            self.dependencies.logger.warning(
                "Error evaluating rollup for field '%s': %s",
                name,
                error,
            )
            updated_metadata[name] = definition.get("fallback_value")
            self.evaluator.names[name] = updated_metadata.get(name)

    def _get_prop(self, name: str) -> object:
        return self.evaluator.names.get(name)

    def _lookup(self, table_id: str, record_ids: object, property_name: str) -> object:
        return records.lookup(
            table_id,
            record_ids,
            property_name,
            self._lookup_cache,
            self._find_record_path,
            self._parse_metadata,
            self.dependencies.logger,
        )

    def _query(
        self,
        table_id: str,
        filter_expr: str,
        property_name: str | None = None,
    ) -> object:
        return records.query(
            self.vault_path,
            table_id,
            filter_expr,
            property_name,
            self._query_cache,
            self._parse_metadata,
            self.evaluator.functions,
            self.dependencies,
        )

    def _current_table_id(self) -> object:
        value = self.evaluator.names.get("database_table_id") or self.evaluator.names.get(
            "table_id"
        )
        return value

    def _normalize_column_values(self, values: list[object]) -> list[float]:
        return records.normalize_column_values(values)

    def _collect_column_values(
        self,
        property_name: str,
        table_id: str | None = None,
        filter_expr: str | None = None,
    ) -> list[object]:
        effective_table_id = table_id or self._current_table_id()
        if not effective_table_id:
            return []
        return records.collect_column_values(
            self.vault_path,
            effective_table_id,
            property_name,
            filter_expr,
            self._current_note_id,
            dict(self.evaluator.names or {}),
            self._parse_metadata,
            self.evaluator.functions,
            self.dependencies,
        )

    def _col_sum(
        self,
        property_name: str,
        table_id: str | None = None,
        filter_expr: str | None = None,
    ) -> float:
        values = self._collect_column_values(property_name, table_id, filter_expr)
        return sum(self._normalize_column_values(values))

    def _col_avg(
        self,
        property_name: str,
        table_id: str | None = None,
        filter_expr: str | None = None,
    ) -> float:
        numbers = self._normalize_column_values(
            self._collect_column_values(property_name, table_id, filter_expr)
        )
        return sum(numbers) / len(numbers) if numbers else 0.0

    def _col_count(
        self,
        property_name: str,
        table_id: str | None = None,
        filter_expr: str | None = None,
    ) -> int:
        return len(self._collect_column_values(property_name, table_id, filter_expr))

    def _col_min(
        self,
        property_name: str,
        table_id: str | None = None,
        filter_expr: str | None = None,
    ) -> float | None:
        numbers = self._normalize_column_values(
            self._collect_column_values(property_name, table_id, filter_expr)
        )
        return min(numbers) if numbers else None

    def _col_max(
        self,
        property_name: str,
        table_id: str | None = None,
        filter_expr: str | None = None,
    ) -> float | None:
        numbers = self._normalize_column_values(
            self._collect_column_values(property_name, table_id, filter_expr)
        )
        return max(numbers) if numbers else None

    def _find_record_path(self, record_id: str) -> Path | None:
        return records.find_record_path(self.vault_path, record_id, self.dependencies)

    def _parse_metadata(self, path: Path) -> Metadata:
        return records.parse_metadata(path, self._resolve_table_by_id, self.dependencies)

    def process_updates(
        self,
        note_id: str,
        old_metadata: Metadata,
        request_metadata: Metadata,
    ) -> Metadata:
        with self._eval_lock:
            return self._process_updates_locked(note_id, old_metadata, request_metadata)

    def _process_updates_locked(
        self,
        note_id: str,
        old_metadata: Metadata,
        request_metadata: Metadata,
    ) -> Metadata:
        self.registry = self._load_registry()
        self._lookup_cache = {}
        self._query_cache = {}
        self._current_note_id = note_id
        updated_metadata = request_metadata.copy()
        self._preserve_manual_flags(old_metadata, updated_metadata)
        self._detect_manual_edits(old_metadata, request_metadata, updated_metadata)
        table = self._resolve_table(updated_metadata)
        if not table:
            return updated_metadata
        updated_metadata = self._evaluate_derived(updated_metadata, table)
        self.evaluator.names = dict(updated_metadata)
        self._run_automations(table, old_metadata, updated_metadata)
        return updated_metadata

    @staticmethod
    def _preserve_manual_flags(old_metadata: Metadata, updated_metadata: Metadata) -> None:
        for key, value in old_metadata.items():
            if _manual_suffix(key):
                updated_metadata[key] = value

    @staticmethod
    def _detect_manual_edits(
        old_metadata: Metadata,
        request_metadata: Metadata,
        updated_metadata: Metadata,
    ) -> None:
        for key, new_value in request_metadata.items():
            if key not in old_metadata:
                continue
            if definitions.canonical_for_compare(
                old_metadata[key]
            ) == definitions.canonical_for_compare(new_value):
                continue
            if not _manual_suffix(key) and key != "database_table_id":
                updated_metadata[f"{key}_manual"] = True

    def _run_automations(
        self,
        table: Metadata,
        old_metadata: Metadata,
        updated_metadata: Metadata,
    ) -> None:
        raw_automations = table.get("automations") or []
        if not is_object_list(raw_automations):
            return
        for raw_automation in raw_automations:
            if not is_record(raw_automation):
                continue
            self._run_automation(raw_automation, old_metadata, updated_metadata)

    def _run_automation(
        self,
        automation: Definition,
        old_metadata: Metadata,
        updated_metadata: Metadata,
    ) -> None:
        try:
            trigger = automation.get("trigger")
            typed_trigger = trigger if is_record(trigger) else {}
            if not self._automation_triggered(typed_trigger, old_metadata, updated_metadata):
                return
            raw_actions = automation.get("actions")
            actions = (
                raw_actions if is_object_list(raw_actions) else [automation.get("action", {})]
            )
            for action in actions:
                if is_record(action):
                    self._apply_automation_action(action, updated_metadata)
        except Exception as error:
            self.dependencies.logger.error(
                "Error processing automation %s: %s",
                automation.get("name", "?"),
                error,
            )

    def _automation_triggered(
        self,
        trigger: Definition,
        old_metadata: Metadata,
        metadata: Metadata,
    ) -> bool:
        return automations.automation_triggered(trigger, old_metadata, metadata)

    def _apply_automation_action(self, action: Definition, metadata: Metadata) -> None:
        automations.apply_automation_action(
            action,
            metadata,
            self.evaluator.names,
            self._evaluate_expression,
        )


__all__ = ["RuleEngine"]
