"""Effective catalogs and runtime resolution for agent skills and tools."""

from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Mapping, Optional, Tuple, Union

from backend.models.agent_skills import (
    AgentSkillResolution,
    CatalogOrigin,
    CatalogStatus,
    OriginType,
    SkillActivation,
    SkillCatalogEntry,
    SkillDescriptor,
    SkillKind,
    ToolDescriptor,
)
from backend.services.agent_capability_contract import validate_versioned_capability


class CatalogConflictError(ValueError):
    """Raised when two governed sources publish the same stable ID."""


class CatalogProviderError(ValueError):
    """Raised when a provider publishes an invalid contribution."""


@dataclass(frozen=True)
class ToolRegistration:
    """A serializable descriptor paired with an in-process runtime adapter."""

    descriptor: ToolDescriptor
    handler: Any = None


@dataclass(frozen=True)
class AgentRuntimeCapabilities:
    """Exact skills and tools made eligible for a compiled runtime."""

    assigned_skill_ids: Tuple[str, ...]
    active_skill_ids: Tuple[str, ...]
    instructions: Tuple[str, ...]
    tools: Tuple[Any, ...]
    tool_descriptors: Tuple[ToolDescriptor, ...]
    skills: Tuple[SkillCatalogEntry, ...]
    missing_skill_ids: Tuple[str, ...]
    unavailable_tool_ids: Tuple[str, ...]
    catalog_revision: str


SkillProvider = Callable[[], Iterable[Union[SkillDescriptor, Mapping[str, Any]]]]
ToolProvider = Callable[
    [],
    Iterable[
        Union[
            ToolRegistration,
            ToolDescriptor,
            Mapping[str, Any],
        ]
    ],
]


def _stable_hash(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _descriptor_dump(descriptor: Union[SkillDescriptor, ToolDescriptor]) -> Dict[str, Any]:
    return descriptor.model_dump(mode="json")


def _plugin_origin(plugin_id: str) -> CatalogOrigin:
    return CatalogOrigin(type=OriginType.PLUGIN, id=plugin_id)


def _is_runtime_handler(handler: Any) -> bool:
    return bool(
        callable(handler)
        or callable(getattr(handler, "invoke", None))
        or callable(getattr(handler, "ainvoke", None))
    )


def _normalize_plugin_id(plugin_id: str) -> str:
    normalized = str(plugin_id or "").strip().lower()
    if not normalized:
        raise ValueError("plugin_id is required")
    import re

    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,63}", normalized):
        raise ValueError(f"invalid plugin_id: {plugin_id!r}")
    return normalized


def _coerce_plugin_skill(plugin_id: str, value: Any) -> SkillDescriptor:
    raw = value.model_dump(mode="python") if isinstance(value, SkillDescriptor) else dict(value)
    raw["origin"] = _plugin_origin(plugin_id).model_dump(mode="python")
    try:
        descriptor = SkillDescriptor.model_validate(raw)
        validate_versioned_capability(descriptor)
        return descriptor
    except Exception as exc:
        raise CatalogProviderError(
            f"plugin {plugin_id!r} published an invalid skill: {exc}"
        ) from exc


def _coerce_plugin_tool(plugin_id: str, value: Any) -> ToolRegistration:
    handler = None
    descriptor_value = value
    if isinstance(value, ToolRegistration):
        descriptor_value = value.descriptor
        handler = value.handler
    raw = (
        descriptor_value.model_dump(mode="python")
        if isinstance(descriptor_value, ToolDescriptor)
        else dict(descriptor_value)
    )
    # A mapping provider may attach a non-serializable handler next to the
    # descriptor for convenience. It is removed before model validation.
    handler = raw.pop("handler", handler)
    raw["origin"] = _plugin_origin(plugin_id).model_dump(mode="python")
    try:
        descriptor = ToolDescriptor.model_validate(raw)
        validate_versioned_capability(descriptor)
    except Exception as exc:
        raise CatalogProviderError(
            f"plugin {plugin_id!r} published an invalid tool: {exc}"
        ) from exc
    if handler is not None and not _is_runtime_handler(handler):
        raise CatalogProviderError(
            f"plugin {plugin_id!r} published a non-executable handler "
            f"for tool {descriptor.id!r}"
        )
    return ToolRegistration(descriptor=descriptor, handler=handler)


