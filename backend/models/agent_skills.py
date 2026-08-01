"""Typed contracts for agent skills and governed tools."""

from __future__ import annotations

import json
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


NAMESPACED_ID_PATTERN = (
    r"^(?:core|user|mcp|generated|plugin\.[a-z0-9][a-z0-9_-]{1,63})"
    r"\.[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$"
)
VERSION_PATTERN = r"^[0-9]+(?:\.[0-9]+){0,2}(?:[-+][a-zA-Z0-9.-]+)?$"


class SkillKind(str, Enum):
    """Supported skill package categories."""

    AGENT = "agent"
    ACTION = "action"
    AUTOMATION = "automation"
    DEVELOPER = "developer"


class SkillActivation(str, Enum):
    """How a skill may become active during a turn."""

    ALWAYS = "always"
    AUTOMATIC = "automatic"
    EXPLICIT = "explicit"


class OriginType(str, Enum):
    """Governed source types for catalog entries."""

    CORE = "core"
    PLUGIN = "plugin"
    USER = "user"
    MCP = "mcp"
    GENERATED = "generated"


class ToolEffect(str, Enum):
    """Effect classes used by the authorization policy."""

    READ = "read"
    LOCAL_WRITE = "local_write"
    EXTERNAL_WRITE = "external_write"
    DESTRUCTIVE = "destructive"
    CODE_EXECUTION = "code_execution"
    AI_COST = "ai_cost"


class ConfirmationPolicy(str, Enum):
    """Minimum turn-level authorization required by a tool."""

    NONE = "none"
    EXPLICIT_REQUEST = "explicit_request"
    ALWAYS = "always"


class CatalogStatus(str, Enum):
    """Lifecycle state for a catalog entry."""

    AVAILABLE = "available"
    SUSPENDED = "suspended"
    PENDING = "pending"
    REJECTED = "rejected"
    UNAVAILABLE = "unavailable"


