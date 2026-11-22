"""Local operation and output checks for the coordinator's untrusted plan."""
from __future__ import annotations

from typing import Any
from collections.abc import Iterator
import json
import re

from jsonschema import Draft202012Validator, ValidationError
from markdown_it import MarkdownIt

from backend.services.agent_operation_catalog import OPERATIONS, OUTPUT_SIGNATURES, skill_id
from backend.services.agent_team_models import TeamPlan, TeamOutputField, TeamTask, DirectRoute

def required_operation(operation: str, active_skills: list[str]) -> str:
    """A plugin's operation prefix is not an application-skill assignment."""
    family = operation.split(".")[0]
    return family if family in OPERATIONS and skill_id(family) in active_skills else ""


def is_greeting(text: str) -> bool:
    return text.strip().casefold().rstrip(".!? ") in {"hola", "hello", "hi", "bonjour", "salut", "bon dia", "buenos días"}


def initial_greeting(data: dict[str, Any]) -> bool:
    refs = data.get("context_refs") or {}
    return (is_greeting(str(data.get("request") or ""))
            and not data.get("specialist_planning_requested")
            and not data.get("recent_conversation") and not data.get("current_message_has_source_context")
            and not data.get("authorized_tool_names") and isinstance(refs, dict) and not refs.get("count"))


def standalone_clarification(data: dict[str, Any]) -> dict[str, Any]:
    response = data.get("response")
    if (data.get("response_kind") == "clarification" and isinstance(response, str) and response.strip()
            and not data.get("output_contract") and not response.lstrip().startswith(("{", "[", "```"))):
        return {**data, "tasks": [], "result_task": "", "synthesize": False}
    return data


_ONLY = r"only|solely|exclusively|només|únicament|exclusivament|solo|solamente|únicamente|seulement|uniquement|exclusivement"
_EMPHASIS = r"(?:[*_]|~~)"
_OUTPUT_DIRECTIVE = re.compile(
    r"(?:\b|(?<=_))(?:(?:return|retornar?|devuelve|devolver|retourne(?:r|z)?|"
    r"respon(?:dre|-me)?|respond(?:e(?:r)?|a)?|reply|answer|contesta(?:r)?|répond(?:s|ez|re)?)\s+"
    rf"(?:(?:{_ONLY}|strictly|estrictament|estrictamente|strictement|exact|exactly|exactament|exactamente|exactement|"
    r"valid|vàlid|válido|valide|with|in|as|amb|en|con|avec|au|par|format|formato|the|el|le|a|an|un|una|une)\s+)*"
    r"(?:(?:l['’])?(?:objecte|objeto|objet|object)\s+)?JSON\b(?:\s+(?:objecte|objeto|objet|object)\b)?\s*:?|"
    r"(?:contract|contracte|contrato|contrat)\s*:)[ \n]*", re.I)

_DIRECTIVE_LEADIN = re.compile(
    r"(?:\b|(?<=_))(?:please|kindly|si us plau|sisplau|por favor|s['’]il (?:vous|te) pla[iî]t|merci de|"
    r"(?:can|could|would|will) you(?: please)?|(?:i|we) (?:need|want) you to|"
    r"(?:i would|i['’]d|we would) like you to|em pots|pots|podries|puedes|podrías|peux-tu|pouvez-vous|pourriez-vous)\s*[,\-]?\s*$", re.I)


def _directive_prefix(prefix: str) -> str:
    """Recognize rendered request boundaries without removing quoted source text."""
    previous = None
    while previous != prefix:
        previous = prefix
        prefix = re.sub(rf"{_EMPHASIS}+[ \t]*$", "", prefix)
        if (leadin := _DIRECTIVE_LEADIN.search(prefix)) is not None:
            prefix = prefix[:leadin.start()]
    marker = re.search(r"(?:^|[\n.!?;])[ \t]*(?:[-+*]|\d+[.)]|#{1,6})[ \t]+(?:\[[ xX]\][ \t]+)?$", prefix)
    return prefix[:marker.start()] + "\n" if marker else prefix


_MARKDOWN_BLOCKS = MarkdownIt("commonmark").disable("inline")