def _coerce_generated_tool(value: Any) -> ToolRegistration:
    handler = None
    descriptor_value = value
    if isinstance(value, ToolRegistration):
        descriptor_value = value.descriptor
        handler = value.handler
    raw = (
        descriptor_value.model_dump(mode="python")
        if isinstance(descriptor_value, ToolDescriptor)
        else dict(descriptor_value)
    )
    handler = raw.pop("handler", handler)
    raw["origin"] = CatalogOrigin(
        type=OriginType.GENERATED,
        id="approved",
    ).model_dump(mode="python")
    try:
        descriptor = ToolDescriptor.model_validate(raw)
        validate_versioned_capability(descriptor)
    except Exception as exc:
        raise CatalogProviderError(
            f"generated tool provider published an invalid tool: {exc}"
        ) from exc
    if handler is not None and not _is_runtime_handler(handler):
        raise CatalogProviderError(
            f"generated tool {descriptor.id!r} has no executable adapter"
        )
    return ToolRegistration(descriptor=descriptor, handler=handler)


def _coerce_mcp_tool(value: Any) -> ToolRegistration:
    handler = None
    descriptor_value = value
    if isinstance(value, ToolRegistration):
        descriptor_value = value.descriptor
        handler = value.handler
    raw = (
        descriptor_value.model_dump(mode="python")
        if isinstance(descriptor_value, ToolDescriptor)
        else dict(descriptor_value)
    )
    handler = raw.pop("handler", handler)
    origin_id = str(raw.pop("_origin_id", "connector") or "connector")
    raw["origin"] = CatalogOrigin(
        type=OriginType.MCP,
        id=origin_id,
    ).model_dump(mode="python")
    try:
        descriptor = ToolDescriptor.model_validate(raw)
        validate_versioned_capability(descriptor)
    except Exception as exc:
        raise CatalogProviderError(
            f"MCP tool provider published an invalid tool: {exc}"
        ) from exc
    if handler is not None and not _is_runtime_handler(handler):
        raise CatalogProviderError(
            f"MCP tool {descriptor.id!r} has no executable adapter"
        )
    return ToolRegistration(descriptor=descriptor, handler=handler)