class CatalogOrigin(BaseModel):
    """Ownership metadata derived by core or a plugin boundary."""

    model_config = ConfigDict(extra="forbid")

    type: OriginType
    id: str = Field(min_length=1, max_length=128)

    @field_validator("id")
    @classmethod
    def normalize_id(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized:
            raise ValueError("origin id is required")
        return normalized


def _expected_namespace(origin: CatalogOrigin) -> str:
    if origin.type == OriginType.PLUGIN:
        return f"plugin.{origin.id}."
    return f"{origin.type.value}."


def _validate_json_object(value: Dict[str, Any], field_name: str) -> Dict[str, Any]:
    try:
        json.dumps(value, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must contain JSON-safe values") from exc
    return value


class SkillDescriptor(BaseModel):
    """Declarative skill metadata plus its human-authored instructions."""

    model_config = ConfigDict(extra="forbid", use_enum_values=False)

    schema_version: int = Field(default=1, ge=1, le=1)
    id: str = Field(pattern=NAMESPACED_ID_PATTERN, min_length=3, max_length=160)
    version: str = Field(default="1.0.0", pattern=VERSION_PATTERN, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    origin: CatalogOrigin
    kind: SkillKind = SkillKind.AGENT
    activation: SkillActivation = SkillActivation.AUTOMATIC
    tool_ids: List[str] = Field(default_factory=list, max_length=64)
    instructions: str = Field(default="", max_length=100_000)
    status: CatalogStatus = CatalogStatus.AVAILABLE
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("id")
    @classmethod
    def normalize_descriptor_id(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name is required")
        return normalized

    @field_validator("tool_ids")
    @classmethod
    def validate_tool_ids(cls, values: List[str]) -> List[str]:
        normalized: List[str] = []
        seen = set()
        for value in values:
            tool_id = str(value or "").strip().lower()
            if not tool_id:
                raise ValueError("tool IDs cannot be empty")
            # Reuse Pydantic's pattern validation by validating the value as the
            # ID of a minimal descriptor would make error messages opaque.
            import re

            if not re.fullmatch(NAMESPACED_ID_PATTERN, tool_id):
                raise ValueError(f"invalid namespaced tool ID: {tool_id}")
            if tool_id in seen:
                raise ValueError(f"duplicate tool ID: {tool_id}")
            seen.add(tool_id)
            normalized.append(tool_id)
        return normalized

    @field_validator("metadata")
    @classmethod
    def validate_metadata(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return _validate_json_object(value, "metadata")

    @model_validator(mode="after")
    def validate_namespace(self) -> "SkillDescriptor":
        expected = _expected_namespace(self.origin)
        if not self.id.startswith(expected):
            raise ValueError(
                f"skill ID {self.id!r} must use the {expected!r} namespace"
            )
        return self


class ToolDescriptor(BaseModel):
    """Typed executable capability metadata.

    The descriptor never stores a Python callable. A callable is held by the
    in-memory catalog registration and cannot be serialized into a skill.
    """

    model_config = ConfigDict(extra="forbid", use_enum_values=False)

    schema_version: int = Field(default=1, ge=1, le=1)
    id: str = Field(pattern=NAMESPACED_ID_PATTERN, min_length=3, max_length=160)
    version: str = Field(default="1.0.0", pattern=VERSION_PATTERN, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    origin: CatalogOrigin
    input_schema: Dict[str, Any] = Field(
        default_factory=lambda: {"type": "object", "properties": {}}
    )
    output_schema: Dict[str, Any] = Field(default_factory=dict)
    effects: List[ToolEffect] = Field(default_factory=lambda: [ToolEffect.READ])
    minimum_role: str = "viewer"
    confirmation: ConfirmationPolicy = ConfirmationPolicy.NONE
    handler_ref: Optional[str] = Field(default=None, max_length=300)
    status: CatalogStatus = CatalogStatus.AVAILABLE
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("id")
    @classmethod
    def normalize_descriptor_id(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name is required")
        return normalized

    @field_validator("minimum_role")
    @classmethod
    def validate_minimum_role(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"viewer", "editor", "admin", "owner"}:
            raise ValueError("minimum_role must be viewer, editor, admin, or owner")
        return normalized

    @field_validator("effects")
    @classmethod
    def validate_effects(cls, values: List[ToolEffect]) -> List[ToolEffect]:
        if not values:
            raise ValueError("at least one tool effect is required")
        if len(set(values)) != len(values):
            raise ValueError("tool effects must be unique")
        return values

    @field_validator("input_schema")
    @classmethod
    def validate_input_schema(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        schema = _validate_json_object(value, "input_schema")
        if schema.get("type", "object") != "object":
            raise ValueError("input_schema must describe an object")
        properties = schema.get("properties", {})
        if not isinstance(properties, dict):
            raise ValueError("input_schema.properties must be an object")
        required = schema.get("required", [])
        if not isinstance(required, list) or not all(
            isinstance(item, str) for item in required
        ):
            raise ValueError("input_schema.required must be a list of strings")
        unknown_required = set(required).difference(properties)
        if unknown_required:
            raise ValueError(
                "input_schema.required references undefined properties: "
                + ", ".join(sorted(unknown_required))
            )
        return schema

    @field_validator("output_schema")
    @classmethod
    def validate_output_schema(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return _validate_json_object(value, "output_schema")

    @field_validator("metadata")
    @classmethod
    def validate_metadata(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return _validate_json_object(value, "metadata")

    @model_validator(mode="after")
    def validate_policy_and_namespace(self) -> "ToolDescriptor":
        expected = _expected_namespace(self.origin)
        if not self.id.startswith(expected):
            raise ValueError(
                f"tool ID {self.id!r} must use the {expected!r} namespace"
            )
        sensitive = {
            ToolEffect.LOCAL_WRITE,
            ToolEffect.EXTERNAL_WRITE,
            ToolEffect.DESTRUCTIVE,
            ToolEffect.CODE_EXECUTION,
            ToolEffect.AI_COST,
        }
        if sensitive.intersection(self.effects) and self.confirmation == ConfirmationPolicy.NONE:
            raise ValueError(
                "write, destructive, code, and AI-cost tools require turn authorization"
            )
        if (
            ToolEffect.EXTERNAL_WRITE in self.effects
            or ToolEffect.DESTRUCTIVE in self.effects
        ) and self.confirmation != ConfirmationPolicy.ALWAYS:
            raise ValueError(
                "external_write and destructive tools require confirmation=always"
            )
        return self


class SkillCatalogEntry(BaseModel):
    """Effective skill descriptor with derived availability and effects."""

    model_config = ConfigDict(extra="forbid")

    descriptor: SkillDescriptor
    available: bool
    missing_tool_ids: List[str] = Field(default_factory=list)
    effects: List[ToolEffect] = Field(default_factory=list)
    editable: bool = False
    deletable: bool = False
    revision: str


class AgentSkillResolution(BaseModel):
    """Resolved assignments without any implicit fallback."""

    model_config = ConfigDict(extra="forbid")

    assigned_skill_ids: List[str]
    skills: List[SkillCatalogEntry]
    missing_skill_ids: List[str]
    tool_ids: List[str]
    unavailable_tool_ids: List[str]
    catalog_revision: str
