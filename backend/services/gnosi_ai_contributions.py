"""Governed core skills and tools for first-party Gnosi operations."""
from __future__ import annotations

from typing import Any, Dict, Iterable, Tuple

from backend.agent.gnosi_tools import (
    CONFIRMED_WRITE_TOOLS,
    EXPLICIT_WRITE_TOOLS,
    READ_TOOLS,
)
from backend.agent.system_tools import READ_ONLY_SYSTEM_TOOLS, save_memory
from backend.agent.vault_tools import (
    VAULT_KNOWLEDGE_TOOLS,
    create_page,
    summarize_to_cornell,
)
from backend.models.agent_skills import (
    CatalogOrigin,
    ConfirmationPolicy,
    OriginType,
    SkillActivation,
    SkillDescriptor,
    SkillKind,
    ToolDescriptor,
    ToolEffect,
)


ORIGIN = CatalogOrigin(type=OriginType.CORE, id="gnosi")
CORE_GNOSI_DOMAIN_SKILLS = (
    "core.gnosi-vault",
    "core.gnosi-mail",
    "core.gnosi-calendar",
    "core.gnosi-contacts",
    "core.gnosi-memory",
)


def _tool_name(handler: Any) -> str:
    return str(
        getattr(handler, "name", "")
        or getattr(handler, "__name__", "")
        or ""
    )


def _input_schema(handler: Any) -> Dict[str, Any]:
    schema_model = getattr(handler, "args_schema", None)
    if schema_model is not None and callable(
        getattr(schema_model, "model_json_schema", None)
    ):
        schema = schema_model.model_json_schema()
        schema.pop("title", None)
        return schema
    return {"type": "object", "properties": {}}


def _tool_id(name: str) -> str:
    return f"core.gnosi.{name.replace('_', '-')}"


def _domain(name: str) -> str:
    if "mail" in name or name in {"archive_mail", "move_mail"}:
        return "mail"
    if "calendar" in name or name == "invite_attendees":
        return "calendar"
    if "contact" in name:
        return "contacts"
    if "memory" in name or name == "query_memory":
        return "memory"
    return "vault"


def _read_extras() -> Iterable[Any]:
    system_names = {"query_memory", "get_vault_registry", "search_vault"}
    vault_names = {"read_page", "read_pdf", "propose_links"}
    yield from (
        handler
        for handler in READ_ONLY_SYSTEM_TOOLS
        if _tool_name(handler) in system_names
    )
    yield from (
        handler
        for handler in VAULT_KNOWLEDGE_TOOLS
        if _tool_name(handler) in vault_names
    )


def core_gnosi_registrations() -> Tuple[Tuple[ToolDescriptor, Any], ...]:
    """Return immutable descriptors paired with their in-process adapters."""
    registrations = []
    read_handlers = [*READ_TOOLS, *_read_extras()]
    explicit_handlers = [
        *EXPLICIT_WRITE_TOOLS,
        create_page,
        summarize_to_cornell,
        save_memory,
    ]
    confirmed_handlers = list(CONFIRMED_WRITE_TOOLS)

    for handler in read_handlers:
        name = _tool_name(handler)
        registrations.append((
            ToolDescriptor(
                id=_tool_id(name),
                name=name.replace("_", " ").title(),
                description=str(getattr(handler, "description", "") or ""),
                origin=ORIGIN,
                input_schema=_input_schema(handler),
                effects=[ToolEffect.READ],
                minimum_role="viewer",
                confirmation=ConfirmationPolicy.NONE,
                handler_ref=(
                    f"{getattr(handler, '__module__', 'backend.agent')}.{name}"
                ),
                metadata={"domain": _domain(name)},
            ),
            handler,
        ))

    for handler in explicit_handlers:
        name = _tool_name(handler)
        registrations.append((
            ToolDescriptor(
                id=_tool_id(name),
                name=name.replace("_", " ").title(),
                description=str(getattr(handler, "description", "") or ""),
                origin=ORIGIN,
                input_schema=_input_schema(handler),
                effects=[ToolEffect.LOCAL_WRITE],
                minimum_role="editor",
                confirmation=ConfirmationPolicy.EXPLICIT_REQUEST,
                handler_ref=(
                    f"{getattr(handler, '__module__', 'backend.agent')}.{name}"
                ),
                metadata={"domain": _domain(name)},
            ),
            handler,
        ))

    external_names = {
        "archive_mail",
        "create_calendar_event",
        "invite_attendees",
        "move_mail",
        "save_mail_draft",
        "send_mail",
    }
    admin_names = {"delete_table", "empty_trash"}
    for handler in confirmed_handlers:
        name = _tool_name(handler)
        effects = (
            [ToolEffect.EXTERNAL_WRITE]
            if name in external_names
            else [ToolEffect.DESTRUCTIVE]
        )
        registrations.append((
            ToolDescriptor(
                id=_tool_id(name),
                name=name.replace("_", " ").title(),
                description=str(getattr(handler, "description", "") or ""),
                origin=ORIGIN,
                input_schema=_input_schema(handler),
                effects=effects,
                minimum_role="admin" if name in admin_names else "editor",
                confirmation=ConfirmationPolicy.ALWAYS,
                handler_ref=(
                    f"{getattr(handler, '__module__', 'backend.agent')}.{name}"
                ),
                metadata={
                    "domain": _domain(name),
                    "prepares_confirmation": True,
                },
            ),
            handler,
        ))
    return tuple(registrations)


def core_gnosi_skill_descriptors(
    registrations: Iterable[Tuple[ToolDescriptor, Any]],
) -> Tuple[SkillDescriptor, ...]:
    """Group first-party tools into assignable least-privilege domains."""
    by_domain: Dict[str, list[str]] = {
        "vault": [],
        "mail": [],
        "calendar": [],
        "contacts": [],
        "memory": [],
    }
    for descriptor, _handler in registrations:
        domain = str(descriptor.metadata.get("domain") or "vault")
        by_domain.setdefault(domain, []).append(descriptor.id)

    names = {
        "vault": "Gnosi Vault",
        "mail": "Gnosi Mail",
        "calendar": "Gnosi Calendar",
        "contacts": "Gnosi Contacts",
        "memory": "Gnosi Memory",
    }
    instructions = {
        "vault": (
            "Operate only on the active Gnosi Vault. Preserve page and row "
            "metadata, use exact IDs from tools, and never imply an operation "
            "completed before its tool result."
        ),
        "mail": (
            "Use only configured personal-workspace mail accounts. Search is "
            "read-only; sending, moving, and archiving require review."
        ),
        "calendar": (
            "Use only configured personal-workspace calendars. Creating an "
            "event or inviting attendees requires review."
        ),
        "contacts": (
            "Use only contacts in the authenticated workspace and preserve "
            "their exact IDs."
        ),
        "memory": (
            "Read sovereign memory when relevant and save long-term memory only "
            "after an explicit current-turn request."
        ),
    }
    return tuple(
        SkillDescriptor(
            id=f"core.gnosi-{domain}",
            name=names[domain],
            description=f"Provider-neutral first-party {names[domain]} operations.",
            origin=ORIGIN,
            kind=SkillKind.AGENT,
            activation=SkillActivation.ALWAYS,
            tool_ids=sorted(tool_ids),
            instructions=instructions[domain],
            metadata={"core_domain": domain},
        )
        for domain, tool_ids in by_domain.items()
        if tool_ids
    )