class ToolCatalog:
    """Thread-safe catalog of core tools and lazily supplied plugin tools."""

    def __init__(self) -> None:
        self._core: Dict[str, ToolRegistration] = {}
        self._plugin_providers: Dict[str, ToolProvider] = {}
        self._generated_providers: Dict[str, ToolProvider] = {}
        self._mcp_providers: Dict[str, ToolProvider] = {}
        self._lock = threading.RLock()

    def register_core(
        self,
        descriptor: Union[ToolDescriptor, Mapping[str, Any]],
        handler: Any = None,
    ) -> None:
        raw = (
            descriptor.model_dump(mode="python")
            if isinstance(descriptor, ToolDescriptor)
            else dict(descriptor)
        )
        raw["origin"] = CatalogOrigin(
            type=OriginType.CORE, id="gnosi"
        ).model_dump(mode="python")
        parsed = ToolDescriptor.model_validate(raw)
        validate_versioned_capability(parsed)
        if handler is not None and not _is_runtime_handler(handler):
            raise TypeError(f"tool handler for {parsed.id!r} is not executable")
        with self._lock:
            if parsed.id in self._core:
                raise CatalogConflictError(f"duplicate tool ID: {parsed.id}")
            self._core[parsed.id] = ToolRegistration(parsed, handler)

    def register_plugin_provider(self, plugin_id: str, provider: ToolProvider) -> None:
        normalized = _normalize_plugin_id(plugin_id)
        if not callable(provider):
            raise TypeError("tool provider must be callable")
        with self._lock:
            self._plugin_providers[normalized] = provider

    def unregister_plugin_provider(self, plugin_id: str) -> None:
        normalized = _normalize_plugin_id(plugin_id)
        with self._lock:
            self._plugin_providers.pop(normalized, None)

    def register_generated_provider(
        self, provider_id: str, provider: ToolProvider
    ) -> None:
        normalized = str(provider_id or "").strip().lower()
        if not normalized or not callable(provider):
            raise ValueError("generated tool provider id and callable are required")
        with self._lock:
            self._generated_providers[normalized] = provider

    def register_mcp_provider(
        self, provider_id: str, provider: ToolProvider
    ) -> None:
        normalized = str(provider_id or "").strip().lower()
        if not normalized or not callable(provider):
            raise ValueError("MCP tool provider id and callable are required")
        with self._lock:
            self._mcp_providers[normalized] = provider

    def snapshot(self) -> Dict[str, ToolRegistration]:
        with self._lock:
            result = dict(self._core)
            providers = tuple(self._plugin_providers.items())
            generated_providers = tuple(self._generated_providers.items())
            mcp_providers = tuple(self._mcp_providers.items())
        for plugin_id, provider in providers:
            try:
                supplied = provider() or ()
            except Exception as exc:
                raise CatalogProviderError(
                    f"tool provider for plugin {plugin_id!r} failed: {exc}"
                ) from exc
            for value in supplied:
                registration = _coerce_plugin_tool(plugin_id, value)
                tool_id = registration.descriptor.id
                if tool_id in result:
                    raise CatalogConflictError(f"duplicate tool ID: {tool_id}")
                result[tool_id] = registration
        for provider_id, provider in generated_providers:
            try:
                supplied = provider() or ()
            except Exception as exc:
                raise CatalogProviderError(
                    f"generated tool provider {provider_id!r} failed: {exc}"
                ) from exc
            for value in supplied:
                registration = _coerce_generated_tool(value)
                tool_id = registration.descriptor.id
                if tool_id in result:
                    raise CatalogConflictError(f"duplicate tool ID: {tool_id}")
                result[tool_id] = registration
        for provider_id, provider in mcp_providers:
            try:
                supplied = provider() or ()
            except Exception as exc:
                raise CatalogProviderError(
                    f"MCP tool provider {provider_id!r} failed: {exc}"
                ) from exc
            for value in supplied:
                registration = _coerce_mcp_tool(value)
                tool_id = registration.descriptor.id
                if tool_id in result:
                    raise CatalogConflictError(f"duplicate tool ID: {tool_id}")
                result[tool_id] = registration
        return result

    def list(self) -> Tuple[ToolDescriptor, ...]:
        return tuple(
            registration.descriptor
            for _, registration in sorted(self.snapshot().items())
        )

    def get(self, tool_id: str) -> Optional[ToolDescriptor]:
        registration = self.snapshot().get(str(tool_id or "").strip().lower())
        return registration.descriptor if registration else None

    def get_handler(self, tool_id: str) -> Any:
        registration = self.snapshot().get(str(tool_id or "").strip().lower())
        return registration.handler if registration else None

    @property
    def revision(self) -> str:
        snapshot = self.snapshot()
        return _stable_hash(
            [
                _descriptor_dump(registration.descriptor)
                for _, registration in sorted(snapshot.items())
            ]
        )

    def reset_for_tests(self) -> None:
        """Clear dynamic state. Intended only for isolated unit tests."""
        with self._lock:
            self._core.clear()
            self._plugin_providers.clear()
            self._generated_providers.clear()
            self._mcp_providers.clear()


