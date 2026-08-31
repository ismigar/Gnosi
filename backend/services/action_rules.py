"""Declarative action rules per table (`table.action_rules` block).

They govern explicit button actions (translate, sync with Drupal,
publish to XXSS) according to the `vault_option_catalogs_action_rules.md` directive:

  * `requires`: conditions to be ABLE to execute the action, with `reason` for the
    disabled button's tooltip and for the backend's 409.
  * `effects`: Status changes on completion (source / created).
  * `on_stale`: revert stale translations to «Draft».

Boundary with `rule_engine` (automations): automations react to changes
in data (`property_change`); action_rules govern button actions —
a prior guard + subsequent effects, also on the created record. They are not a
new automations trigger (directive §6).

Pure module: no I/O or backend imports. Whoever applies the effects (writing
metadata, saving the registry if an option had to be created) is the caller.
"""

import copy
from collections.abc import Sequence
from typing import TypeAlias

from backend.domains.vault.registry.records import RecordReader, is_record
from backend.domains.vault.registry.state import RegistryData
from backend.services import option_catalogs as oc
from backend.utils.open_values import contains_value, get_value, iterable_values, set_value

JsonMap: TypeAlias = RegistryData
Property: TypeAlias = RegistryData

ACTION_TRANSLATE = "translate_row"
ACTION_SYNC_DRUPAL = "sync_drupal"
ACTION_PUBLISH_SOCIAL = "publish_social"

# Default seeds (directive §3.3). They are written to the registry when the table
# enables the corresponding feature; once in the registry, the ones from the
# registry take precedence (hand-editable).
DEFAULT_ACTION_RULES: dict[str, JsonMap] = {
    ACTION_TRANSLATE: {
        "requires": [
            {
                "role": "status",
                "not_in": [oc.STATUS_DRAFT],
                "reason": "No es pot traduir si està en esborrany",
            }
        ],
        "effects": {
            "source": [{"role": "status", "set": oc.STATUS_TRANSLATED}],
            "created": [{"role": "status", "set": oc.STATUS_DRAFT}],
        },
        "on_stale": [{"target": "translations", "role": "status", "set": oc.STATUS_DRAFT}],
    },
    ACTION_SYNC_DRUPAL: {
        "requires": [
            {
                "role": "status",
                "not_in": [oc.STATUS_DRAFT],
                "reason": "No es pot sincronitzar un esborrany",
            }
        ],
        "effects": {
            "source": [{"role": "status", "set": oc.STATUS_PUBLISHED_DRUPAL}],
        },
    },
    ACTION_PUBLISH_SOCIAL: {
        "requires": [
            {
                "role": "status",
                "not_in": [oc.STATUS_DRAFT],
                "reason": "No es pot publicar un esborrany",
            }
        ],
        "effects": {
            "source": [{"role": "status", "set": oc.STATUS_PUBLISHED_SOCIAL}],
        },
    },
}


def _action_enabled(table: JsonMap, action: str) -> bool:
    if action == ACTION_TRANSLATE:
        return bool(table.get("translation_enabled"))
    if action == ACTION_SYNC_DRUPAL:
        return bool(table.get("drupal_sync_enabled"))
    if action == ACTION_PUBLISH_SOCIAL:
        return oc.table_has_social_column(table)
    return False


def get_action_rules(table: JsonMap, action: str) -> object:
    """Rules block for an action: the registry's if present; otherwise, the default
    when the feature is active (tables not yet re-saved with the seed).
    None if the action doesn't apply to the table."""
    rules = table.get("action_rules")
    if is_record(rules) and is_record(rules.get(action)):
        return rules[action]
    if _action_enabled(table, action):
        return DEFAULT_ACTION_RULES.get(action)
    return None


def ensure_action_rules(table: JsonMap) -> bool:
    """Seed-on-enable for action_rules blocks (idempotent): writes the
    default block for each active feature that doesn't yet have one. Never
    overwrites an existing block (it's hand-editable in the registry)."""
    changed = False
    for action in (ACTION_TRANSLATE, ACTION_SYNC_DRUPAL, ACTION_PUBLISH_SOCIAL):
        if not _action_enabled(table, action):
            continue
        rules = table.setdefault("action_rules", {})
        if not is_record(get_value(rules, action)):
            # Deep copy: the registry block is hand-editable and must not
            # share references with the module's default.
            set_value(rules, action, copy.deepcopy(DEFAULT_ACTION_RULES[action]))
            changed = True
    return changed


def read_prop_value(metadata: object, prop: Property) -> object:
    """Value of a property in the frontmatter (priority id → name → alias),
    same convention as the rest of the backend."""
    keys: list[str] = []
    field_id = prop.get("id")
    name = prop.get("name")
    if isinstance(field_id, str) and field_id:
        keys.append(field_id)
    if isinstance(name, str) and name:
        keys.append(name)
    keys.extend(a for a in iterable_values(prop.get("aliases") or []) if isinstance(a, str) and a)
    for k in keys:
        if contains_value(metadata or {}, k):
            v = get_value(metadata, k)
            if v not in (None, "", [], {}):
                return v
    return None


def _values_of(raw: object) -> list[str]:
    if isinstance(raw, list):
        return [str(v).strip() for v in raw if str(v).strip()]
    if raw is None:
        return []
    s = str(raw).strip()
    return [s] if s else []