def _mask_source_blocks(request: str) -> str:
    """Keep JSON template offsets while excluding complete Markdown quotations and code blocks."""
    hidden_lines = {line for token in _MARKDOWN_BLOCKS.parse(request)
                    if token.map and token.type in {"blockquote_open", "code_block", "fence"}
                    for line in range(*token.map)}
    if not hidden_lines:
        return request
    lines = re.split(r"(?<=\n)|(?<=\r)(?!\n)", request)
    for line in hidden_lines:
        lines[line] = re.sub(r"[^\r\n]", "\0", lines[line])
    return "".join(lines)


def _output_directives(request: str) -> Iterator[re.Match[str]]:
    if not _OUTPUT_DIRECTIVE.search(request):
        return
    visible = _mask_source_blocks(request)
    for match in _OUTPUT_DIRECTIVE.finditer(visible):
        prefix = visible[:match.start()]
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


_FIELD_TYPES = {word: kind for kind, words in {
    "boolean": "boolean bool booleà booleana booleans booleanes booleano booleanos booleanas booléen booléenne booléens booléennes",
    "integer": "integer int enter entera enters enteres entero enteros enteras entier entière entiers entières",
    "number": "number numeric numerical numèric numèrica numèrics numèriques numérico numérica numéricos numéricas numérique numériques",
    "string": "string text textual texto cadena chaîne texte",
    "object": "object objecte objeto objet",
    "array": "array list llista lista liste tableau",
    "null": "null nul nul·la nulo nula nulle",
}.items() for word in words.split()}
_TYPE_WORD = "|".join(sorted(_FIELD_TYPES, key=len, reverse=True))
_CONJUNCTION = r"(?:and|i|y|et)"
_WITH_FIELDS = re.compile(
    rf"(?:,\s*)?(?:(?:{_ONLY})\s+)?(?:with|amb|con|avec|containing|that contains|que (?:contingui|tingui|contenga|tenga)|contenant|qui contient)\s+", re.I)
_FIELD_HEADER = re.compile(
    rf"(?:(?:{_ONLY}|the|a|an|one|la|el|le|les|els|las|los|des|una|un|une|single|únic[oa]?|sola?|seul|seule|"
    r"following|següents?|siguientes?|suivantes?)\s+)*"
    rf"(?:(?P<before>{_TYPE_WORD})\s+)?{_EMPHASIS}*"
    r"(?P<noun>keys?|claus?|claves?|clés?|fields?|camps?|campos?|champs?|propert(?:y|ies)|propietats?|propiedad(?:es)?|propriétés?)\b"
    rf"{_EMPHASIS}*(?:\s+(?:següents?|siguientes?|suivantes?|following))?"
    rf"(?:\s+(?:(?:of type|de tipus|de tipo|de type|de)\s+)?(?P<after>{_TYPE_WORD})\b"
    rf"(?=\s+(?!(?:{_CONJUNCTION}|{_ONLY}|as|without|sense|sin|sans)\b)[^\s,;.!?]|:))?"
    r"(?:\s+(?:named|called|anomenad[ae]s?|anomenats?|llamad[oa]s?|nomm[ée]e?s?))?\s*:?\s*", re.I)
_FIELD_NAME = re.compile(
    rf"(?:{_EMPHASIS}+(?=[\"'`«“‘]))?"
    r'(?P<name>"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\'|`[^`\n]*`|«[^»\n]*»|“[^”\n]*”|‘[^’\n]*’|[A-Za-z_][A-Za-z0-9_-]*)'
    rf"(?:{_EMPHASIS}+(?=\s*(?:[.!?,;\n]|$)))?")
_FIELD_TYPE_SUFFIX = re.compile(
    rf"\s*(?:\(\s*(?P<parenthetical>{_TYPE_WORD})\s*\)|"
    rf"(?::\s*|(?:of type|de tipus|de tipo|de type|as(?: an?| type)?)\s+)(?P<type>{_TYPE_WORD})\b)", re.I)
_FIELD_SEPARATOR = re.compile(rf"\s*,\s*(?:{_CONJUNCTION}\s+)?|\s+{_CONJUNCTION}\s+", re.I)
_FIELD_END = re.compile(
    rf"\s*(?!,\s*[\w-]+\s*(?:[.,;!?\n]|$|{_CONJUNCTION}\s+))"
    rf"(?:[.!?;\n]|$|,?\s*(?:{_ONLY}|without|sense|sin|sans|as|and nothing else|and no other keys|and do not|"
    r"i res més|y nada más|et rien d['’]autre)\b)", re.I)