class SkillCatalog:
    """Effective core, plugin, and per-vault user skill catalog."""

    def __init__(self, tool_catalog: ToolCatalog) -> None:
        self._tool_catalog = tool_catalog
        self._core: Dict[str, SkillDescriptor] = {}
        self._plugin_providers: Dict[str, SkillProvider] = {}
        self._lock = threading.RLock()

    def register_core(
        self, descriptor: Union[SkillDescriptor, Mapping[str, Any]]
    ) -> None:
        raw = (
            descriptor.model_dump(mode="python")
            if isinstance(descriptor, SkillDescriptor)
            else dict(descriptor)
        )
        raw["origin"] = CatalogOrigin(
            type=OriginType.CORE, id="gnosi"
        ).model_dump(mode="python")
        parsed = SkillDescriptor.model_validate(raw)
        validate_versioned_capability(parsed)
        with self._lock:
            if parsed.id in self._core:
                raise CatalogConflictError(f"duplicate skill ID: {parsed.id}")
            self._core[parsed.id] = parsed

    def register_plugin_provider(self, plugin_id: str, provider: SkillProvider) -> None:
        normalized = _normalize_plugin_id(plugin_id)
        if not callable(provider):
            raise TypeError("skill provider must be callable")
        with self._lock:
            self._plugin_providers[normalized] = provider

    def unregister_plugin_provider(self, plugin_id: str) -> None:
        normalized = _normalize_plugin_id(plugin_id)
        with self._lock:
            self._plugin_providers.pop(normalized, None)

    def descriptors(self, vault_path: Optional[Path] = None) -> Dict[str, SkillDescriptor]:
        with self._lock:
            result = dict(self._core)
            providers = tuple(self._plugin_providers.items())
        for plugin_id, provider in providers:
            try:
                supplied = provider() or ()
            except Exception as exc:
                raise CatalogProviderError(
                    f"skill provider for plugin {plugin_id!r} failed: {exc}"
                ) from exc
            for value in supplied:
                descriptor = _coerce_plugin_skill(plugin_id, value)
                if descriptor.id in result:
                    raise CatalogConflictError(
                        f"duplicate skill ID: {descriptor.id}"
                    )
                result[descriptor.id] = descriptor

        if vault_path is not None:
            from backend.services.user_skill_store import UserSkillStore

            user_skills, _ = UserSkillStore(vault_path).load_all()
            for descriptor in user_skills:
                validate_versioned_capability(descriptor)
                if descriptor.id in result:
                    raise CatalogConflictError(
                        f"duplicate skill ID: {descriptor.id}"
                    )
                result[descriptor.id] = descriptor
        return result

    def list_entries(self, vault_path: Optional[Path] = None) -> Tuple[SkillCatalogEntry, ...]:
        tools = self._tool_catalog.snapshot()
        entries = []
        for _, descriptor in sorted(self.descriptors(vault_path).items()):
            missing = []
            effects = set()
            for tool_id in descriptor.tool_ids:
                registration = tools.get(tool_id)
                if (
                    registration is None
                    or registration.descriptor.status != CatalogStatus.AVAILABLE
                    or not _is_runtime_handler(registration.handler)
                ):
                    missing.append(tool_id)
                    continue
                effects.update(registration.descriptor.effects)
            available = (
                descriptor.status == CatalogStatus.AVAILABLE and not missing
            )
            entries.append(
                SkillCatalogEntry(
                    descriptor=descriptor,
                    available=available,
                    missing_tool_ids=missing,
                    effects=sorted(effects, key=lambda effect: effect.value),
                    editable=descriptor.origin.type == OriginType.USER,
                    deletable=descriptor.origin.type == OriginType.USER,
                    revision=_stable_hash(_descriptor_dump(descriptor)),
                )
            )
        return tuple(entries)

    def get_entry(
        self, skill_id: str, vault_path: Optional[Path] = None
    ) -> Optional[SkillCatalogEntry]:
        normalized = str(skill_id or "").strip().lower()
        return next(
            (entry for entry in self.list_entries(vault_path) if entry.descriptor.id == normalized),
            None,
        )

    def revision(self, vault_path: Optional[Path] = None) -> str:
        entries = self.list_entries(vault_path)
        return _stable_hash(
            {
                "skills": [entry.model_dump(mode="json") for entry in entries],
                "tools": self._tool_catalog.revision,
            }
        )

    def reset_for_tests(self) -> None:
        """Clear dynamic state. Intended only for isolated unit tests."""
        with self._lock:
            self._core.clear()
            self._plugin_providers.clear()


_TOOL_CATALOG = ToolCatalog()
_SKILL_CATALOG = SkillCatalog(_TOOL_CATALOG)
_BUILTIN_PROVIDER_LOCK = threading.RLock()
_BUILTIN_PROVIDER_HOOKS_REGISTERED: set[str] = set()
_BUILTIN_PROVIDERS_REGISTERING = False


def _register_builtin_gnosi_catalog() -> None:
    """Register first-party tools, domain skills, and the legacy composition."""
    from backend.services.gnosi_ai_contributions import (
        core_gnosi_registrations,
        core_gnosi_skill_descriptors,
    )

    registrations = core_gnosi_registrations()
    for descriptor, handler in registrations:
        _TOOL_CATALOG.register_core(descriptor, handler)
    for descriptor in core_gnosi_skill_descriptors(registrations):
        _SKILL_CATALOG.register_core(descriptor)
    capability_platform_names = {
        "batch_mail_action",
        "calendar_free_busy",
        "delete_calendar_event",
        "extract_reader_article",
        "find_duplicate_contacts",
        "generate_reader_podcast",
        "list_mail_folders",
        "mark_mail_read",
        "mark_reader_article_read",
        "merge_contacts",
        "move_vault_page",
        "query_vault_table",
        "read_calendar_event",
        "read_contact",
        "read_mail_message",
        "read_mail_thread",
        "read_vault_table_schema",
        "reader_podcast_status",
        "reply_mail_message",
        "rename_vault_page",
        "rsvp_calendar_event",
        "save_reader_article_to_vault",
        "snooze_mail_message",
        "star_mail_message",
        "update_calendar_event",
        "update_contact",
        "list_vault_tables",
    }
    _SKILL_CATALOG.register_core(
        SkillDescriptor(
            id="core.legacy-default-v1",
            version="1.0.0",
            name="Legacy agent capabilities",
            description=(
                "Temporary compatibility bundle for agents created before explicit "
                "skill assignments."
            ),
            origin=CatalogOrigin(type=OriginType.CORE, id="gnosi"),
            kind=SkillKind.AGENT,
            activation=SkillActivation.ALWAYS,
            tool_ids=sorted(
                descriptor.id
                for descriptor, _handler in registrations
                if descriptor.metadata.get("domain")
                in {"vault", "mail", "calendar", "contacts", "reader", "memory"}
                and str(descriptor.handler_ref or "").rsplit(".", 1)[-1]
                not in capability_platform_names
            ),
            instructions="Use the legacy Gnosi agent capability bundle.",
            metadata={"legacy_bundle": True},
        )
    )