def _group_of(option_name: str, options: Sequence[RecordReader]) -> str:
    for o in options:
        if o.get("name") == option_name:
            return str(o.get("group") or "")
    return ""


def check_requires(table: JsonMap, action: str, metadata: object) -> tuple[bool, str | None]:
    """Evaluates an action's `requires` conditions against a record.

    Returns `(ok, reason)`. If the table has no rules for the action, or a
    condition can't be evaluated (role field missing, empty value), it passes:
    the rules restrict declared states, not the absence of data.

    """
    rules = get_action_rules(table, action)
    if not rules:
        return True, None
    for cond in iterable_values(get_value(rules, "requires") or []):
        if not is_record(cond):
            continue
        role = str(cond.get("role") or "").strip()
        prop = oc.find_role_prop(table, role) if role else None
        if not prop:
            continue
        values = _values_of(read_prop_value(metadata or {}, prop))
        if not values:
            continue
        reason = str(cond.get("reason") or "").strip() or (
            f"The current status does not allow action {action}"
        )
        not_in = cond.get("not_in")
        if isinstance(not_in, list) and any(v in not_in for v in values):
            return False, reason
        allowed = cond.get("in")
        if isinstance(allowed, list) and not any(v in allowed for v in values):
            return False, reason
        in_group = cond.get("in_group")
        not_in_group = cond.get("not_in_group")
        if in_group or not_in_group:
            options = oc.get_prop_options(prop)
            groups = {_group_of(v, options) for v in values}
            if isinstance(not_in_group, str) and not_in_group in groups:
                return False, reason
            if isinstance(in_group, str) and in_group not in groups:
                return False, reason
    return True, None


def effect_write_key(metadata: object, prop: Property) -> str | None:
    """Key where an effect's value is written: the one the frontmatter ALREADY uses for
    that field (id, name, or alias), so as not to create duplicate keys; if the row
    has none, the stable-id→name convention."""
    candidates: list[str] = []
    field_id = prop.get("id")
    name = prop.get("name")
    if isinstance(field_id, str) and field_id:
        candidates.append(field_id)
    if isinstance(name, str) and name:
        candidates.append(name)
    candidates.extend(
        alias
        for alias in iterable_values(prop.get("aliases") or [])
        if isinstance(alias, str) and alias
    )
    for k in candidates:
        if contains_value(metadata or {}, k):
            return k
    fallback = field_id or name
    return fallback if isinstance(fallback, str) else None


def status_effect(
    table: JsonMap, action: str, target: str
) -> tuple[Property | None, str | None, bool]:
    """Status effect that the action must apply to `target` (source|created).

    Returns `(property, value, catalog_changed)` — the caller picks the key with
    `effect_write_key`. If the option to write isn't in the field's catalog, it gets
    ADDED to it (directive §4.1.5: a rule never fails due to an incomplete catalog) —
    `catalog_changed=True` tells the caller it must persist the registry.

    """
    rules = get_action_rules(table, action)
    if not rules:
        return None, None, False
    for eff in iterable_values(get_value(get_value(rules, "effects") or {}, target) or []):
        if not is_record(eff):
            continue
        role = str(eff.get("role") or "").strip()
        value = str(eff.get("set") or "").strip()
        if not role or not value:
            continue
        prop = oc.find_role_prop(table, role)
        if not prop:
            continue
        if oc.is_global_status_prop(prop):
            # Keep the in-memory table copy complete for the caller while the
            # route persists the same value in the root catalog. The loader
            # removes this compatibility copy on the next registry read.
            cfg = prop.setdefault("config", {})
            local_options = oc.normalize_options(get_value(cfg, "options"))
            if value in {option["name"] for option in local_options}:
                catalog_changed = False
            else:
                local_options.append({"name": value, "color": oc.auto_color(value)})
                set_value(cfg, "options", local_options)
                catalog_changed = True
        else:
            catalog_changed = oc.ensure_options_exist(prop, [(value, "")])
        return prop, value, catalog_changed
    return None, None, False


def on_stale_effect(table: JsonMap) -> tuple[Property | None, str | None, bool]:
    """Status effect for translations that become stale (`on_stale` from
    translate_row). Same return shape as `status_effect`."""
    rules = get_action_rules(table, ACTION_TRANSLATE)
    if not rules:
        return None, None, False
    for eff in iterable_values(get_value(rules, "on_stale") or []):
        if not is_record(eff):
            continue
        if str(eff.get("target") or "translations") != "translations":
            continue
        role = str(eff.get("role") or "").strip()
        value = str(eff.get("set") or "").strip()
        if not role or not value:
            continue
        prop = oc.find_role_prop(table, role)
        if not prop:
            continue
        if oc.is_global_status_prop(prop):
            cfg = prop.setdefault("config", {})
            local_options = oc.normalize_options(get_value(cfg, "options"))
            if value in {option["name"] for option in local_options}:
                catalog_changed = False
            else:
                local_options.append({"name": value, "color": oc.auto_color(value)})
                set_value(cfg, "options", local_options)
                catalog_changed = True
        else:
            catalog_changed = oc.ensure_options_exist(prop, [(value, "")])
        return prop, value, catalog_changed
    return None, None, False
