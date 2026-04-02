import logging
import json
import yaml
import re
import math
from datetime import datetime
from pathlib import Path
from collections import deque
from typing import Dict, Any, List, Optional, Set, Tuple
from simpleeval import SimpleEval, NameNotDefined

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

        # Placeholder syntax: {Camp Amb Espais}
        for raw in re.findall(r"\{([^}]+)\}", expression):
            name = (raw or "").strip()
            if name in known_fields and name != field_name:
                deps.add(name)

        # prop("camp") or prop('camp')
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

        # Support frontend syntax with placeholders like {Camp}.
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

    def _order_definitions(self, definitions: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        if not definitions:
            return [], []

        by_name: Dict[str, Dict[str, Any]] = {d["name"]: d for d in definitions}
        known = set(by_name.keys())

        deps_by_name: Dict[str, Set[str]] = {
            name: self._extract_dependencies(defn.get("expression", ""), known, name)
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
            log.warning(f"RuleEngine detected formula cycle for fields: {cycle_names}")

        ordered = [by_name[name] for name in ordered_names]
        cycle_defs = [by_name[name] for name in cycle_names]
        return ordered, cycle_defs

    @staticmethod
    def _is_missing(value: Any) -> bool:
        return value is None or value == ""

    def _evaluate_formulas(self, updated_metadata: Dict[str, Any], table: Dict[str, Any]) -> Dict[str, Any]:
        definitions = self._extract_formula_definitions(table)
        if not definitions:
            return updated_metadata

        ordered, cycle_defs = self._order_definitions(definitions)

        self.evaluator.names = dict(updated_metadata)

        for definition in ordered:
            prop_name = definition["name"]
            mode = definition["mode"]
            expression = definition.get("expression")
            if not expression:
                continue

            is_manual = bool(updated_metadata.get(f"{prop_name}_manual"))
            # Always formulas ignore manual flags (calculated source of truth)
            if mode == "missing":
                if is_manual:
                    continue
                if not self._is_missing(updated_metadata.get(prop_name)):
                    continue

            try:
                result = self._evaluate_expression(expression)
                updated_metadata[prop_name] = result
                self.evaluator.names[prop_name] = result
            except Exception as e:
                log.error(f"Error evaluating formula '{expression}' for field '{prop_name}': {e}")
                updated_metadata.setdefault(prop_name, None)
                self.evaluator.names[prop_name] = updated_metadata.get(prop_name)

        # For cyclic dependencies, do one bounded pass without guaranteeing order.
        # This avoids hard failures while preserving deterministic persistence.
        for definition in cycle_defs:
            prop_name = definition["name"]
            mode = definition["mode"]
            expression = definition.get("expression")
            if not expression:
                continue

            is_manual = bool(updated_metadata.get(f"{prop_name}_manual"))
            if mode == "missing":
                if is_manual:
                    continue
                if not self._is_missing(updated_metadata.get(prop_name)):
                    continue

            try:
                result = self._evaluate_expression(expression)
                updated_metadata[prop_name] = result
                self.evaluator.names[prop_name] = result
            except Exception as e:
                log.error(f"Error evaluating cyclic formula '{expression}' for field '{prop_name}': {e}")
                updated_metadata.setdefault(prop_name, None)
                self.evaluator.names[prop_name] = updated_metadata.get(prop_name)

        return updated_metadata

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
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        normalized = str(value or "").strip().lower()
        return normalized in {"true", "1", "yes", "si", "done", "checked", "completat"}

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
            if not non_empty:
                return with_fallback(0)
            checked = sum(1 for value in non_empty if self._is_truthy_checkbox(value))
            return round((checked * 100.0) / len(non_empty), 2)

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

    def _evaluate_rollups(self, updated_metadata: Dict[str, Any], table: Dict[str, Any]) -> Dict[str, Any]:
        definitions = self._extract_rollup_definitions(table)
        if not definitions:
            return updated_metadata

        for definition in definitions:
            prop_name = definition.get("name")
            if not prop_name:
                continue
            try:
                result = self._evaluate_rollup_definition(definition, updated_metadata)
                updated_metadata[prop_name] = result
                self.evaluator.names[prop_name] = result
            except Exception as e:
                log.warning(f"Error evaluating rollup for field '{prop_name}': {e}")
                updated_metadata[prop_name] = definition.get("fallback_value")
                self.evaluator.names[prop_name] = updated_metadata.get(prop_name)

        return updated_metadata

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
                if val:
                    if isinstance(val, list):
                        results.extend(val)
                    else:
                        results.append(val)
            except Exception as e:
                log.warning(f"Error in lookup for {rid}: {e}")
                self._lookup_cache[cache_key] = None
        
        # Return list if multiple, else single value
        if not results: return None
        # Remove duplicates while preserving order
        unique_results = list(dict.fromkeys(results) if not isinstance(results[0], dict) else results)
        return unique_results if len(ids) > 1 or len(unique_results) > 1 else (unique_results[0] if unique_results else None)

    def _query(self, table_id: str, filter_expr: str, property_name: Optional[str] = None) -> Any:
        """Query all records in a table using an expression."""
        if not self.vault_path:
            return []
            
        cache_key = (table_id, filter_expr, property_name)
        if cache_key in self._query_cache:
            return self._query_cache[cache_key]

        results = []
        # Find all files belonging to this table
        # Optimization: We could use a cache or the registry's knowledge of where tables live
        for p in self.vault_path.rglob("*.md"):
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
        for p in self.vault_path.rglob("*.md"):
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
        """Search for a markdown file by ID."""
        if not self.vault_path:
            return None
            
        # Check root first
        direct = self.vault_path / f"{record_id}.md"
        if direct.exists():
            return direct
        # Recursive search
        for p in self.vault_path.rglob(f"{record_id}.md"):
            return p
        return None

    def _parse_metadata(self, path: Path) -> Dict[str, Any]:
        """Parse frontmatter from a markdown file."""
        content = path.read_text(encoding="utf-8")
        match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
        if match:
            try:
                return yaml.safe_load(match.group(1)) or {}
            except Exception:
                return {}
        return {}

    def process_updates(self, note_id: str, old_metadata: Dict[str, Any], request_metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate formulas and automations for a record, respecting manual overrides."""
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

        # 2. Evaluate Formulas / Default Formulas
        updated_metadata = self._evaluate_formulas(updated_metadata, table)

        # Keep evaluation scope synchronized after formula pass
        self.evaluator.names = dict(updated_metadata)

        # 2.5 Evaluate Rollups (always recalculated, read-only semantics)
        updated_metadata = self._evaluate_rollups(updated_metadata, table)

        # Keep evaluation scope synchronized after rollup pass
        self.evaluator.names = dict(updated_metadata)

        # 3. Process Automations (Only if target is not manual)
        automations = table.get("automations", [])
        for auto in automations:
            trigger = auto.get("trigger", {})
            if trigger.get("type") == "property_change":
                trigger_prop = trigger.get("property")
                if trigger_prop in updated_metadata:
                    action = auto.get("action", {})
                    if action.get("type") == "update_property":
                        target = action.get("target_property")
                        # Skip if user has explicitly overridden this target
                        if updated_metadata.get(f"{target}_manual"):
                            continue
                            
                        expr = action.get("expression")
                        if target and expr:
                            try:
                                result = self._evaluate_expression(expr)
                                updated_metadata[target] = result
                                self.evaluator.names[target] = result
                            except Exception as e:
                                log.error(f"Error in automation action '{expr}': {e}")

        return updated_metadata
