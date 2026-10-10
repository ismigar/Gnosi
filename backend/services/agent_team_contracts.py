"""Local operation and output checks for the coordinator's untrusted plan."""
from __future__ import annotations

from typing import Any
import json
import re

from jsonschema import Draft202012Validator, ValidationError

from backend.services.agent_operation_catalog import OPERATIONS, OUTPUT_SIGNATURES, skill_id
from backend.services.agent_team_models import TeamPlan, TeamOutputField

def required_operation(operation: str, active_skills: list[str]) -> str:
    """A plugin's operation prefix is not an application-skill assignment."""
    family = operation.split(".")[0]
    return family if family in OPERATIONS and skill_id(family) in active_skills else ""


def explicit_output_keys(request: str) -> set[str]:
    """Read a complete JSON format example after an unquoted return directive."""
    directive = re.compile(r"\b(?:return|retorna|devuelve|retourne)\s+(?:(?:only|només|solo|seulement|exactly|exactament|exactamente|exactement)\s+)?JSON\s*:?[ \n]*", re.I)
    for match in reversed(list(directive.finditer(request))):
        prefix = request[:match.start()]
        if _quoted(prefix) or (prefix.strip() and prefix.rstrip(" \t")[-1] not in ".!?;\n"):
            continue
        try:
            value, _ = json.JSONDecoder().raw_decode(request[match.end():].lstrip())
        except ValueError:
            continue
        if isinstance(value, dict) and value:
            return set(value)
    return set()


def _quoted(text: str) -> bool:
    closing, escaped = "", False
    pairs = {'"': '"', "'": "'", '«': '»', '“': '”'}
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
    return bool(closing) or text.count("```") % 2 == 1


def operation_for_output_keys(keys: set[str], members: list[dict[str, Any]]) -> str:
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
    return schema


def _field_shape(node: dict[str, Any], field: TeamOutputField) -> None:
    if node.get("type") and node["type"] != field.type:
        raise ValueError("agent_team_output_contract_invalid: conflicting field types")
    node["type"] = field.type
    if field.type == "object":
        node.setdefault("properties", {})
        node.setdefault("additionalProperties", False)
    if field.choices:
        from backend.services.json_contracts import validate_json_value
        try:
            for choice in field.choices:
                validate_json_value(choice, {"type": field.type})
        except ValidationError as error:
            raise ValueError("agent_team_output_contract_invalid: choices must match the field type") from error
        node["enum"] = field.choices


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


def validate_plan_contract(plan: TeamPlan, members: list[dict[str, Any]], owner_id: str,
                           *, legacy_response: bool = False, required_operation: str = "", output_keys: set[str] | None = None) -> None:
    schema = output_schema(plan)
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
    if output_keys and (schema is None or schema.get("type") != "object" or set(schema.get("properties", {})) != output_keys):
        raise ValueError("agent_team_output_contract_mismatch: preserve the current request's explicit JSON keys " + ", ".join(sorted(output_keys)))
    if operation == "tables" and schema is not None and schema.get("type") == "object" and not schema.get("properties"):
        raise ValueError("agent_team_output_contract_incomplete: define the requested table field or button keys")
    if operation:
        final = next(task for task in plan.tasks if task.id == plan.result_task)
        if not any(operations.get(identifier) == operation for identifier in final.skill_ids):
            raise ValueError("agent_team_operation_skill_required: " + operation
                             + "; the result task must use this operation's assigned skill")

