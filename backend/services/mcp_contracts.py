"""Complete JSON Schema validation for untrusted, self-contained MCP contracts."""
import math
from typing import Any

from jsonschema import FormatChecker
from jsonschema.validators import validator_for
from referencing import Registry, Resource
from referencing.jsonschema import UnknownDialect, specification_with
from referencing.exceptions import CannotDetermineSpecification, Unresolvable

from backend.services.json_contracts import validate_json_value


def compile_mcp_schema(schema: dict[str, Any]) -> Any:
    """Reject malformed/remote schemas and compile without network retrieval."""
    validator_type = validator_for(schema)
    validator_type.check_schema(schema)
    specification = specification_with(str(validator_type.META_SCHEMA.get("$id") or validator_type.META_SCHEMA.get("id")))
    try:
        root = Resource.from_contents(schema, default_specification=specification)
    except (UnknownDialect, CannotDetermineSpecification) as error:
        raise ValueError("Unsupported MCP schema dialect") from error
    base_uri = root.id() or ""
    registry: Any = Registry().with_resource(base_uri, root)

    def check_references(resource: Any, resolver: Any) -> None:
        contents = resource.contents
        if isinstance(contents, dict):
            for keyword in ("$ref", "$dynamicRef", "$recursiveRef"):
                reference = contents.get(keyword)
                if isinstance(reference, str):
                    if not reference.startswith("#"):
                        raise ValueError("MCP schemas must contain only local references")
                    try:
                        resolved = resolver.lookup(reference)
                    except Unresolvable as error:
                        raise ValueError(f"Unresolvable MCP schema reference: {reference}") from error
                    if not isinstance(resolved.contents, (dict, bool)):
                        raise ValueError(f"MCP reference must resolve to a schema: {reference}")
        # Walk actual subschemas once, never follow reference edges recursively.
        # This detects missing targets without looping on valid recursive refs.
        for child in resource.subresources():
            check_references(child, resolver.in_subresource(child))

    check_references(root, registry.resolver(base_uri))
    # Empty retrieval policy resolves embedded resources but never fetches URLs.
    return validator_type(schema, registry=registry, format_checker=FormatChecker())


def validate_mcp_value(arguments: dict[str, Any], validator: Any) -> None:
    """Validate exact values, including JSON safety, without coercion/defaults."""
    def require_json(value: Any) -> None:
        if isinstance(value, dict):
            if any(not isinstance(key, str) for key in value):
                raise ValueError("MCP object keys must be strings")
            for child in value.values():
                require_json(child)
        elif isinstance(value, list):
            for child in value:
                require_json(child)
        elif value is None or isinstance(value, (str, bool, int)):
            return
        elif isinstance(value, float) and math.isfinite(value):
            return
        else:
            raise ValueError("MCP arguments must contain JSON values")

    require_json(arguments)
    validate_json_value(arguments, {"type": "object"})
    validator.validate(arguments)
