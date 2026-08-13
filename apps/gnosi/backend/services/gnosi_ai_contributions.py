"""Governed core skills and tools for first-party Gnosi operations."""
from __future__ import annotations

from typing import Any, Dict, Iterable, Tuple

from backend.agent.gnosi_tools import (
    CONFIRMED_WRITE_TOOLS,
    EXPLICIT_WRITE_TOOLS,
    READ_TOOLS,
)
from backend.agent.job_tools import (
    JOB_AI_TOOLS,
    JOB_READ_TOOLS,
    JOB_WRITE_TOOLS,
)
from backend.agent.planning_tools import (
    PLANNING_READ_TOOLS,
    PLANNING_WRITE_TOOLS,
)
from backend.agent.reader_tools import (
    READER_AI_TOOLS,
    READER_READ_TOOLS,
    READER_WRITE_TOOLS,
)
from backend.agent.mail_tools import (
    MAIL_EXTERNAL_WRITE_TOOLS,
    MAIL_LOCAL_WRITE_TOOLS,
    MAIL_READ_TOOLS,
)
from backend.agent.calendar_tools import (
    CALENDAR_EXTERNAL_WRITE_TOOLS,
    CALENDAR_READ_TOOLS,
)
from backend.agent.contact_tools import (
    CONTACT_DESTRUCTIVE_TOOLS,
    CONTACT_LOCAL_WRITE_TOOLS,
    CONTACT_READ_TOOLS,
)
from backend.agent.vault_admin_tools import (
    VAULT_ADMIN_READ_TOOLS,
    VAULT_ADMIN_WRITE_TOOLS,
)
from backend.agent.social_tools import (
    SOCIAL_AI_TOOLS,
    SOCIAL_EXTERNAL_WRITE_TOOLS,
    SOCIAL_READ_TOOLS,
)
from backend.agent.translation_tools import TRANSLATION_AI_TOOLS
from backend.agent.notion_tools import NOTION_BULK_WRITE_TOOLS, NOTION_READ_TOOLS
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
    "core.gnosi-reader",
    "core.gnosi-memory",
    "core.gnosi-jobs",
    "core.gnosi-planning",
    "core.gnosi-social",
    "core.gnosi-translation",
    "core.gnosi-notion",
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
    if "capability_job" in name or name == "list_capability_jobs":
        return "jobs"
    if name.startswith("planning_"):
        return "planning"
    if "social" in name:
        return "social"
    if "translate" in name:
        return "translation"
    if "notion" in name:
        return "notion"
    if "reader" in name:
        return "reader"
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


def _read_effects(name: str) -> list[ToolEffect]:
    effects = [ToolEffect.READ]
    if "mail" in name or "calendar" in name:
        effects.extend([ToolEffect.EXTERNAL_READ, ToolEffect.PERSONAL_DATA])
    elif "contact" in name:
        effects.append(ToolEffect.PERSONAL_DATA)
    elif "social" in name or "notion" in name:
        effects.extend([ToolEffect.EXTERNAL_READ, ToolEffect.PERSONAL_DATA])
    return effects


def _explicit_effects(name: str) -> list[ToolEffect]:
    effects = [ToolEffect.LOCAL_WRITE]
    if name in {"planning_apply_leveling_proposal", "planning_materialize_recurrence"}:
        effects.append(ToolEffect.BULK_WRITE)
    if name == "extract_reader_article":
        effects.append(ToolEffect.EXTERNAL_READ)
    if name == "clone_notion_content":
        effects.extend([
            ToolEffect.EXTERNAL_READ,
            ToolEffect.PERSONAL_DATA,
            ToolEffect.BULK_WRITE,
        ])
    return effects


