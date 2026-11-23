"""Catalog data shared for a single synchronous team metadata read."""
from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import Future
from contextlib import ExitStack, contextmanager
from contextvars import ContextVar
from functools import cache
from pathlib import Path
from typing import TYPE_CHECKING, Any

from backend.models.agent_skills import CatalogStatus, OriginType, SkillCatalogEntry, SkillDescriptor
from backend.services.agent_capability_contract import validate_versioned_capability
from backend.services.agent_catalog_models import ToolRegistration
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_execution_scope import current_scope
from backend.services.agent_team_skill_sources import ChatSkillSources, DiscoveryPhase, ReadPackage, ReadText, chat_sources
from backend.services.user_skill_store import USER_SKILL_ID_RE, UserSkillStore
from backend.utils.metadata_io import read_metadata_text

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
        self.package_reader: ReadPackage | None = None
        self.capture_sources: ChatSkillSources | None = None
        self._capture_attempts: set[str] = set()

    def capture_assigned(self, assigned: Iterable[str]) -> None:
        if self.capture_sources is None:
            return
        eligible = dict.fromkeys(key for key in assigned if USER_SKILL_ID_RE.fullmatch(key)
                                 and key not in self._capture_attempts and key not in self._loaded)
        if eligible and not self.root.is_symlink() and self._can_group_cloud_reads():
            self._capture_attempts.update(eligible)
            self._loaded.update(self.capture_sources.capture_assigned(self, eligible, super()._load_package))

    def _assigned_cloud_reads(self, pending: list[str], cleanup: ExitStack) -> dict[str, Future[SkillDescriptor]]:
        self.capture_assigned(reversed(pending))
        return super()._assigned_cloud_reads([key for key in pending if key not in self._loaded], cleanup)

    def _load_package(self, package: Path, read_text: ReadText = read_metadata_text) -> SkillDescriptor:
        if self.package_reader is None:
            return super()._load_package(package, read_text)
        return self.package_reader(package, super()._load_package)

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

    def use_personal_sources(self, reader: ReadPackage | None, capture: ChatSkillSources | None = None) -> None:
        if self._user_store is not None:
            self._user_store.package_reader = reader
            self._user_store.capture_sources = capture if reader is not None else None

    def capture_assigned(self, assigned: Iterable[str]) -> None:
        if self._user_store is not None:
            self._user_store.capture_assigned(assigned)

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


def capture_roster_sources(vault: Path, profiles: Iterable[dict[str, Any]]) -> None:
    """Request only the personal assignments of the eligible members supplied by the roster."""
    reader = _reader.get()
    if reader is not None and chat_sources.get() is not None:
        from backend.services.agent_skill_catalog import get_skill_catalog
        assigned = (str(value or "").strip().lower() for profile in profiles for value in profile.get("skill_ids") or [])
        reader(get_skill_catalog(), vault).capture_assigned(assigned)


@contextmanager
def team_metadata_catalog(*, personal_phase: DiscoveryPhase | None = None) -> Iterator[None]:
    """Share underlying providers only while reading member metadata in this call."""
    if _reader.get() is not None:
        yield
        return

    active = True
    sources = chat_sources.get() if personal_phase else None

    @cache
    def cached(catalog: SkillCatalog, vault_path: Path | None, _scope: ExecutionScope | None) -> RuntimeCatalogSnapshot:
        result = catalog.runtime_snapshot(vault_path)
        if sources is not None and personal_phase is not None and vault_path is not None:
            result.use_personal_sources(sources.reader(vault_path, personal_phase),
                                        sources if personal_phase == "capture" else None)
        return result

    def snapshot(catalog: SkillCatalog, vault_path: Path | None) -> RuntimeCatalogSnapshot:
        if not active:
            return catalog.runtime_snapshot(vault_path)
        scope = current_scope() if sources is not None and vault_path is not None else None
        return cached(catalog, vault_path, scope)

    token = _reader.set(snapshot)
    try:
        yield
    finally:
        active = False
        cached.cache_clear()
        _reader.reset(token)
        if sources is not None and personal_phase == "planning":
            sources.close()