_register_builtin_gnosi_catalog()


def _ensure_builtin_providers() -> None:
    """Lazily register bundled plugin adapters without creating import cycles."""

    global _BUILTIN_PROVIDERS_REGISTERING
    if _BUILTIN_PROVIDERS_REGISTERING:
        return
    with _BUILTIN_PROVIDER_LOCK:
        if _BUILTIN_PROVIDERS_REGISTERING:
            return
        _BUILTIN_PROVIDERS_REGISTERING = True
        try:
            if "llm-wiki" not in _BUILTIN_PROVIDER_HOOKS_REGISTERED:
                try:
                    from backend.services.llm_wiki_ai_contributions import (
                        register_llm_wiki_contributions,
                    )
                except ModuleNotFoundError as exc:
                    if (
                        exc.name
                        != "backend.services.llm_wiki_ai_contributions"
                    ):
                        raise
                else:
                    register_llm_wiki_contributions()
                    _BUILTIN_PROVIDER_HOOKS_REGISTERED.add("llm-wiki")

            if "plugins" not in _BUILTIN_PROVIDER_HOOKS_REGISTERED:
                try:
                    from backend.services.plugin_ai_contributions import (
                        reconcile_plugin_ai_contributions,
                    )
                except ModuleNotFoundError as exc:
                    if exc.name != "backend.services.plugin_ai_contributions":
                        raise
                else:
                    reconcile_plugin_ai_contributions()
                    _BUILTIN_PROVIDER_HOOKS_REGISTERED.add("plugins")

            if "generated-tools" not in _BUILTIN_PROVIDER_HOOKS_REGISTERED:
                try:
                    from backend.services.generated_tool_contributions import (
                        register_generated_tool_contributions,
                    )
                except ModuleNotFoundError as exc:
                    if (
                        exc.name
                        != "backend.services.generated_tool_contributions"
                    ):
                        raise
                else:
                    register_generated_tool_contributions()
                    _BUILTIN_PROVIDER_HOOKS_REGISTERED.add("generated-tools")
        finally:
            _BUILTIN_PROVIDERS_REGISTERING = False


def get_tool_catalog() -> ToolCatalog:
    """Return the process-wide governed tool catalog."""

    _ensure_builtin_providers()
    return _TOOL_CATALOG


def get_skill_catalog() -> SkillCatalog:
    """Return the process-wide effective skill catalog."""

    _ensure_builtin_providers()
    return _SKILL_CATALOG


def register_plugin_tool_provider(plugin_id: str, provider: ToolProvider) -> None:
    """Register or replace a plugin's lazy tool contribution provider."""

    _TOOL_CATALOG.register_plugin_provider(plugin_id, provider)


def unregister_plugin_tool_provider(plugin_id: str) -> None:
    """Suspend a plugin's tool contributions while preserving assignments."""

    _TOOL_CATALOG.unregister_plugin_provider(plugin_id)


def register_plugin_skill_provider(plugin_id: str, provider: SkillProvider) -> None:
    """Register or replace a plugin's lazy skill contribution provider."""

    _SKILL_CATALOG.register_plugin_provider(plugin_id, provider)


def unregister_plugin_skill_provider(plugin_id: str) -> None:
    """Suspend a plugin's skill contributions while preserving assignments."""

    _SKILL_CATALOG.unregister_plugin_provider(plugin_id)