def core_gnosi_registrations() -> Tuple[Tuple[ToolDescriptor, Any], ...]:
    """Return immutable descriptors paired with their in-process adapters."""
    registrations = []
    read_handlers = [
        *READ_TOOLS,
        *READER_READ_TOOLS,
        *JOB_READ_TOOLS,
        *PLANNING_READ_TOOLS,
        *MAIL_READ_TOOLS,
        *CALENDAR_READ_TOOLS,
        *CONTACT_READ_TOOLS,
        *VAULT_ADMIN_READ_TOOLS,
        *SOCIAL_READ_TOOLS,
        *NOTION_READ_TOOLS,
        *_read_extras(),
    ]
    explicit_handlers = [
        *EXPLICIT_WRITE_TOOLS,
        create_page,
        summarize_to_cornell,
        save_memory,
        *READER_WRITE_TOOLS,
        *JOB_WRITE_TOOLS,
        *PLANNING_WRITE_TOOLS,
        *MAIL_LOCAL_WRITE_TOOLS,
        *CONTACT_LOCAL_WRITE_TOOLS,
        *VAULT_ADMIN_WRITE_TOOLS,
        *NOTION_BULK_WRITE_TOOLS,
    ]
    confirmed_handlers = [
        *((handler, True) for handler in CONFIRMED_WRITE_TOOLS),
        *((handler, False) for handler in MAIL_EXTERNAL_WRITE_TOOLS),
        *((handler, False) for handler in CALENDAR_EXTERNAL_WRITE_TOOLS),
        *((handler, False) for handler in CONTACT_DESTRUCTIVE_TOOLS),
        *((handler, False) for handler in SOCIAL_EXTERNAL_WRITE_TOOLS),
    ]

    for handler in read_handlers:
        name = _tool_name(handler)
        registrations.append((
            ToolDescriptor(
                id=_tool_id(name),
                name=name.replace("_", " ").title(),
                description=str(getattr(handler, "description", "") or ""),
                origin=ORIGIN,
                input_schema=_input_schema(handler),
                output_schema={"type": "string"},
                effects=_read_effects(name),
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
                output_schema={"type": "string"},
                effects=_explicit_effects(name),
                minimum_role="editor",
                confirmation=ConfirmationPolicy.EXPLICIT_REQUEST,
                handler_ref=(
                    f"{getattr(handler, '__module__', 'backend.agent')}.{name}"
                ),
                metadata={"domain": _domain(name)},
            ),
            handler,
        ))

    for handler in [
        *READER_AI_TOOLS,
        *JOB_AI_TOOLS,
        *SOCIAL_AI_TOOLS,
        *TRANSLATION_AI_TOOLS,
    ]:
        name = _tool_name(handler)
        effects = [ToolEffect.AI_COST]
        if handler in SOCIAL_AI_TOOLS:
            effects.extend([ToolEffect.EXTERNAL_READ, ToolEffect.DATA_EGRESS])
        else:
            effects.insert(0, ToolEffect.LOCAL_WRITE)
        if handler in TRANSLATION_AI_TOOLS:
            effects.append(ToolEffect.DATA_EGRESS)
            if name == "translate_vault_rows":
                effects.append(ToolEffect.BULK_WRITE)
        registrations.append((
            ToolDescriptor(
                id=_tool_id(name),
                name=name.replace("_", " ").title(),
                description=str(getattr(handler, "description", "") or ""),
                origin=ORIGIN,
                input_schema=_input_schema(handler),
                output_schema={"type": "string"},
                effects=effects,
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
    for handler, prepares_confirmation in confirmed_handlers:
        name = _tool_name(handler)
        if handler in CONTACT_DESTRUCTIVE_TOOLS:
            effects = [ToolEffect.LOCAL_WRITE, ToolEffect.DESTRUCTIVE]
        elif handler in CALENDAR_EXTERNAL_WRITE_TOOLS:
            effects = [ToolEffect.EXTERNAL_WRITE, ToolEffect.PERSONAL_DATA]
            if name == "delete_calendar_event":
                effects.append(ToolEffect.DESTRUCTIVE)
        elif handler in MAIL_EXTERNAL_WRITE_TOOLS:
            effects = [ToolEffect.EXTERNAL_WRITE, ToolEffect.PERSONAL_DATA]
            if name == "batch_mail_action":
                effects.append(ToolEffect.BULK_WRITE)
        elif handler in SOCIAL_EXTERNAL_WRITE_TOOLS:
            effects = [
                ToolEffect.EXTERNAL_WRITE,
                ToolEffect.DATA_EGRESS,
                ToolEffect.NOTIFICATION,
            ]
        else:
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
                output_schema={"type": "string"},
                effects=effects,
                minimum_role="admin" if name in admin_names else "editor",
                confirmation=ConfirmationPolicy.ALWAYS,
                handler_ref=(
                    f"{getattr(handler, '__module__', 'backend.agent')}.{name}"
                ),
                metadata={
                    "domain": _domain(name),
                    "prepares_confirmation": prepares_confirmation,
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
        "reader": [],
        "memory": [],
        "jobs": [],
        "planning": [],
        "social": [],
        "translation": [],
        "notion": [],
    }
    for descriptor, _handler in registrations:
        domain = str(descriptor.metadata.get("domain") or "vault")
        by_domain.setdefault(domain, []).append(descriptor.id)

    names = {
        "vault": "Gnosi Vault",
        "mail": "Gnosi Mail",
        "calendar": "Gnosi Calendar",
        "contacts": "Gnosi Contacts",
        "reader": "Gnosi Reader",
        "memory": "Gnosi Memory",
        "jobs": "Gnosi Jobs",
        "planning": "Gnosi Planning",
        "social": "Gnosi Social",
        "translation": "Gnosi Translation",
        "notion": "Gnosi Notion",
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
        "reader": (
            "Search and read only the selected Reader scope. For large topic "
            "evolution requests, inspect the exact inventory first and start "
            "the durable analysis only after an explicit current-turn request."
        ),
        "memory": (
            "Read sovereign memory when relevant and save long-term memory only "
            "after an explicit current-turn request."
        ),
        "jobs": (
            "Inspect durable jobs through namespaced ids. Estimate cost before "
            "starting or resuming model work, report provider capabilities "
            "exactly, and never infer completion from elapsed time."
        ),
        "planning": (
            "Read the active Vault planning state before proposing changes. "
            "Use exact project, task, resource, proposal, baseline, revision, "
            "and ETag values. Never imply a proposal was applied before the tool result."
        ),
        "social": (
            "Read configured social streams and publication history. Composition may "
            "create drafts, but publishing, scheduling, reactions, and reshares always "
            "require review of the exact network-specific content."
        ),
        "translation": (
            "Use the existing idempotent page and row translation workflows. Preserve "
            "structured Markdown and provenance, cap bulk selections, and report "
            "created, updated, skipped, and failed translations exactly."
        ),
        "notion": (
            "Inspect only content shared with the connected Notion integration. Clone "
            "selected databases or loose pages into a contained Vault folder only after "
            "an explicit request and never prune source-orphaned content automatically."
        ),
    }
    domain_skills = tuple(
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
    workflow_specs = (
        {
            "id": "core.gnosi-reader-topic-evolution",
            "name": "Reader topic evolution",
            "description": "Produce a durable cited timeline for every topic in a Reader scope.",
            "activation": SkillActivation.EXPLICIT,
            "sources": ["reader"],
            "tools": [
                "reader_inventory", "search_reader_articles", "read_reader_article",
                "estimate_capability_job", "start_reader_topic_analysis",
                "reader_analysis_status", "read_reader_analysis",
                "resume_reader_topic_analysis", "cancel_reader_topic_analysis",
                "create_page",
            ],
            "instructions": (
                "Inspect the exact Reader inventory, estimate model calls, and explain "
                "the scope before starting. Start only after an explicit request. Poll "
                "through durable status tools, validate cited article ids, and offer to "
                "save the completed report to the active Vault."
            ),
        },
        {
            "id": "core.gnosi-daily-briefing",
            "name": "Daily briefing",
            "description": "Combine today's schedule, priority mail, Reader, and Planning signals.",
            "activation": SkillActivation.AUTOMATIC,
            "sources": ["calendar", "mail", "reader", "planning"],
            "tools": [
                "list_calendar_events", "search_mail", "reader_inventory",
                "search_reader_articles", "planning_get_state",
                "planning_get_allocation", "query_memory", "search_vault",
            ],
            "instructions": (
                "Build one concise briefing from attached scoped sources. Separate facts, "
                "risks, and suggested priorities; cite exact source records and perform "
                "no writes. State which expected source is unavailable."
            ),
        },
        {
            "id": "core.gnosi-inbox-triage",
            "name": "Inbox triage",
            "description": "Prioritize bounded mail and prepare reviewed mailbox actions or drafts.",
            "activation": SkillActivation.EXPLICIT,
            "sources": ["mail", "contacts", "calendar"],
            "tools": [
                "search_mail", "read_mail_message", "read_mail_thread",
                "list_contacts", "list_calendar_events", "save_mail_draft",
                "reply_mail_message", "archive_mail", "move_mail",
            ],
            "instructions": (
                "Produce a read-only triage plan first. Use exact message ids and distinguish "
                "urgent, reply, waiting, and informational mail. Draft, archive, or move only "
                "when the current request explicitly asks for that action; every external "
                "mailbox change remains subject to confirmation."
            ),
        },
        {
            "id": "core.gnosi-meeting-preparation",
            "name": "Meeting preparation",
            "description": "Prepare an evidence-backed brief for one exact calendar event.",
            "activation": SkillActivation.AUTOMATIC,
            "sources": ["calendar", "contacts", "mail"],
            "tools": [
                "list_calendar_events", "read_calendar_event", "list_contacts",
                "read_contact", "search_mail", "read_mail_thread", "search_vault",
                "query_memory",
            ],
            "instructions": (
                "Resolve one exact event and its attendees, then gather only relevant recent "
                "mail and knowledge evidence. Return objectives, context, open decisions, and "
                "questions. Do not invite attendees or alter the event."
            ),
        },
        {
            "id": "core.gnosi-knowledge-capture",
            "name": "Knowledge capture",
            "description": "Turn an exact source record into a structured linked Vault note.",
            "activation": SkillActivation.EXPLICIT,
            "sources": [],
            "tools": [
                "create_page", "summarize_to_cornell", "add_tags",
                "propose_links", "add_page_comment",
            ],
            "instructions": (
                "Read the exact attached record before writing. Preserve title, source id, "
                "date, author, URL, and provenance. Create one structured note only after "
                "an explicit request, then propose links rather than inventing relationships."
            ),
        },
        {
            "id": "core.gnosi-research-dossier",
            "name": "Research dossier",
            "description": "Synthesize Reader, References, Vault, and Brain evidence with citations.",
            "activation": SkillActivation.EXPLICIT,
            "sources": ["reader", "references"],
            "tools": [
                "search_reader_articles", "read_reader_article",
                "read_page", "read_pdf", "create_page", "propose_links",
            ],
            "instructions": (
                "Start from scoped search results, read exact evidence, distinguish claims from "
                "inference, surface disagreement and gaps, and cite every material claim. Save "
                "a dossier only when explicitly requested."
            ),
        },
        {
            "id": "core.gnosi-weekly-review",
            "name": "Weekly review",
            "description": "Review schedules, allocation, worklogs, calendar, and communication evidence.",
            "activation": SkillActivation.EXPLICIT,
            "sources": ["planning", "calendar", "mail"],
            "tools": [
                "planning_get_state", "planning_get_allocation",
                "planning_get_project_schedule", "planning_get_baseline_variance",
                "planning_list_worklogs", "list_calendar_events", "search_mail",
                "create_page",
            ],
            "instructions": (
                "Compare planned and actual work, identify critical-path or capacity risks, and "
                "separate evidence from recommendations. Never apply leveling or change dates "
                "inside a review. Save the review only after an explicit request."
            ),
        },
        {
            "id": "core.gnosi-relationship-brief",
            "name": "Relationship brief",
            "description": "Summarize one contact's recent relationship context without changing data.",
            "activation": SkillActivation.AUTOMATIC,
            "sources": ["contacts", "mail", "calendar"],
            "tools": [
                "list_contacts", "read_contact", "search_mail", "read_mail_thread",
                "list_calendar_events", "search_vault", "query_memory",
            ],
            "instructions": (
                "Resolve one exact contact, then retrieve only relevant correspondence, meetings, "
                "and notes. Report dates and provenance, avoid personality inference, and perform "
                "no contact or mailbox mutation."
            ),
        },
        {
            "id": "core.gnosi-project-status",
            "name": "Project status",
            "description": "Explain current project schedule, capacity, variance, and risks.",
            "activation": SkillActivation.AUTOMATIC,
            "sources": ["planning"],
            "tools": [
                "planning_get_state", "planning_get_allocation",
                "planning_get_project_schedule", "planning_get_leveling_proposal",
                "planning_get_baseline_variance", "planning_list_worklogs",
            ],
            "instructions": (
                "Use exact project and revision data. Explain schedule, critical tasks, allocation, "
                "variance, and diagnostics. Suggestions remain review-only and are never applied."
            ),
        },
        {
            "id": "core.gnosi-follow-up-manager",
            "name": "Follow-up manager",
            "description": "Find evidence-backed commitments that need a follow-up action.",
            "activation": SkillActivation.EXPLICIT,
            "sources": ["mail", "calendar", "contacts", "planning"],
            "tools": [
                "search_mail", "list_calendar_events", "list_contacts",
                "planning_get_state", "create_table_row",
            ],
            "instructions": (
                "Identify commitments only from exact evidence and include owner, date, source id, "
                "and uncertainty. Present a proposal first. Create follow-up rows only after an "
                "explicit request and never send reminders automatically."
            ),
        },
        {
            "id": "core.gnosi-social-publishing",
            "name": "Social publishing",
            "description": "Compose, review, schedule, and publish network-specific social posts.",
            "activation": SkillActivation.EXPLICIT,
            "sources": ["social"],
            "tools": [
                "read_social_publication_history", "read_scheduled_social_posts",
                "compose_social_posts", "publish_social_posts", "schedule_social_posts",
            ],
            "instructions": (
                "Read publication history and the exact source page first. Compose per-network "
                "drafts and show the final text, destinations, and schedule before acting. "
                "Publishing and scheduling always require interactive confirmation."
            ),
        },
        {
            "id": "core.gnosi-translation-workflow",
            "name": "Translation workflow",
            "description": "Translate structured Vault pages or rows idempotently with review status.",
            "activation": SkillActivation.EXPLICIT,
            "sources": [],
            "tools": [
                "read_page", "get_table_row", "translate_vault_page",
                "translate_vault_row", "translate_vault_rows",
            ],
            "instructions": (
                "Read the exact source and verify target languages before translating. Prefer the "
                "single-page or single-row operation; use bulk only for an explicitly selected, "
                "bounded set. Preserve structured Markdown and report idempotent updates."
            ),
        },
        {
            "id": "core.gnosi-notion-migration",
            "name": "Notion migration",
            "description": "Inspect and clone explicitly selected connected Notion content.",
            "activation": SkillActivation.EXPLICIT,
            "sources": ["notion"],
            "tools": [
                "notion_connection_status", "list_notion_databases",
                "read_notion_database_schema", "list_notion_loose_pages",
                "clone_notion_content",
            ],
            "instructions": (
                "Inventory shared Notion objects, confirm the exact databases, loose pages, target "
                "folder, and asset policy, then clone only after an explicit request. Never enable "
                "orphan pruning automatically and report partial or truncated results."
            ),
        },
    )
    available_ids = {descriptor.id for descriptor, _handler in registrations}
    workflows = []
    for spec in workflow_specs:
        tool_ids = [_tool_id(name) for name in spec["tools"]]
        missing = sorted(set(tool_ids) - available_ids)
        if missing:
            raise ValueError(
                f"Core workflow {spec['id']} references unavailable tools: {', '.join(missing)}"
            )
        workflows.append(SkillDescriptor(
            id=spec["id"],
            name=spec["name"],
            description=spec["description"],
            origin=ORIGIN,
            kind=SkillKind.AGENT,
            activation=spec["activation"],
            tool_ids=tool_ids,
            instructions=spec["instructions"],
            metadata={
                "workflow": True,
                "required_source_ids": spec["sources"],
            },
        ))
    return domain_skills + tuple(workflows)
