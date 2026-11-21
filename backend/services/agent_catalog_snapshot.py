"""Catalog data shared for a single synchronous team metadata read."""
from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from functools import cache
from pathlib import Path
from typing import TYPE_CHECKING, Any

from backend.models.agent_skills import CatalogStatus, OriginType, SkillCatalogEntry, SkillDescriptor
from backend.services.agent_capability_contract import validate_versioned_capability
from backend.services.agent_catalog_models import ToolRegistration
from backend.services.user_skill_store import UserSkillStore

if TYPE_CHECKING:
    from backend.services.agent_skill_catalog import SkillCatalog


def stable_hash(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def is_runtime_handler(handler: Any) -> bool:
    return bool(
        callable(handler)
        or callable(getattr(handler, "invoke", None))
        or callable(getattr(handler, "ainvoke", None))
    )


def tool_revision(tools: dict[str, ToolRegistration]) -> str:
    return stable_hash([
        registration.descriptor.model_dump(mode="json")
        for _, registration in sorted(tools.items())
    ])


def entries_revision(entries: Iterable[SkillCatalogEntry], tools_revision: str) -> str:
    return stable_hash({
        "skills": [entry.model_dump(mode="json") for entry in entries],
        "tools": tools_revision,
    })


def skill_entry(descriptor: SkillDescriptor, tools: dict[str, ToolRegistration]) -> SkillCatalogEntry:
    missing = []
    effects = set()
    for identifier in descriptor.tool_ids:
        tool = tools.get(identifier)
        if (
            tool is None
            or tool.descriptor.status != CatalogStatus.AVAILABLE
            or not is_runtime_handler(tool.handler)
        ):
            missing.append(identifier)
        else:
            effects.update(tool.descriptor.effects)
    return SkillCatalogEntry(
        descriptor=descriptor,
        available=descriptor.status == CatalogStatus.AVAILABLE and not missing,
        missing_tool_ids=missing,
        effects=sorted(effects, key=lambda effect: effect.value),
        editable=descriptor.origin.type == OriginType.USER,
        deletable=descriptor.origin.type == OriginType.USER,
        revision=stable_hash(descriptor.model_dump(mode="json")),
    )


class _SnapshotUserSkills(UserSkillStore):
    """Read each shared personal procedure and ancestor once in this metadata batch."""

    def __init__(self, vault_path: Path) -> None:
        super().__init__(vault_path)
        self._loaded: dict[str, SkillDescriptor] = {}

    def load(self, skill_id: str) -> SkillDescriptor:
        if skill_id not in self._loaded:
            self._loaded[skill_id] = super().load(skill_id)
        return self._loaded[skill_id]


class RuntimeCatalogSnapshot:
    """Project one governed registry onto each profile's own personal skill ancestry."""

    def __init__(self, tools: dict[str, ToolRegistration], registered: dict[str, SkillDescriptor],
                 vault_path: Path | None) -> None:
        self.tools = tools
        self._tools_revision = tool_revision(tools)
        self._registered = registered
        self._entries = {key: skill_entry(descriptor, tools) for key, descriptor in registered.items()}
        self._user_store = _SnapshotUserSkills(vault_path) if vault_path is not None else None
        self._personal: dict[str, SkillCatalogEntry] = {}
        self._views: dict[tuple[str, ...], tuple[dict[str, SkillCatalogEntry], str]] = {}

    def entries_for(self, assigned: tuple[str, ...]) -> tuple[dict[str, SkillCatalogEntry], str]:
        personal = (
            self._user_store.load_referenced(assigned, self._registered)
            if self._user_store and assigned else []
        )
        key = tuple(sorted(descriptor.id for descriptor in personal))
        if key not in self._views:
            entries = self._entries.copy()
            for descriptor in personal:
                if descriptor.id in self._registered:
                    from backend.services.agent_skill_catalog import CatalogConflictError
                    raise CatalogConflictError(f"duplicate skill ID: {descriptor.id}")
                if descriptor.id not in self._personal:
                    validate_versioned_capability(descriptor)
                    self._personal[descriptor.id] = skill_entry(descriptor, self.tools)
                entries[descriptor.id] = self._personal[descriptor.id]
            revision = entries_revision(
                (entry for _, entry in sorted(entries.items())), self._tools_revision,
            )
            self._views[key] = entries, revision
        return self._views[key]


_reader: ContextVar[Callable[[SkillCatalog, Path | None], RuntimeCatalogSnapshot] | None] = ContextVar(
    "agent_team_catalog_reader", default=None,
)


def read_runtime_catalog(catalog: SkillCatalog, vault_path: Path | None) -> RuntimeCatalogSnapshot:
    reader = _reader.get()
    return reader(catalog, vault_path) if reader is not None else catalog.runtime_snapshot(vault_path)


@contextmanager
def team_metadata_catalog() -> Iterator[None]:
    """Share underlying providers only while reading member metadata in this call."""
    @cache
    def snapshot(catalog: SkillCatalog, vault_path: Path | None) -> RuntimeCatalogSnapshot:
        return catalog.runtime_snapshot(vault_path)

    token = _reader.set(snapshot)
    try:
        yield
    finally:
        _reader.reset(token)