def register_generated_tool_provider(
    provider_id: str, provider: ToolProvider
) -> None:
    """Register a governed provider for manually approved generated tools."""

    _TOOL_CATALOG.register_generated_provider(provider_id, provider)


def register_mcp_tool_provider(
    provider_id: str, provider: ToolProvider
) -> None:
    """Register the current governed MCP connector snapshot."""

    _TOOL_CATALOG.register_mcp_provider(provider_id, provider)


def resolve_agent_capabilities(
    agent_profile: Mapping[str, Any],
    vault_path: Optional[Path] = None,
) -> AgentSkillResolution:
    """Resolve all assigned skills and exact eligible tool IDs.

    This serializable helper is intended for APIs and audits. Runtime callers
    that need Python adapters should use :func:`resolve_agent_runtime`.
    """

    runtime = resolve_agent_runtime(agent_profile, vault_path=vault_path)
    return AgentSkillResolution(
        assigned_skill_ids=list(runtime.assigned_skill_ids),
        skills=list(runtime.skills),
        missing_skill_ids=list(runtime.missing_skill_ids),
        tool_ids=[descriptor.id for descriptor in runtime.tool_descriptors],
        unavailable_tool_ids=list(runtime.unavailable_tool_ids),
        catalog_revision=runtime.catalog_revision,
    )


def resolve_agent_runtime(
    agent_profile: Mapping[str, Any],
    *,
    vault_path: Optional[Path] = None,
    active_skill_ids: Optional[Iterable[str]] = None,
) -> AgentRuntimeCapabilities:
    """Resolve a profile into exact instructions, descriptors, and adapters.

    Passing ``active_skill_ids`` never grants a skill: the requested IDs are
    intersected with available assignments. Without it, ``always`` and
    ``automatic`` skills are activated while ``explicit`` skills remain inert.
    """

    configured_skill_ids = (
        ["core.legacy-default-v1"]
        if "skill_ids" not in agent_profile
        else (agent_profile.get("skill_ids") or [])
    )
    assigned = tuple(
        dict.fromkeys(
            str(value or "").strip().lower()
            for value in configured_skill_ids
            if str(value or "").strip()
        )
    )
    catalog = get_skill_catalog()
    entries_by_id = {
        entry.descriptor.id: entry for entry in catalog.list_entries(vault_path)
    }
    found = tuple(
        entries_by_id[skill_id]
        for skill_id in assigned
        if skill_id in entries_by_id
    )
    missing_skills = tuple(
        skill_id for skill_id in assigned if skill_id not in entries_by_id
    )

    explicitly_active = None
    if active_skill_ids is not None:
        explicitly_active = {
            str(value or "").strip().lower()
            for value in active_skill_ids
            if str(value or "").strip()
        }
    active_entries = []
    for entry in found:
        descriptor = entry.descriptor
        if (
            not entry.available
            or descriptor.kind != SkillKind.AGENT
            or (
                explicitly_active is not None
                and descriptor.id not in explicitly_active
            )
            or (
                explicitly_active is None
                and descriptor.activation == SkillActivation.EXPLICIT
            )
        ):
            continue
        active_entries.append(entry)

    tool_snapshot = get_tool_catalog().snapshot()
    tool_descriptors = []
    tools = []
    unavailable = []
    seen_tools = set()
    for entry in active_entries:
        for tool_id in entry.descriptor.tool_ids:
            if tool_id in seen_tools:
                continue
            seen_tools.add(tool_id)
            registration = tool_snapshot.get(tool_id)
            if (
                registration is None
                or registration.descriptor.status != CatalogStatus.AVAILABLE
            ):
                unavailable.append(tool_id)
                continue
            if _is_runtime_handler(registration.handler):
                tool_descriptors.append(registration.descriptor)
                tools.append(registration.handler)
            else:
                unavailable.append(tool_id)

    return AgentRuntimeCapabilities(
        assigned_skill_ids=assigned,
        active_skill_ids=tuple(
            entry.descriptor.id for entry in active_entries
        ),
        instructions=tuple(
            entry.descriptor.instructions
            for entry in active_entries
            if entry.descriptor.instructions.strip()
        ),
        tools=tuple(tools),
        tool_descriptors=tuple(tool_descriptors),
        skills=found,
        missing_skill_ids=missing_skills,
        unavailable_tool_ids=tuple(dict.fromkeys(unavailable)),
        catalog_revision=catalog.revision(vault_path),
    )
