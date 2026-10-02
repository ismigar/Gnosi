"""Contracts for generated table buttons, using the actual editable fields."""

from typing import Any, TypedDict

from fastapi import HTTPException


class ButtonAssignment(TypedDict):
    field: str
    value: object


def parse_button_assignments(value: object) -> list[ButtonAssignment]:
    if not isinstance(value, list) or not value:
        raise ValueError("Button assignments must be a nonempty list")
    result: list[ButtonAssignment] = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {"field", "value"}:
            raise ValueError("Invalid button assignment")
        name = item["field"]
        if not isinstance(name, str) or not name:
            raise ValueError("Invalid button assignment field")
        result.append({"field": name, "value": item["value"]})
    return result


def _object(properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": properties,
            "required": list(properties), "additionalProperties": False}


def _relation_value_schema(field: dict[str, Any]) -> dict[str, Any]:
    multiple = {"type": "array", "items": {"type": "string", "minLength": 1}, "uniqueItems": True}
    cardinality = field.get("cardinality")
    if cardinality is not None and not isinstance(cardinality, str):
        raise HTTPException(422, "The relation cardinality must be a string")
    if cardinality in {"single", "many-to-one", "one-to-one"}:
        multiple["maxItems"] = 1
    limit = field.get("limit")
    if isinstance(limit, str) and limit.isascii() and limit.isdecimal():
        try:
            limit = int(limit)
        except ValueError as exc:
            raise HTTPException(422, "The relation limit must be a nonnegative integer") from exc
    if limit is not None and (not isinstance(limit, int) or isinstance(limit, bool) or limit < 0):
        raise HTTPException(422, "The relation limit must be a nonnegative integer")
    if limit:
        multiple["maxItems"] = min(1, limit) if cardinality in {"single", "many-to-one", "one-to-one"} else limit
    return {"anyOf": [{"type": "string"}, multiple, {"type": "null"}]}


def field_value_schema(field: dict[str, Any]) -> dict[str, Any] | bool:
    if field.get("read_only"):
        return False
    kind = field.get("type")
    if kind is None:
        return False
    if not isinstance(kind, str):
        raise HTTPException(422, "The field type must be a string")
    if kind == "date":
        return {"anyOf": [{"type": "string", "format": "date"}, {"type": "string", "format": "date-time"}]}
    if kind == "datetime":
        return {"type": "string", "format": "date-time"}
    if kind in {"text", "rich_text", "title", "url", "email"}:
        return {"type": "string"}
    if kind == "number":
        return {"type": "number"}
    if kind == "checkbox":
        return {"type": "boolean"}
    if kind == "relation":
        return _relation_value_schema(field)
    if kind in {"select", "status", "multi_select", "tags"}:
        options = field.get("options")
        if options is None:
            options = []
        if not isinstance(options, list):
            raise HTTPException(422, "The field options must be a list")
        names = [option if isinstance(option, str) else option.get("name")
                 for option in options if isinstance(option, (str, dict))]
        names = list(dict.fromkeys(name for name in names if isinstance(name, str) and name))
        value = {"type": "string", "enum": names} if names else ({"type": "string"} if kind == "tags" else False)
        return {"type": "array", "items": value, "uniqueItems": True} if kind in {"multi_select", "tags"} else value
    # Computed fields cannot be assigned by a button.
    return False


def field_assignments_schema(fields: list[dict[str, Any]]) -> dict[str, Any]:
    names = [field.get("name") for field in fields]
    if any(not isinstance(name, str) or not name.strip() for name in names) or len(set(names)) != len(names):
        raise ValueError("Button fields must have unique, nonempty names")
    assignments = [_object({"field": {"const": field["name"]}, "value": value})
                   for field in fields if (value := field_value_schema(field)) is not False]
    return _object({"assignments": {"type": "array", "minItems": 1,
                                "items": {"anyOf": assignments} if assignments else False,
                                **({"allOf": [{"contains": {"properties": {"field": {"const": name}}},
                                               "minContains": 0, "maxContains": 1} for name in names]}
                                   if names else {})}})


def button_action_schema(fields: list[dict[str, Any]], skill_ids: list[str]) -> dict[str, Any]:
    assignments = field_assignments_schema(fields)
    configs = {
        "set_fields": assignments,
        "ai_prompt": _object({"prompt": {"type": "string", "minLength": 1},
                              "target_field": {"enum": [field["name"] for field in fields
                                                        if field_value_schema(field) is not False]}
                              if any(field_value_schema(field) is not False for field in fields) else False}),
        "run_skill": _object({"skill_id": {"enum": sorted(set(skill_ids))} if skill_ids else False}),
    }
    return {"oneOf": [_object({
        "button_label": {"type": "string", "minLength": 1, "maxLength": 20},
        "button_action": {"const": action}, "button_config": config,
    }) for action, config in configs.items()]}
