"""Property-change triggers and metadata automation actions."""

from __future__ import annotations

from collections.abc import Callable
from datetime import date
from typing import Any

from backend.domains.vault.tables.rules.types import Definition, Metadata


def _empty(value: object) -> bool:
    return value is None or value == ""


def _expected_value_matches(value: object, expected: object) -> bool:
    return (_empty(value) and _empty(expected)) or str(value) == str(expected)


def automation_triggered(
    trigger: Definition,
    old_metadata: Metadata,
    metadata: Metadata,
) -> bool:
    """Return whether an ``always`` or ``property_change`` trigger fires."""
    trigger_type = trigger.get("type", "property_change")
    if trigger_type == "always":
        return True
    if trigger_type != "property_change":
        return False
    property_name = trigger.get("property")
    if not property_name:
        return False
    old_value = old_metadata.get(str(property_name))
    new_value = metadata.get(str(property_name))
    if "equals" in trigger:
        return str(new_value) == str(trigger.get("equals"))
    if old_value == new_value:
        return False
    if "to" in trigger and not _expected_value_matches(new_value, trigger.get("to")):
        return False
    if "from" in trigger and not _expected_value_matches(old_value, trigger.get("from")):
        return False
    return True


def _set_value(metadata: Metadata, names: Metadata, target: str, value: Any) -> None:
    metadata[target] = value
    names[target] = value


def _append_text(
    action: Definition,
    metadata: Metadata,
    names: Metadata,
    target: str,
    evaluate_expression: Callable[[str], Any],
) -> None:
    text: object = action.get("value", "")
    expression = action.get("expression")
    if expression:
        try:
            text = str(evaluate_expression(str(expression)))
        except Exception:
            text = action.get("value", "")
    separator = action.get("separator", " ")
    current = str(metadata.get(target) or "")
    value = (current + str(separator) + str(text)).strip() if current else str(text)
    _set_value(metadata, names, target, value)


def _increment(
    action: Definition,
    metadata: Metadata,
    names: Metadata,
    target: str,
) -> None:
    try:
        increment = float(action.get("by", 1))
        current = float(metadata.get(target) or 0)
        value = current + increment
        _set_value(metadata, names, target, int(value) if value == int(value) else value)
    except (ValueError, TypeError):
        pass


def apply_automation_action(
    action: Definition,
    metadata: Metadata,
    names: Metadata,
    evaluate_expression: Callable[[str], Any],
) -> None:
    """Apply one automation action in place while respecting manual flags."""
    action_type = action.get("type", "update_property")
    raw_target = action.get("target_property") or action.get("target")
    if not raw_target:
        return
    target = str(raw_target)
    if metadata.get(f"{target}_manual"):
        return
    if action_type == "update_property":
        expression = action.get("expression")
        if expression:
            _set_value(metadata, names, target, evaluate_expression(str(expression)))
    elif action_type == "set_property":
        _set_value(metadata, names, target, action.get("value"))
    elif action_type == "set_today":
        _set_value(metadata, names, target, date.today().isoformat())
    elif action_type == "clear_property":
        _set_value(metadata, names, target, "")
    elif action_type == "append_text":
        _append_text(action, metadata, names, target, evaluate_expression)
    elif action_type == "increment":
        _increment(action, metadata, names, target)


__all__ = ["apply_automation_action", "automation_triggered"]
