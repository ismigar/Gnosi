# Directive: Automations and Formulas in the Vault

This directive defines the system of automations and formulas to complete the power of the Gnosi databases, allowing dynamic behaviors and automatic calculations between properties.

## 1. Formulas (Spreadsheet-like)
Formulas allow calculating the value of a property based on other properties of the same record or related records.

### Definition in the Registry (`vault_db_registry.json`)
The `formula` type is added to a table's properties.
```json
{
  "name": "Total with VAT",
  "type": "formula",
  "formula_config": {
    "expression": "Amount * 1.21"
  }
}
```

### Calculation Engine
- Formulas are evaluated on the **Backend** during `save` or `patch` operations.
- The result is physically saved in the Frontmatter to allow indexed searches and filtering.
- Optionally, they can be evaluated on the **Frontend** for real-time feedback (without persistence until saved).

## 2. Automations (Triggers & Actions)
Automations execute actions when certain data change conditions are met.

### Table Definition
Each table can have a list of automations.
```json
{
  "id": "notes",
  "automations": [
    {
      "name": "Update Project from Task",
      "trigger": {
        "type": "property_change",
        "property": "task_ids"
      },
      "action": {
        "type": "update_property",
        "target_property": "project_ids",
        "expression": "lookup('tasks', task_ids, 'project_ids')"
      }
    }
  ]
}
```

### Key Concepts:
- **Trigger**: `property_change`, `on_create`, `on_delete`.
- **Action**: `update_property`, `notify`, `trigger_webhook`.
- **Lookup**: Ability to travel through relations to obtain data from other tables.

## 3. Pseudo-formula Language
A syntax based on simplified Python or a safe expression library will be used.

### Supported Functions:
- `prop('name')`: Gets the value of a property.
- `lookup(table, id, property)`: Gets the value of a property from a record in another table.
- `first(list)` / `last(list)`: List operations (especially for relations).
- Standard mathematical and string operators.

## 4. Execution Protocol
1. User sends a `PATCH` or `PUT` to `/api/vault/pages/{id}`.
2. Server loads the current metadata.
3. The `RuleEngine` identifies active triggers based on the data difference (`diff`).
4. Pending formulas are evaluated.
5. Automation actions are executed.
6. The final result is saved to the `.md` file.

## 5. Restrictions and Security
- **Recursion**: Limit automation depth to avoid infinite loops (e.g., A updates B, B updates A).
- **Security**: Arbitrary Python code execution must not be allowed (danger of `eval`). Use a controlled environment.
- **Performance**: Heavy lookups must be cached or optimized.

## 6. Unified derived-field evaluation order (formulas + rollups)

Formulas AND rollups are both derived fields evaluated at save (`RuleEngine._evaluate_derived`). They MUST share a **single topological order**, never two separate passes.

- **Do NOT** evaluate formulas fully before rollups (or vice-versa) → causes silent data corruption: a formula reading a rollup (e.g. `estat = "actiu" if total_tasques > 0 else "buit"`) sees the STALE on-disk / `None` rollup value and lags one save behind. Inverting the order only moves the bug to the rollup→formula case.
- **Do** build one combined dependency graph in `_order_definitions` via `_definition_dependencies`:
  - a **formula** depends on any derived field named in its expression (other formulas *and* rollups), detected by `_extract_dependencies` (placeholders `{Camp}`, `prop("camp")`, bare identifiers);
  - a **rollup** depends on the derived field it uses as its `relationField` (the local field holding the related-record ids). Its `targetProperty`/`filterExpression` resolve against the RELATED rows, so they are NOT local dependencies.
- After each field is applied, refresh BOTH `updated_metadata` and `self.evaluator.names` so the next field reads fresh values.
- **Cycles** (formula ↔ rollup) are detected (Kahn leftover) → logged as a `derived-field cycle` warning and evaluated in ONE bounded pass, never looped.
- Formula syntax is `simpleeval` (safe subset): use the Python ternary `a if cond else b`, NOT `if(cond,a,b)` (unsupported → `SyntaxError`).
- Tests: `backend/tests/test_rule_engine_derived_order.py` (formula→rollup, rollup→formula, mixed cycle, no-regression formula-only). Run: `cd monorepo/apps/gnosi && GNOSI_LOCAL_DATA=<scratch> .venv/bin/python -m pytest backend/tests/test_rule_engine_derived_order.py`.

> Note: `rule_engine` evaluates and **materializes** derived values in
> frontmatter on save, while `virtual_fields.py` calculates other values **on
> read**. Both mechanisms are active and complementary. The
> `vault_derived_progress_field.md` directive selected virtual fields for the
> Progress field; this does not make `rule_engine` rollups dead code.
> `vault_routes.py` calls `process_updates` on every save.
