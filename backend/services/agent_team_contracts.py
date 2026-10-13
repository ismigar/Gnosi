"""Local operation and output checks for the coordinator's untrusted plan."""
from __future__ import annotations

from typing import Any
from collections.abc import Iterator
import json
import re

from jsonschema import Draft202012Validator, ValidationError

from backend.services.agent_operation_catalog import OPERATIONS, OUTPUT_SIGNATURES, skill_id
from backend.services.agent_team_models import TeamPlan, TeamOutputField, TeamTask, DirectRoute

def required_operation(operation: str, active_skills: list[str]) -> str:
    """A plugin's operation prefix is not an application-skill assignment."""
    family = operation.split(".")[0]
    return family if family in OPERATIONS and skill_id(family) in active_skills else ""


def initial_greeting(data: dict[str, Any]) -> bool:
    text = str(data.get("request") or "").strip().casefold().rstrip(".!? ")
    refs = data.get("context_refs") or {}
    return (text in {"hola", "hello", "hi", "bonjour", "salut", "bon dia", "buenos días"}
            and not data.get("recent_conversation") and not data.get("current_message_has_source_context")
            and not data.get("authorized_tool_names") and isinstance(refs, dict) and not refs.get("count"))


def standalone_clarification(data: dict[str, Any]) -> dict[str, Any]:
    response = data.get("response")
    if (data.get("response_kind") == "clarification" and isinstance(response, str) and response.strip()
            and not data.get("output_contract") and not response.lstrip().startswith(("{", "[", "```"))):
        return {**data, "tasks": [], "result_task": "", "synthesize": False}
    return data


_OUTPUT_DIRECTIVE = re.compile(
    r"(?:\b|(?<=_))(?:(?:return|retornar?|devuelve|devolver|retourne(?:r|z)?)\s+"
    r"(?:(?:only|només|solo|seulement|exact|exactly|exactament|exactamente|exactement|valid|vàlid|válido|valide|a|an|un|una|une)\s+)*"
    r"(?:(?:objecte|objeto|objet|object)\s+)?JSON(?:\s+(?:objecte|objeto|objet|object)\b)?\s*:?|(?:contract|contracte|contrato|contrat)\s*:)[ \n]*", re.I)

_DIRECTIVE_LEADIN = re.compile(
    r"(?:\b|(?<=_))(?:please|kindly|si us plau|sisplau|por favor|s['’]il (?:vous|te) pla[iî]t|merci de|"
    r"(?:can|could|would|will) you(?: please)?|(?:i|we) (?:need|want) you to|"
    r"(?:i would|i['’]d|we would) like you to|em pots|pots|podries|puedes|podrías|peux-tu|pouvez-vous|pourriez-vous)\s*[,\-]?\s*$", re.I)


def _directive_prefix(prefix: str) -> str:
    """Recognize rendered request boundaries without removing quoted source text."""
    previous = None
    while previous != prefix:
        previous = prefix
        prefix = re.sub(r"(?:\*\*|__|\*|_|~~)+[ \t]*$", "", prefix)
        if (leadin := _DIRECTIVE_LEADIN.search(prefix)) is not None:
            prefix = prefix[:leadin.start()]
    marker = re.search(r"(?:^|[\n.!?;])[ \t]*(?:[-+*]|\d+[.)]|#{1,6})[ \t]+(?:\[[ xX]\][ \t]+)?$", prefix)
    return prefix[:marker.start()] + "\n" if marker else prefix


def _output_directives(request: str) -> Iterator[re.Match[str]]:
    for match in _OUTPUT_DIRECTIVE.finditer(request):
        prefix = request[:match.start()]
        if _quoted(prefix):
            continue
        prefix = _directive_prefix(prefix)
        if (prefix.strip() and prefix.rstrip(" \t")[-1] not in ".!?;,\n"
                               and not re.search(r"\b(?:and|i|y|et)\s+$", prefix, re.I)):
            continue
        yield match


def output_contract_requested(request: str) -> bool:
    """Require semantic planning for an unquoted JSON output instruction."""
    return any("json" in match.group().casefold() or request[match.end():].lstrip().startswith(("{", "["))
               for match in _output_directives(request))


