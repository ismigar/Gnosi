import logging
import json
import yaml
import re
import math
import threading
from datetime import datetime
from pathlib import Path
from collections import deque
from typing import Dict, Any, List, Optional, Set, Tuple
from simpleeval import SimpleEval, NameNotDefined

from backend.services.path_resolver import path_resolver
from backend.services.relation_links import (
    relation_keys_from_table,
    strip_relation_wikilinks,
)

log = logging.getLogger(__name__)

class RuleEngine:
    def __init__(self, vault_path: Path):
        self.vault_path = vault_path
        self.evaluator = SimpleEval()
        self._setup_evaluator()
        self.registry = self._load_registry()
        self._lookup_cache: Dict[Tuple[str, str, str], Any] = {}
        self._query_cache: Dict[Tuple[str, str, Optional[str]], Any] = {}
        self._current_note_id: Optional[str] = None
        # The RuleEngine instance is cached per vault in vault_routes.py and
        # shared between requests. Without a lock, two concurrent `process_updates`
        # would clobber `_current_note_id` and the `_lookup_cache`/`_query_cache` caches
        # → formulas return values from another note. The lock serializes
        # the evaluation; since this only happens on saves (not reads), it isn't a
        # practical bottleneck.
        self._eval_lock = threading.Lock()

    def _setup_evaluator(self):
        """Register custom functions for formula evaluation."""
        self.evaluator.functions = {
            "prop": self._get_prop,
            "lookup": self._lookup,
            "query": self._query,
            "col_sum": self._col_sum,
            "col_avg": self._col_avg,
            "col_count": self._col_count,
            "col_min": self._col_min,
            "col_max": self._col_max,
            "first": lambda x: x[0] if isinstance(x, list) and x else None,
            "last": lambda x: x[-1] if isinstance(x, list) and x else None,
            "len": len,
            "sum": sum,
            "avg": lambda x: (sum(x) / len(x)) if isinstance(x, list) and x else 0,
            "min": min,
            "max": max,
            "round": round,
            "abs": abs,
            "ceil": math.ceil,
            "floor": math.floor,
        }

    def _load_registry(self) -> Dict[str, Any]:
        if not self.vault_path:
            return {"databases": [], "tables": [], "views": []}
            
        registry_path = self.vault_path / "vault_db_registry.json"
        if not registry_path.exists():
            return {"databases": [], "tables": [], "views": []}
        try:
            return json.loads(registry_path.read_text(encoding="utf-8"))
        except Exception as e:
            log.error(f"Error loading registry in RuleEngine: {e}")
            return {"databases": [], "tables": [], "views": []}

    def _resolve_table(self, metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        table_id = metadata.get("database_table_id") or metadata.get("table_id")
        if not table_id:
            return None
        return next((t for t in self.registry.get("tables", []) if t.get("id") == table_id), None)

    def _resolve_table_by_id(self, table_id: str) -> Optional[Dict[str, Any]]:
        if not table_id:
            return None
        return next((t for t in self.registry.get("tables", []) if t.get("id") == table_id), None)

    @staticmethod
    def _expression_has_cross_record_calls(expression: str) -> bool:
        if not expression:
            return False
        normalized = str(expression).lower()
        return "lookup(" in normalized or "query(" in normalized

    def table_has_cross_record_formulas(self, table_id: str) -> bool:
        # Registry can change while the app is running.
        self.registry = self._load_registry()
        table = self._resolve_table_by_id(table_id)
        if not table:
            return False

        for definition in self._extract_formula_definitions(table):
            if self._expression_has_cross_record_calls(definition.get("expression", "")):
                return True

        if self._extract_rollup_definitions(table):
            return True

        for automation in table.get("automations", []):
            expr = automation.get("action", {}).get("expression")
            if self._expression_has_cross_record_calls(expr):
                return True

        return False

    def _extract_formula_definitions(self, table: Dict[str, Any]) -> List[Dict[str, Any]]:
        definitions: List[Dict[str, Any]] = []

        for prop in table.get("properties", []):
            prop_name = prop.get("name")
            if not prop_name:
                continue

            prop_type = prop.get("type")
            prop_config = prop.get("config") if isinstance(prop.get("config"), dict) else {}
            formula_expr = (
                prop.get("formula")
                or prop.get("formula_config", {}).get("expression")
                or prop_config.get("formula")
            )
            default_formula_expr = (
                prop.get("defaultFormula")
                or prop.get("formula_config", {}).get("defaultFormula")
                or prop_config.get("defaultFormula")
            )

            # Formula field: always recalculated (read-only semantics)
            if formula_expr and prop_type == "formula":
                definitions.append({
                    "name": prop_name,
                    "expression": formula_expr,
                    "mode": "always",
                })
                continue

            # Optional formula on non-formula fields: only fill missing values
            if default_formula_expr:
                definitions.append({
                    "name": prop_name,
                    "expression": default_formula_expr,
                    "mode": "missing",
                })

        return definitions

    def _extract_rollup_definitions(self, table: Dict[str, Any]) -> List[Dict[str, Any]]:
        definitions: List[Dict[str, Any]] = []

        for prop in table.get("properties", []):
            prop_name = prop.get("name")
            if not prop_name:
                continue
            if prop.get("type") != "rollup":
                continue

            prop_config = prop.get("config") if isinstance(prop.get("config"), dict) else {}
            rollup_config = prop.get("rollup") if isinstance(prop.get("rollup"), dict) else {}

            relation_field = (
                prop.get("relationField")
                or prop_config.get("relationField")
                or rollup_config.get("relationField")
            )
            target_property = (
                prop.get("targetProperty")
                or prop_config.get("targetProperty")
                or rollup_config.get("targetProperty")
            )
            aggregation = (
                prop.get("aggregation")
                or prop_config.get("aggregation")
                or rollup_config.get("aggregation")
                or "count_values"
            )

            if not relation_field:
                continue
            if aggregation != "count_all" and not target_property:
                continue

            definitions.append({
                "name": prop_name,
                "relation_field": relation_field,
                "target_property": target_property,
                "aggregation": str(aggregation).strip().lower(),
                "filter_expression": (
                    prop.get("filterExpression")
                    or prop_config.get("filterExpression")
                    or rollup_config.get("filterExpression")
                ),
                "limit": (
                    prop.get("limit")
                    or prop_config.get("limit")
                    or rollup_config.get("limit")
                ),
                "fallback_value": (
                    prop.get("fallbackValue")
                    if "fallbackValue" in prop
                    else prop_config.get("fallbackValue", rollup_config.get("fallbackValue"))
                ),
            })

        return definitions

    def _extract_dependencies(self, expression: str, known_fields: Set[str], field_name: str) -> Set[str]:
        deps: Set[str] = set()
        if not expression:
            return deps

        # Placeholder syntax: {Field With Spaces}
        for raw in re.findall(r"\{([^}]+)\}", expression):
            name = (raw or "").strip()
            if name in known_fields and name != field_name:
                deps.add(name)

        # prop("field") or prop('field')
        for raw in re.findall(r"prop\(\s*['\"]([^'\"]+)['\"]\s*\)", expression):
            name = (raw or "").strip()
            if name in known_fields and name != field_name:
                deps.add(name)

        # Bare identifiers for simple formulas: total = preu * quantitat
        reserved = {
            "prop", "lookup", "query", "first", "last", "len", "sum",
            "avg", "min", "max", "abs", "round", "ceil", "floor",
            "col_sum", "col_avg", "col_count", "col_min", "col_max",
            "and", "or", "not", "true", "false", "none"
        }
        for ident in re.findall(r"\b[A-Za-z_][A-Za-z0-9_]*\b", expression):
            if ident in reserved:
                continue
            if ident in known_fields and ident != field_name:
                deps.add(ident)

        return deps

    def _evaluate_expression(self, expression: str) -> Any:
        parsed_expression = expression
        placeholder_index = 0

        # Support frontend syntax with placeholders like {Field}.
        token_names: List[str] = []
        for raw in re.findall(r"\{([^}]+)\}", expression):
            field_name = (raw or "").strip()
            token = f"__field_{placeholder_index}"
            placeholder_index += 1
            self.evaluator.names[token] = self.evaluator.names.get(field_name)
            token_names.append(token)
            parsed_expression = parsed_expression.replace(f"{{{raw}}}", token)

        try:
            return self.evaluator.eval(parsed_expression)
        finally:
            for token in token_names:
                self.evaluator.names.pop(token, None)

    def _definition_dependencies(self, definition: Dict[str, Any], known_fields: Set[str]) -> Set[str]:
        """Derived-field dependencies for the unified evaluation graph.

        A **formula** depends on any derived field referenced in its expression
        (other formulas *and* rollups). A **rollup** depends on the derived
        field it reads as its `relation_field` (the local field holding the
        related record ids); this is the rollup→formula edge that lets a formula
        feed a rollup. Rollups aggregate *related* rows, so their
        `target_property`/`filter_expression` resolve against those rows, not the
        current record, and never introduce a local dependency.
        """
        name = definition.get("name")
        if definition.get("kind") == "rollup":
            deps: Set[str] = set()
            relation_field = definition.get("relation_field")
            if relation_field and relation_field != name and relation_field in known_fields:
                deps.add(relation_field)
            return deps
        return self._extract_dependencies(definition.get("expression", ""), known_fields, name)

    def _order_definitions(self, definitions: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        if not definitions:
            return [], []

        by_name: Dict[str, Dict[str, Any]] = {d["name"]: d for d in definitions}
        known = set(by_name.keys())

        deps_by_name: Dict[str, Set[str]] = {
            name: self._definition_dependencies(defn, known)
            for name, defn in by_name.items()
        }

        indegree: Dict[str, int] = {name: len(deps) for name, deps in deps_by_name.items()}
        outgoing: Dict[str, Set[str]] = {name: set() for name in by_name.keys()}
        for name, deps in deps_by_name.items():
            for dep in deps:
                outgoing[dep].add(name)

        queue = deque(sorted([name for name, degree in indegree.items() if degree == 0]))
        ordered_names: List[str] = []

        while queue:
            current = queue.popleft()
            ordered_names.append(current)
            for nxt in sorted(outgoing[current]):
                indegree[nxt] -= 1
                if indegree[nxt] == 0:
                    queue.append(nxt)

        cycle_names = [name for name in by_name.keys() if name not in ordered_names]
        if cycle_names:
            log.warning(f"RuleEngine detected derived-field cycle (formula/rollup) for fields: {cycle_names}")

        ordered = [by_name[name] for name in ordered_names]
        cycle_defs = [by_name[name] for name in cycle_names]
        return ordered, cycle_defs

    @staticmethod
    def _is_missing(value: Any) -> bool:
        return value is None or value == ""

    def _evaluate_derived(self, updated_metadata: Dict[str, Any], table: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate formulas **and** rollups in one unified dependency order.

        Previously formulas ran fully before rollups, so a formula that read a
        rollup saw the stale on-disk (or `None`) rollup value — the formula
        lagged one save behind the rollup, silently persisting wrong data. Here
        both kinds share a single topological sort (`_order_definitions` via
        `_definition_dependencies`): a formula that depends on a rollup is
        computed *after* it, and a rollup whose `relation_field` is a formula is
        computed *after* that formula. Cycles are detected and evaluated in one
        bounded pass instead of looping forever.
        """
        formula_defs = self._extract_formula_definitions(table)
        rollup_defs = self._extract_rollup_definitions(table)
        for defn in formula_defs:
            defn["kind"] = "formula"
        for defn in rollup_defs:
            defn["kind"] = "rollup"

        definitions = formula_defs + rollup_defs
        if not definitions:
            return updated_metadata

        ordered, cycle_defs = self._order_definitions(definitions)

        # Seed the evaluation scope with the latest user edit before we start;
        # each applied definition then refreshes it so the next one reads fresh.
        self.evaluator.names = dict(updated_metadata)

        for definition in ordered:
            self._apply_definition(definition, updated_metadata)

        # Cyclic dependencies: one bounded pass, order not guaranteed, but no
        # hard failure and deterministic persistence.
        for definition in cycle_defs:
            self._apply_definition(definition, updated_metadata)

        return updated_metadata

    def _apply_definition(self, definition: Dict[str, Any], updated_metadata: Dict[str, Any]) -> None:
        """Evaluate a single derived field in place, dispatching by kind."""
        if definition.get("kind") == "rollup":
            self._apply_rollup_definition(definition, updated_metadata)
        else:
            self._apply_formula_definition(definition, updated_metadata)

    def _apply_formula_definition(self, definition: Dict[str, Any], updated_metadata: Dict[str, Any]) -> None:
        prop_name = definition["name"]
        mode = definition.get("mode")
        expression = definition.get("expression")
        if not expression:
            return

        is_manual = bool(updated_metadata.get(f"{prop_name}_manual"))
        # `always` formulas ignore manual flags (calculated source of truth);
        # `missing` (defaultFormula) only fills an empty, non-manual value.
        if mode == "missing":
            if is_manual:
                return
            if not self._is_missing(updated_metadata.get(prop_name)):
                return

        try:
            result = self._evaluate_expression(expression)
            updated_metadata[prop_name] = result
            self.evaluator.names[prop_name] = result
        except Exception as e:
            log.error(f"Error evaluating formula '{expression}' for field '{prop_name}': {e}")
            updated_metadata.setdefault(prop_name, None)
            self.evaluator.names[prop_name] = updated_metadata.get(prop_name)

    @staticmethod
    def _normalize_record_ids(record_ids: Any) -> List[str]:
        if record_ids is None or record_ids == "":
            return []
        if isinstance(record_ids, list):
            return [str(rid).strip() for rid in record_ids if str(rid).strip()]
        if isinstance(record_ids, str) and "," in record_ids:
            return [rid.strip() for rid in record_ids.split(",") if rid.strip()]
        return [str(record_ids).strip()]

    @staticmethod
    def _is_truthy_checkbox(value: Any) -> bool:
        # 1:1 parity with the other THREE checkbox sources of truth —
        # asBool (vaultFilters.js), FILTER_TRUTHY (DbViewEmbed) i _TRUTHY
        # (view_snapshot) — which include the ACCENTED "sí" and require
        # parity with this function. Without "sí", a checkbox saved in
        # Catalan counted as checked in filters/views/snapshot but NOT in the
        # rollup percent_checked (percentatge infravalorat en silenci).
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        normalized = str(value or "").strip().lower()
        return normalized in {"true", "1", "yes", "si", "sí", "done", "checked", "completat"}

    @staticmethod
    def _as_datetime(value: Any) -> Optional[datetime]:
        if value is None or value == "":
            return None
        if isinstance(value, datetime):
            return value
        text = str(value).strip()
        if not text:
            return None
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00"))
        except Exception:
            return None

    def _load_related_metadata(self, record_id: str) -> Optional[Dict[str, Any]]:
        if not record_id:
            return None
        record_path = self._find_record_path(record_id)
        if not record_path:
            return None
        try:
            return self._parse_metadata(record_path)
        except Exception:
            return None

    def _collect_rollup_values(self, definition: Dict[str, Any], updated_metadata: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Any]]:
        relation_ids = self._normalize_record_ids(updated_metadata.get(definition.get("relation_field")))
        filter_expression = definition.get("filter_expression")
        target_property = definition.get("target_property")

        related_rows: List[Dict[str, Any]] = []
        values: List[Any] = []

        for rid in relation_ids:
            metadata = self._load_related_metadata(rid)
            if not metadata:
                continue

            if filter_expression:
                try:
                    filter_eval = SimpleEval(names=metadata, functions=self.evaluator.functions)
                    if not bool(filter_eval.eval(filter_expression)):
                        continue
                except Exception:
                    continue

            related_rows.append(metadata)
            if target_property == "title":
                values.append(metadata.get("title"))
            elif target_property:
                values.append(metadata.get(target_property))

        limit = definition.get("limit")
        try:
            if limit is not None:
                lim = int(limit)
                if lim >= 0:
                    related_rows = related_rows[:lim]
                    values = values[:lim]
        except Exception:
            pass

        return related_rows, values

    def _evaluate_rollup_definition(self, definition: Dict[str, Any], updated_metadata: Dict[str, Any]) -> Any:
        aggregation = definition.get("aggregation", "count_values")
        related_rows, values = self._collect_rollup_values(definition, updated_metadata)

        fallback_provided = "fallback_value" in definition and definition.get("fallback_value") is not None
        fallback_value = definition.get("fallback_value")

        def with_fallback(default_value: Any) -> Any:
            return fallback_value if fallback_provided else default_value

        if aggregation == "count_all":
            return len(related_rows)

        flat_values: List[Any] = []
        for value in values:
            if isinstance(value, list):
                flat_values.extend(value)
            else:
                flat_values.append(value)

        non_empty = [value for value in flat_values if value is not None and value != ""]

        if aggregation == "count_values":
            return len(non_empty)

        if aggregation == "show_original":
            if not non_empty:
                return with_fallback([])
            unique: List[Any] = []
            seen: Set[str] = set()
            for value in non_empty:
                token = json.dumps(value, ensure_ascii=False, sort_keys=True) if isinstance(value, dict) else str(value)
                if token in seen:
                    continue
                seen.add(token)
                unique.append(value)
            return unique

        if aggregation == "unique_count":
            if not non_empty:
                return with_fallback(0)
            unique_tokens = {
                json.dumps(value, ensure_ascii=False, sort_keys=True) if isinstance(value, dict) else str(value)
                for value in non_empty
            }
            return len(unique_tokens)

        if aggregation == "percent_checked":
            # Denominator = ALL related records (like Notion and like the
            # frontend's live calculation `evaluateRollup`, which divides by
            # `values.length`), NOT just the ones whose checkbox has a value.
            # An unchecked checkbox is often saved as absent/empty; using
            # `len(non_empty)` excluded it from the denominator, inflating the percentage
            # and making it diverge from the value shown live (e.g. 2 of 4 → 66,67%
            # persisted vs 50% live). See `_is_truthy_checkbox` for the
            # parity with the "checked" condition.
            if not flat_values:
                return with_fallback(0)
            checked = sum(1 for value in flat_values if self._is_truthy_checkbox(value))
            return round((checked * 100.0) / len(flat_values), 2)

        if aggregation in {"earliest", "latest"}:
            dates = [self._as_datetime(value) for value in non_empty]
            dates = [dt for dt in dates if dt is not None]
            if not dates:
                return with_fallback(None)
            dt_value = min(dates) if aggregation == "earliest" else max(dates)
            return dt_value.isoformat()

        numeric_values: List[float] = []
        for value in non_empty:
            try:
                numeric_values.append(float(value))
            except Exception:
                continue

        if aggregation == "sum":
            if not numeric_values:
                return with_fallback(0)
            return sum(numeric_values)
        if aggregation == "avg":
            if not numeric_values:
                return with_fallback(0)
            return sum(numeric_values) / len(numeric_values)
        if aggregation == "min":
            if not numeric_values:
                return with_fallback(None)
            return min(numeric_values)
        if aggregation == "max":
            if not numeric_values:
                return with_fallback(None)
            return max(numeric_values)

        return with_fallback(None)

    def _apply_rollup_definition(self, definition: Dict[str, Any], updated_metadata: Dict[str, Any]) -> None:
        prop_name = definition.get("name")
        if not prop_name:
            return
        try:
            result = self._evaluate_rollup_definition(definition, updated_metadata)
            updated_metadata[prop_name] = result
            self.evaluator.names[prop_name] = result
        except Exception as e:
            log.warning(f"Error evaluating rollup for field '{prop_name}': {e}")
            updated_metadata[prop_name] = definition.get("fallback_value")
            self.evaluator.names[prop_name] = updated_metadata.get(prop_name)

    def _get_prop(self, name: str) -> Any:
        """Helper to get property value from current context."""
        return self.evaluator.names.get(name)

    def _lookup(self, table_id: str, record_ids: Any, property_name: str) -> Any:
        """Look up a property value in another table's records."""
        if not record_ids:
            return None
        
        # If record_ids is a single string, wrap it in a list
        ids = record_ids if isinstance(record_ids, list) else [record_ids]
        
        results = []
        for rid in ids:
            cache_key = (table_id or "", str(rid), property_name)
            if cache_key in self._lookup_cache:
                cached_value = self._lookup_cache[cache_key]
                if cached_value is not None:
                    if isinstance(cached_value, list):
                        results.extend(cached_value)
                    else:
                        results.append(cached_value)
                continue

            record_path = self._find_record_path(rid)
            if not record_path:
                self._lookup_cache[cache_key] = None
                continue
            
            try:
                metadata = self._parse_metadata(record_path)
                val = metadata.get(property_name)
                self._lookup_cache[cache_key] = val
                # Always append the cached result (incl. falsy: 0, "", False). Only skip None.
                # Without this, the 1st call omitted falsy values; the 2nd call (cache hit) included them → non-deterministic.
                if val is not None:
                    if isinstance(val, list):
                        results.extend(val)
                    else:
                        results.append(val)
            except Exception as e:
                log.warning(f"Error in lookup for {rid}: {e}")
                self._lookup_cache[cache_key] = None
        
        # Return list if multiple, else single value
        if not results: return None
        # Remove duplicates while preserving order. Composite image fields are dicts
        # (non-hashable): if the first value is a dict, we keep the list as is; if it's
        # scalar but there's a dict further back, `dict.fromkeys` would blow up with a TypeError,
        # so we do manual dedup by equality as a fallback.
        if isinstance(results[0], dict):
            unique_results = list(results)
        else:
            try:
                unique_results = list(dict.fromkeys(results))
            except TypeError:
                unique_results = []
                for r in results:
                    if r not in unique_results:
                        unique_results.append(r)
        return unique_results if len(ids) > 1 or len(unique_results) > 1 else (unique_results[0] if unique_results else None)

    def _query(self, table_id: str, filter_expr: str, property_name: Optional[str] = None) -> Any:
        """Query all records in a table using an expression."""
        if not self.vault_path:
            return []
            
        cache_key = (table_id, filter_expr, property_name)
        if cache_key in self._query_cache:
            return self._query_cache[cache_key]

        results = []
        # Optimization: Use PathResolver instead of slow rglob
        all_files = path_resolver.list_all_files(self.vault_path)
        
        for p in all_files:
            try:
                metadata = self._parse_metadata(p)
                if metadata.get("database_table_id") == table_id:
                    # Temporary evaluator for the filter
                    query_eval = SimpleEval(names=metadata, functions=self.evaluator.functions)
                    if query_eval.eval(filter_expr):
                        if property_name:
                            val = metadata.get(property_name)
                            if val: results.append(val)
                        else:
                            # Return the ID by default if no property specified
                            results.append(p.stem)
            except Exception:
                continue
        
        self._query_cache[cache_key] = results
        return results

    def _current_table_id(self) -> Optional[str]:
        return self.evaluator.names.get("database_table_id") or self.evaluator.names.get("table_id")

    def _normalize_column_values(self, values: List[Any]) -> List[float]:
        normalized: List[float] = []
        for value in values:
            if isinstance(value, list):
                for item in value:
                    try:
                        normalized.append(float(item))
                    except Exception:
                        continue
                continue
            try:
                normalized.append(float(value))
            except Exception:
                continue
        return normalized

    def _collect_column_values(self, property_name: str, table_id: Optional[str] = None, filter_expr: Optional[str] = None) -> List[Any]:
        effective_table_id = table_id or self._current_table_id()
        if not effective_table_id or not self.vault_path:
            return []

        values: List[Any] = []
        # Optimization: Use PathResolver instead of slow rglob
        all_files = path_resolver.list_all_files(self.vault_path)
        
        for p in all_files:
            try:
                metadata = self._parse_metadata(p)
                if metadata.get("database_table_id") != effective_table_id:
                    continue
                
                row_id = str(metadata.get("id") or p.stem)
                if self._current_note_id and row_id == self._current_note_id:
                    # Avoid using stale on-disk values for the row currently being updated.
                    continue

                if filter_expr:
                    filter_eval = SimpleEval(names=metadata, functions=self.evaluator.functions)
                    if not bool(filter_eval.eval(filter_expr)):
                        continue

                if property_name == "title":
                    value = metadata.get("title")
                else:
                    value = metadata.get(property_name)

                if value is None or value == "":
                    continue
                values.append(value)
            except Exception:
                continue

        # Include current in-memory row so formulas see the latest user edit.
        current_meta = dict(self.evaluator.names or {})
        if (current_meta.get("database_table_id") or current_meta.get("table_id")) == effective_table_id:
            include_current = True
            if filter_expr:
                try:
                    filter_eval = SimpleEval(names=current_meta, functions=self.evaluator.functions)
                    include_current = bool(filter_eval.eval(filter_expr))
                except Exception:
                    include_current = False

            if include_current:
                if property_name == "title":
                    current_value = current_meta.get("title")
                else:
                    current_value = current_meta.get(property_name)

                if current_value is not None and current_value != "":
                    values.append(current_value)

        return values

    def _col_sum(self, property_name: str, table_id: Optional[str] = None, filter_expr: Optional[str] = None) -> float:
        values = self._collect_column_values(property_name, table_id, filter_expr)
        return sum(self._normalize_column_values(values))

    def _col_avg(self, property_name: str, table_id: Optional[str] = None, filter_expr: Optional[str] = None) -> float:
        nums = self._normalize_column_values(self._collect_column_values(property_name, table_id, filter_expr))
        if not nums:
            return 0.0
        return sum(nums) / len(nums)

    def _col_count(self, property_name: str, table_id: Optional[str] = None, filter_expr: Optional[str] = None) -> int:
        return len(self._collect_column_values(property_name, table_id, filter_expr))

    def _col_min(self, property_name: str, table_id: Optional[str] = None, filter_expr: Optional[str] = None) -> Any:
        nums = self._normalize_column_values(self._collect_column_values(property_name, table_id, filter_expr))
        return min(nums) if nums else None

    def _col_max(self, property_name: str, table_id: Optional[str] = None, filter_expr: Optional[str] = None) -> Any:
        nums = self._normalize_column_values(self._collect_column_values(property_name, table_id, filter_expr))
        return max(nums) if nums else None

    def _find_record_path(self, record_id: str) -> Optional[Path]:
        """Search for a markdown file by ID using PathResolver."""
        if not self.vault_path:
            return None
            
        # 1. Use PathResolver (O(1))
        p = path_resolver.find_path(record_id, self.vault_path)
        if p:
            return p

        # 2. Check root as last resort
        direct = self.vault_path / f"{record_id}.md"
        if direct.exists():
            return direct
            
        return None

    def _parse_metadata(self, path: Path) -> Dict[str, Any]:
        """Parse frontmatter from a markdown file."""
        content = path.read_text(encoding="utf-8")
        match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
        if match:
            try:
                meta = yaml.safe_load(match.group(1)) or {}
                # Lookups/rollups follow relation fields from other rows: we need to
                # strip '[[Title|id]]' → id. Detection of relation
                # fields is SCHEMA-based (not based on any prefix in the name).
                tid = meta.get("table_id") or meta.get("database_table_id")
                rel_keys = relation_keys_from_table(
                    self._resolve_table_by_id(tid)) if tid else None
                return strip_relation_wikilinks(meta, rel_keys or None)
            except Exception:
                return {}
        return {}

    def process_updates(self, note_id: str, old_metadata: Dict[str, Any], request_metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate formulas and automations for a record, respecting manual overrides."""
        with self._eval_lock:
            return self._process_updates_locked(note_id, old_metadata, request_metadata)

    def _process_updates_locked(self, note_id: str, old_metadata: Dict[str, Any], request_metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Actual implementation of process_updates. Called with the lock held."""
        # Registry can change at runtime when schema is edited from frontend.
        # Reload per update to keep formula definitions fresh.
        self.registry = self._load_registry()
        self._lookup_cache = {}
        self._query_cache = {}
        self._current_note_id = note_id

        updated_metadata = request_metadata.copy()
        
        # 1. Detect manual overrides
        # 1.1 Persist existing manual flags from file
        for key, val in old_metadata.items():
            if key.endswith("_manual"):
                updated_metadata[key] = val

        # 1.2 Detect new manual edits
        # If user sends a value different from what was in the file, it's a manual edit.
        for key, new_val in request_metadata.items():
            if key in old_metadata and old_metadata[key] != new_val:
                if not key.endswith("_manual") and key != "database_table_id":
                    updated_metadata[f"{key}_manual"] = True

        # 1.5 Identify table
        table = self._resolve_table(updated_metadata)
        if not table:
            return updated_metadata

        # 2. Evaluate derived fields (formulas + rollups) in a single unified
        # dependency order, so a formula can read a freshly-recomputed rollup
        # and a rollup can read a freshly-computed formula. Both are persisted
        # to the frontmatter with read-only semantics.
        updated_metadata = self._evaluate_derived(updated_metadata, table)

        # Keep evaluation scope synchronized before automations run.
        self.evaluator.names = dict(updated_metadata)

        # 3. Process Automations (Only if target is not manual)
        automations = table.get("automations", [])
        for auto in automations:
            try:
                if self._automation_triggered(auto.get("trigger", {}), old_metadata, updated_metadata):
                    # Supports a single `action` or a list of `actions` (Notion style).
                    actions = auto.get("actions")
                    if not isinstance(actions, list):
                        actions = [auto.get("action", {})]
                    for action in actions:
                        self._apply_automation_action(action, updated_metadata)
            except Exception as e:
                log.error(f"Error processing automation {auto.get('name', '?')}: {e}")

        return updated_metadata

    def _automation_triggered(self, trigger: Dict[str, Any], old_metadata: Dict[str, Any], meta: Dict[str, Any]) -> bool:
        """Decides whether an automation should fire.

        Trigger types:
          - `always`: every save.
          - `property_change`: when a property changes. Optional conditions:
              `to` (final value must match), `from` (previous value must
              match), `equals` (current value must match, even if it
              hasn't changed).
        
        """
        ttype = trigger.get("type", "property_change")
        if ttype == "always":
            return True
        if ttype == "property_change":
            prop = trigger.get("property")
            if not prop:
                return False
            old_val = old_metadata.get(prop)
            new_val = meta.get(prop)
            # `equals`: fires if the current value matches (regardless of the change).
            if "equals" in trigger:
                return str(new_val) == str(trigger.get("equals"))
            changed = old_val != new_val
            if not changed:
                return False
            # Compare actual values, not strings: None and "" are equivalent (the value was empty).
            # Without this, `str(None)="None"` vs `str("")=""` didn't match → the automation wouldn't fire.
            if "to" in trigger:
                expected_new = trigger.get("to")
                # None and "" considered equivalent for "empty".
                if not ((new_val is None or new_val == "") and (expected_new is None or expected_new == "")):
                    if str(new_val) != str(expected_new):
                        return False
            if "from" in trigger:
                expected_old = trigger.get("from")
                # None and "" considered equivalent for "empty".
                if not ((old_val is None or old_val == "") and (expected_old is None or expected_old == "")):
                    if str(old_val) != str(expected_old):
                        return False
            return True
        return False

    def _apply_automation_action(self, action: Dict[str, Any], meta: Dict[str, Any]) -> None:
        """Applies an automation action to `meta` (in-place).

        Supported types: update_property (expression), set_property (literal value),
        set_today (today's date), clear_property (empties it), append_text (appends
        text), increment (numeric addition). Always respects manual overrides.
        
        """
        atype = action.get("type", "update_property")
        target = action.get("target_property") or action.get("target")
        if not target:
            return
        # Never overwrite a field that the user has manually edited.
        if meta.get(f"{target}_manual"):
            return

        if atype == "update_property":
            expr = action.get("expression")
            if expr:
                result = self._evaluate_expression(expr)
                meta[target] = result
                self.evaluator.names[target] = result
        elif atype == "set_property":
            meta[target] = action.get("value")
            self.evaluator.names[target] = action.get("value")
        elif atype == "set_today":
            import datetime as _dt
            today = _dt.date.today().isoformat()
            meta[target] = today
            self.evaluator.names[target] = today
        elif atype == "clear_property":
            meta[target] = ""
            self.evaluator.names[target] = ""
        elif atype == "append_text":
            text = action.get("value", "")
            if action.get("expression"):
                try:
                    text = str(self._evaluate_expression(action["expression"]))
                except Exception:
                    text = action.get("value", "")
            sep = action.get("separator", " ")
            current = str(meta.get(target) or "")
            meta[target] = (current + sep + str(text)).strip() if current else str(text)
            self.evaluator.names[target] = meta[target]
        elif atype == "increment":
            try:
                by = float(action.get("by", 1))
                current = float(meta.get(target) or 0)
                val = current + by
                # Keeps int if there are no decimals.
                meta[target] = int(val) if val == int(val) else val
                self.evaluator.names[target] = meta[target]
            except (ValueError, TypeError):
                pass