_AMBIGUOUS_KEYS = "agent_team_output_keys_ambiguous: provide a JSON object or an explicit key list"


def _field_type(*words: str | None) -> str | None:
    kinds = {_FIELD_TYPES.get(word.casefold()) for word in words if word}
    if None in kinds or len(kinds) > 1:
        raise ValueError(_AMBIGUOUS_KEYS)
    return next(iter(kinds), None)


def _read_field_name(text: str) -> tuple[str, str]:
    match = _FIELD_NAME.match(text)
    if not match:
        raise ValueError(_AMBIGUOUS_KEYS)
    token = match["name"]
    if token.startswith('"'):
        name = json.loads(token)
    elif token.startswith(("'", "`", "«", "“", "‘")):
        name = re.sub(r"\\([\\'])", r"\1", token[1:-1])
    else:
        name = token
    return name, text[match.end():]


def _named_output_schema(text: str) -> dict[str, Any] | None:
    connector = _WITH_FIELDS.match(text)
    if not connector:
        return None
    text = text[connector.end():]
    header = _FIELD_HEADER.match(text)
    if not header:
        return None
    properties: dict[str, dict[str, str]] = {}
    shared_type = None
    while True:
        kind = shared_type
        if header:
            kind = _field_type(header["before"], header["after"])
            shared_type = kind if header["noun"].casefold().endswith("s") else None
            text = text[header.end():]
        name, text = _read_field_name(text)
        suffix = _FIELD_TYPE_SUFFIX.match(text)
        if suffix:
            kind = _field_type(kind, suffix["type"], suffix["parenthetical"])
            text = text[suffix.end():]
        kind = _field_type(kind, properties.get(name, {}).get("type"))
        properties[name] = {"type": kind} if kind else {}
        if _FIELD_END.match(text):
            break
        separator = _FIELD_SEPARATOR.match(text)
        if not separator:
            raise ValueError(_AMBIGUOUS_KEYS)
        text = text[separator.end():]
        # At a list boundary, "field" or "key" can itself be the property name.
        bare = _FIELD_NAME.match(text)
        boundaries = (_FIELD_SEPARATOR, _FIELD_END, _FIELD_TYPE_SUFFIX)
        if bare and any(rule.match(text, bare.end()) for rule in boundaries):
            header = None
        else:
            header = _FIELD_HEADER.match(text)
    return {"type": "object", "properties": properties, "required": sorted(properties), "additionalProperties": False}


def explicit_output_schema(request: str) -> dict[str, Any] | None:
    """Preserve the shape and JSON types of an explicit output template."""
    for match in reversed(list(_output_directives(request))):
        remaining = request[match.end():].lstrip()
        remaining = re.sub(rf"^{_EMPHASIS}+(?=\s*(?:[\[{{]|{_WITH_FIELDS.pattern}))", "", remaining, flags=re.I).lstrip()
        remaining = _output_template(remaining)
        try:
            value, _ = json.JSONDecoder(parse_constant=_invalid_json_constant).raw_decode(remaining)
        except ValueError:
            if re.match(r'^[{\["0-9-]|^(?:true|false|null)\b', remaining):
                raise ValueError("agent_team_output_template_ambiguous") from None
        else:
            return _template_schema(value)
        named = _named_output_schema(remaining)
        if named is not None:
            return named
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
    if kind == "object" and "properties" in requested:
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


_QUOTE_PAIRS = {'"': '"', "'": "'", '«': '»', '“': '”', '‘': '’'}
_SOURCE_MARKERS = re.compile(r"""\\.|`+|["«»“”‘]|(?<!\w)['’]|['’](?!\w)""")


def _quoted(text: str) -> bool:
    """Check the position of an instruction within prose quotations and inline code."""
    closing: list[str] = []
    for marker in _SOURCE_MARKERS.finditer(text):
        token = marker.group()
        if closing:
            delimiter = closing[-1]
            if token == delimiter:
                closing.pop()
            elif _QUOTE_PAIRS.get(token) == delimiter:  # Nested guillemets or curly quotes.
                closing.append(delimiter)
        elif token in _QUOTE_PAIRS:
            if token != "'" or marker.start() == 0 or not text[marker.start() - 1].isalnum():
                closing.append(_QUOTE_PAIRS[token])
        elif token.startswith("`"):
            closing.append(token)
    return bool(closing)


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