def _named_output_keys(names: str) -> set[str]:
    key = (r'"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\'|`[^`\n]*`'
           r'|«[^»\n]*»|“[^”\n]*”|‘[^’\n]*’|[A-Za-z_][A-Za-z0-9_-]*')
    separator = r"(?:\s*,\s*(?:(?:and|i|y|et)\s+)?|\s+(?:and|i|y|et)\s+)"
    suffix = r"(?:only|només|solo|seulement|without|sense|sin|sans|as|and nothing else|and no other keys|and do not|i res més|y nada más|et rien d'autre)\b"
    names = re.sub(r"^(?:\*\*|__|\*|_|~~)+(?=[\"'`«“‘])", "", names.strip())
    closing = r"(?:\*\*|__|\*|_|~~)+(?=\s*(?:[.!?;\n]|$))"
    declaration = re.match(rf"((?:{key})(?:{separator}(?:{key}))*)(?=\s*(?:[.!?;\n]|$|{closing}|,?\s*{suffix}))", names, re.I)
    if declaration is None:
        raise ValueError("agent_team_output_keys_ambiguous: provide a JSON object or an explicit key list")
    names = declaration.group(1)
    result = set()
    for match in re.finditer(rf"({key})(?:{separator}|$)", names, re.I):
        token = match.group(1)
        if token.startswith('"'):
            value = json.loads(token)
            if not isinstance(value, str):
                raise ValueError("agent_team_output_key_invalid")
        elif token.startswith(("'", "`", "«", "“", "‘")):
            value = re.sub(r"\\([\\'])", r"\1", token[1:-1])
        else:
            value = token
        result.add(value)
    return result


def explicit_output_schema(request: str) -> dict[str, Any] | None:
    """Preserve the shape and JSON types of an explicit output template."""
    for match in reversed(list(_output_directives(request))):
        remaining = request[match.end():].lstrip()
        remaining = re.sub(r"^(?:\*\*|__|\*|_|~~)+(?=\s*(?:[\[{{]|with\b|amb\b|con\b|avec\b))", "", remaining)
        remaining = _output_template(remaining)
        try:
            value, _ = json.JSONDecoder(parse_constant=_invalid_json_constant).raw_decode(remaining)
        except ValueError:
            if re.match(r'^[{\["0-9-]|^(?:true|false|null)\b', remaining):
                raise ValueError("agent_team_output_template_ambiguous") from None
        else:
            return _template_schema(value)
        named = re.match(
            r"(?:with|amb|con|avec)\s+(?:(?:the|a|one|la|el|le|les|els|las|una|un|une)\s+)?"
            r"(?:(?:following|següents|siguientes|suivantes)\s+)?"
            r"(?:\*\*|__|\*|_|~~)*(?:keys?|claus?|claves?|clés?|fields?|camps?|campos?|champs?|propert(?:y|ies)|propietats?|propiedad(?:es)?|propriétés?)\b(?:\*\*|__|\*|_|~~)*"
            r"(?:\s+(?:named|called|following|següents|siguientes|suivantes|anomenad[ae]s?|anomenats?|llamad[oa]s?|nommées?))?\s*:?\s*",
            remaining, re.I)
        if named:
            keys = _named_output_keys(remaining[named.end():])
            if keys:
                return {"type": "object", "properties": {key: {} for key in sorted(keys)},
                        "required": sorted(keys), "additionalProperties": False}
    return None


def explicit_output_keys(request: str) -> set[str] | None:
    """Read root object keys without losing the distinction from an empty object."""
    schema = explicit_output_schema(request)
    return set(schema["properties"]) if schema is not None and schema["type"] == "object" else None


def _invalid_json_constant(value: str) -> None:
    raise ValueError("agent_team_output_template_invalid_number: " + value)


