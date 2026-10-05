"""Bound repair diagnostics without repeating documents or entire JSON schemas."""
from __future__ import annotations

import jsonschema
import json
from typing import Any


def reading_error(error: Exception, output: str, schema: dict[str, Any] | None) -> Exception:
    """Diagnose the chosen action, not jsonschema's unrelated anyOf branch."""
    if not isinstance(error, jsonschema.ValidationError) or not schema:
        return error
    try:
        value = json.loads(output)
        properties = schema["properties"]
        index = properties["action"]["enum"].index(value["action"])
        arguments = properties["arguments"]["anyOf"][index]
        jsonschema.validate(value["arguments"], arguments)
    except jsonschema.ValidationError as selected:
        selected.path.appendleft("arguments")
        return selected
    except (KeyError, ValueError, TypeError, IndexError):
        pass
    return error


def repair_diagnostic(error: Exception) -> str:
    if not isinstance(error, jsonschema.ValidationError):
        return str(error)
    rows = [error, *error.context[:8]]
    diagnostics = []
    for row in rows:
        path = "/".join(map(str, row.absolute_path)) or "$"
        # ValidationError.__str__ repeats the schema and instance. Even its
        # message may contain the complete document for anyOf/type errors.
        detail = (row.message if row.validator in {"required", "additionalProperties"}
                  else f"must satisfy {row.validator}: {row.validator_value!r}"
                  if row.validator in {"type", "enum", "minItems", "maxItems"}
                  else f"does not satisfy {row.validator}")
        diagnostics.append(f"{path[:160]}: {detail[:400]}")
    return "\n".join(dict.fromkeys(diagnostics))[:2400]