def _template_schema(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return {"type": "object", "properties": {key: _template_schema(child) for key, child in value.items()},
                "required": list(value), "additionalProperties": False}
    if isinstance(value, list):
        shapes = []
        for child in value:
            shape = _template_schema(child)
            if shape not in shapes:
                shapes.append(shape)
        items = shapes[0] if len(shapes) == 1 else {"anyOf": shapes} if shapes else {}
        return {"type": "array", "items": items}
    return {"type": {str: "string", bool: "boolean", int: "integer", float: "number", type(None): "null"}[type(value)]}


def _preserves_template(schema: dict[str, Any], requested: dict[str, Any]) -> bool:
    if not requested:
        return True
    if "enum" in schema:
        return all(Draft202012Validator(requested).is_valid(value) for value in schema["enum"])
    if "anyOf" in requested:
        return any(_preserves_template(schema, alternative) for alternative in requested["anyOf"])
    kind = requested["type"]
    if schema.get("type") != kind and not (kind == "number" and schema.get("type") == "integer"):
        return False
    if kind == "object":
        return _preserves_object_template(schema, requested)
    if kind == "array":
        return _preserves_template(schema.get("items", {}), requested.get("items", {}))
    return True


def _preserves_object_template(schema: dict[str, Any], requested: dict[str, Any]) -> bool:
    properties = requested["properties"]
    if (set(schema.get("properties", {})) != set(properties)
            or set(schema.get("required", [])) != set(properties)
            or schema.get("additionalProperties") is not False):
        return False
    return all(_preserves_template(schema["properties"][key], child) for key, child in properties.items())


def _output_template(text: str) -> str:
    """Code following an actual output directive is a template, not a new instruction."""
    if text.startswith(("```", "~~~")):
        fenced = re.match(r"(?P<fence>`{3,}|~{3,})(?:json)?[ \t]*\r?\n(?P<body>[\s\S]*?)\r?\n[ \t]*(?P=fence)", text, re.I)
        if fenced is None:
            raise ValueError("agent_team_output_template_ambiguous")
        return fenced.group("body").strip()
    if text.startswith("`"):
        inline = re.match(r"(?P<fence>`{1,2})(?P<body>[\s\S]*?)(?P=fence)", text)
        if inline is None:
            raise ValueError("agent_team_output_template_ambiguous")
        return inline.group("body").strip()
    return text


def _quoted(text: str) -> bool:
    closing, escaped = "", False
    pairs = {'"': '"', "'": "'", '«': '»', '“': '”', '‘': '’'}
    for index, character in enumerate(text):
        if escaped:
            escaped = False
        elif character == "\\" and closing:
            escaped = True
        elif closing and character == closing:
            closing = ""
        elif not closing and character in pairs:
            if character != "'" or not index or not text[index - 1].isalnum():
                closing = pairs[character]
    return (bool(closing) or text.count("```") % 2 == 1
            or len(re.findall(r"(?m)^[ \t]*~{3,}", text)) % 2 == 1)


def operation_for_output_keys(keys: set[str] | None, members: list[dict[str, Any]]) -> str:
    if not keys:
        return ""
    operations = operation_skills(members)
    matches = set()
    for member in members:
        if not member["available"]:
            continue
        for identifier in member.get("skills", []):
            operation = operations.get(identifier, "")
            if any(set(signature) == keys for signature in OUTPUT_SIGNATURES.get(operation, [])):
                matches.add(operation)
        for capability in member.get("capabilities", []):
            if capability["available"] and any(set(signature) == keys for signature in capability.get("output_signatures", [])):
                matches.add(str(capability.get("application_operation") or ""))
    return next(iter(matches)) if len(matches) == 1 else ""


def output_schema(plan: TeamPlan) -> dict[str, Any] | None:
    contract = plan.output_contract
    if contract is None:
        return None
    schema: dict[str, Any] = {"type": contract.type}
    if contract.type == "object":
        schema.update(properties={}, additionalProperties=contract.allow_extra_keys)
    for field in sorted(contract.fields, key=lambda value: len(value.path)):
        current = schema
        for index, part in enumerate(field.path):
            if not part or len(part) > 256:
                raise ValueError("agent_team_output_contract_invalid: invalid field path")
            kind = current.get("type", "object")
            if kind == "object":
                current.setdefault("type", "object")
                current.setdefault("additionalProperties", False)
                child = current.setdefault("properties", {}).setdefault(part, {})
                if field.required:
                    required = current.setdefault("required", [])
                    if part not in required:
                        required.append(part)
            elif kind == "array" and part == "*":
                child = current.setdefault("items", {})
            else:
                raise ValueError("agent_team_output_contract_invalid: path crosses a scalar or needs an array *")
            if index == len(field.path) - 1:
                _field_shape(child, field)
            current = child
    Draft202012Validator.check_schema(schema)
    _validate_choices(schema)
    return schema


def _validate_choices(node: dict[str, Any]) -> None:
    # Array choices can precede the later declaration of an object's fields.
    # Check the completed item shape before any provider receives the schema.
    from backend.services.json_contracts import validate_json_value
    try:
        for choice in node.get("enum", []):
            validate_json_value(choice, {key: value for key, value in node.items() if key != "enum"})
    except ValidationError as error:
        raise ValueError("agent_team_output_contract_invalid: choices must match the field type") from error
    for child in node.get("properties", {}).values():
        _validate_choices(child)
    if isinstance(node.get("items"), dict):
        _validate_choices(node["items"])


def _field_shape(node: dict[str, Any], field: TeamOutputField) -> None:
    if node.get("type") and node["type"] != field.type:
        raise ValueError("agent_team_output_contract_invalid: conflicting field types")
    node["type"] = field.type
    if field.type == "object":
        node.setdefault("properties", {})
        node.setdefault("additionalProperties", False)
    if field.type == "array" and field.choices:
        node.setdefault("items", {})["enum"] = field.choices
        return
    choices = field.choices or node.get("enum", [])
    if choices:
        from backend.services.json_contracts import validate_json_value
        try:
            for choice in choices:
                validate_json_value(choice, {"type": field.type})
        except ValidationError as error:
            raise ValueError("agent_team_output_contract_invalid: choices must match the field type") from error
        node["enum"] = choices


def operation_skills(members: list[dict[str, Any]]) -> dict[str, str]:
    known = {skill_id(operation): operation for operation in OPERATIONS}
    for member in members:
        for capability in member.get("capabilities", []):
            if capability["available"]:
                operation = capability.get("application_operation") or known.get(capability["canonical_id"])
                if isinstance(operation, str) and operation:
                    known[capability["id"]] = operation
                    known[capability["canonical_id"]] = operation
    return known


def task_route_ids(task: TeamTask, route: DirectRoute | None, members: list[dict[str, Any]]) -> list[str] | None:
    """Classification does not widen the receivers of a configured operation."""
    if route is None:
        return None
    operations = operation_skills(members)
    return route.agent_ids if any(operations.get(identifier) == route.operation for identifier in task.skill_ids) else None


def _validate_requested_output(schema: dict[str, Any] | None, keys: set[str] | None, required: bool,
                               requested_schema: dict[str, Any] | None) -> None:
    if required and schema is None:
        raise ValueError("agent_team_output_contract_required: define the requested JSON output")
    if keys is not None and (schema is None or schema.get("type") != "object"
                 or set(schema.get("properties", {})) != keys
                 or set(schema.get("required", [])) != keys
                 or schema.get("additionalProperties") is not False):
        raise ValueError("agent_team_output_contract_mismatch: preserve the current request's explicit JSON keys " + ", ".join(sorted(keys)))
    if requested_schema is not None and (schema is None or not _preserves_template(schema, requested_schema)):
        raise ValueError("agent_team_output_contract_mismatch: preserve the requested JSON template's shape and types")


def validate_plan_contract(plan: TeamPlan, members: list[dict[str, Any]], owner_id: str,
                           *, legacy_response: bool = False, required_operation: str = "", output_keys: set[str] | None = None,
                           require_output_contract: bool = False, requested_output_schema: dict[str, Any] | None = None) -> None:
    schema = output_schema(plan)
    dialogue = (bool(plan.response) and plan.response_kind in {"clarification", "unavailable"}
                and schema is None and not plan.response.lstrip().startswith(("{", "[", "```")))
    if not dialogue:
        _validate_requested_output(schema, output_keys, require_output_contract, requested_output_schema)
    operations = operation_skills(members)
    operation = required_operation or plan.operation
    if required_operation and plan.operation and plan.operation != required_operation:
        raise ValueError("agent_team_operation_mismatch: preserve the requested operation " + required_operation)
    if operation and operation not in set(operations.values()):
        raise ValueError("agent_team_unknown_operation: choose a catalog application_operation")
    if plan.response:
        if not plan.response_kind and not legacy_response:
            raise ValueError("agent_team_response_kind_required: classify dialogue or delegate the deliverable")
        available = [member for member in members if member["available"] and member["id"] != owner_id
                     and (not operation or any(operations.get(identifier) == operation
                                                   for identifier in member.get("skills", [])))]
        structured = schema is not None or plan.response.lstrip().startswith(("{", "```json", '["', "[{"))
        if available and (structured or (operation and plan.response_kind != "clarification")):
            raise ValueError("agent_team_specialist_required: delegate this operation or structured deliverable to an available specialist")
        if operation and plan.response_kind not in {"clarification", "unavailable"}:
            raise ValueError("agent_team_work_requires_task: use a bounded task for a deliverable")
        return
    if operation == "tables" and schema is not None and schema.get("type") == "object" and not schema.get("properties"):
        raise ValueError("agent_team_output_contract_incomplete: define the requested table field or button keys")
    if operation:
        final = next(task for task in plan.tasks if task.id == plan.result_task)
        if not any(operations.get(identifier) == operation for identifier in final.skill_ids):
            raise ValueError("agent_team_operation_skill_required: " + operation
                             + "; the result task must use this operation's assigned skill")
