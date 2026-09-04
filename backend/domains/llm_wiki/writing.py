"""Typed, deterministic persistence for generated LLM Wiki reading notes."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData
from backend.utils.open_values import integer_value, iterable_values

class SavePage(Protocol):
    def __call__(
        self,
        path: Path,
        metadata: PageMetadata,
        body: str,
        /,
    ) -> object: ...


class NoteTypeValue(Protocol):
    def __call__(
        self,
        kind: str,
        config: dict[str, object],
        prop: RegistryData | None = None,
    ) -> object: ...


@dataclass(frozen=True)
class WritingDependencies:
    """Late-bound facade and Vault collaborators for one write operation."""

    get_pages_for_table: Callable[[str], Iterable[object]]
    get_unique_filepath: Callable[[Path, str, str], Path]
    resolve_table_folder: Callable[[PageMetadata], Path | None]
    table_by_id: Callable[[str], RegistryData | None]
    parse_frontmatter: Callable[[str, Path], tuple[PageMetadata, str]]
    register_page_in_index: Callable[[Path], object]
    save_page_md: SavePage
    load_config: Callable[[], dict[str, object]]
    note_type_value: NoteTypeValue
    page_metadata: Callable[[object], PageMetadata]
    merge_page_metadata: Callable[[PageMetadata, str], PageMetadata]
    prepare_managed_markdown: Callable[[PageMetadata], PageMetadata]
    base_note_metadata: Callable[[dict[str, object], str, str, int | None], PageMetadata]
    fonts_ids: Callable[[PageMetadata], list[str]]
    page_path: Callable[[object], Path | None]
    apply_dimensions: Callable[
        [PageMetadata, dict[str, object], dict[str, RegistryData]],
        None,
    ]
    effective_dimensions: Callable[[object, object], dict[str, object]]
    render_citations: Callable[[object, str, str, str], str]
    replace_note_block: Callable[[str, str, str], str]
    today: Callable[[], str]
    uuid_factory: Callable[[], str]
    generated_note_type: str


@dataclass
class _ExistingNotes:
    by_key: dict[str, object]
    legacy_by_position: dict[int, list[object]]
    managed_for_resource: list[object]


@dataclass(frozen=True)
class _WriteContext:
    source_page_id: str
    source_title: str
    source_table_id: str
    brain_table_id: str
    brain_dir: Path
    config: dict[str, object]
    source_dimensions: dict[str, object]
    props_by_id: dict[str, RegistryData]
    role_names: dict[str, str]
    relation_name: str
    existing: _ExistingNotes
    dependencies: WritingDependencies


def apply_plan(
    plan: dict[str, object],
    source_page_id: str,
    source_title: str,
    brain_table_id: str,
    *,
    source_table_id: str = "",
    source_config: dict[str, object] | None = None,
    config: dict[str, object] | None = None,
    source_dimensions: dict[str, object] | None = None,
    dependencies: WritingDependencies,
) -> dict[str, list[str]]:
    """Apply validated reading notes idempotently using stable managed keys."""
    resolved_config = config or dependencies.load_config()
    resolved_source_config = source_config or {}
    resolved_source_dimensions = source_dimensions or {}
    brain_table = dependencies.table_by_id(brain_table_id) or {}
    props_by_id = _properties_by_id(brain_table)
    role_names = _role_names(resolved_config, props_by_id)
    relation_name = _relation_name(
        resolved_config,
        resolved_source_config,
        props_by_id,
    )
    brain_dir = dependencies.resolve_table_folder({"table_id": brain_table_id})
    if not brain_dir:
        raise RuntimeError("Could not resolve the Brain table folder")
    brain_dir.mkdir(parents=True, exist_ok=True)
    existing = _collect_existing_notes(
        brain_table_id,
        source_page_id,
        dependencies,
    )
    context = _WriteContext(
        source_page_id=source_page_id,
        source_title=source_title,
        source_table_id=source_table_id,
        brain_table_id=brain_table_id,
        brain_dir=brain_dir,
        config=resolved_config,
        source_dimensions=resolved_source_dimensions,
        props_by_id=props_by_id,
        role_names=role_names,
        relation_name=relation_name,
        existing=existing,
        dependencies=dependencies,
    )
    created: list[str] = []
    created_ids: list[str] = []
    updated: list[str] = []
    active_keys: set[str] = set()
    raw_notes = plan.get("notes")
    notes = raw_notes if isinstance(raw_notes, list) else []
    for raw_note in notes:
        if not isinstance(raw_note, dict):
            continue
        outcome = _apply_note(dict(raw_note), context, active_keys)
        if outcome is None:
            continue
        action, title, identifier = outcome
        if action == "updated":
            updated.append(title)
        else:
            created.append(title)
            created_ids.append(identifier)
    _mark_stale_notes(context, active_keys)
    return {"created": created, "created_ids": created_ids, "updated": updated}


def _apply_note(
    note: dict[str, object],
    context: _WriteContext,
    active_keys: set[str],
) -> tuple[str, str, str] | None:
    title = str(note.get("title") or "").strip()
    managed_key = str(note.get("managed_key") or "").strip()
    if not title or not managed_key:
        return None
    active_keys.add(managed_key)
    metadata = _build_note_metadata(note, title, managed_key, context)
    context.dependencies.apply_dimensions(
        metadata,
        context.dependencies.effective_dimensions(
            note.get("dimensions"),
            context.source_dimensions,
        ),
        context.props_by_id,
    )
    citations = context.dependencies.render_citations(
        note.get("citations"),
        context.source_title,
        context.source_page_id,
        context.source_table_id,
    )
    managed_body = (str(note.get("body_md") or "").strip() + citations).strip()
    page = _existing_page(note, managed_key, context.existing)
    if page is not None and _update_existing_page(
        page,
        metadata,
        managed_key,
        managed_body,
        context.dependencies,
    ):
        return "updated", title, ""
    identifier = context.dependencies.uuid_factory()
    metadata["id"] = identifier
    path = context.dependencies.get_unique_filepath(context.brain_dir, title, ".md")
    portable = context.dependencies.prepare_managed_markdown(metadata)
    context.dependencies.save_page_md(
        path,
        portable,
        context.dependencies.replace_note_block("", managed_key, managed_body),
    )
    context.dependencies.register_page_in_index(path)
    return "created", title, identifier


def _build_note_metadata(
    note: dict[str, object],
    title: str,
    managed_key: str,
    context: _WriteContext,
) -> PageMetadata:
    position = integer_value(note.get("position") or 0)
    metadata = context.dependencies.base_note_metadata(
        note,
        context.source_title,
        context.source_page_id,
        position,
    )
    metadata.update(
        {
            "title": title,
            "table_id": context.brain_table_id,
            "note_type": context.dependencies.generated_note_type,
            "llm_wiki_managed": True,
            "llm_wiki_key": managed_key,
            "llm_wiki_source_table_id": context.source_table_id,
            "llm_wiki_resource_id": context.source_page_id,
            "llm_wiki_resource_title": context.source_title,
            "llm_wiki_origin_id": note.get("origin_id"),
            "llm_wiki_origin_order": note.get("origin_order"),
            "llm_wiki_origin_label": note.get("origin_label"),
            "llm_wiki_segment_id": note.get("source_segment_id"),
            "llm_wiki_stale": False,
            context.relation_name: [f"[[{context.source_title}|{context.source_page_id}]]"],
        }
    )
    _replace_role_metadata(metadata, note, position, context)
    return metadata


def _replace_role_metadata(
    metadata: PageMetadata,
    note: dict[str, object],
    position: int,
    context: _WriteContext,
) -> None:
    for fallback_name, role in (
        ("Tipus", "idea_type"),
        ("Posició", "position"),
        ("Estat de verificació", "verification"),
        ("Última revisió", "last_reviewed"),
        ("Tags", "tags"),
    ):
        if context.role_names.get(role) and context.role_names[role] != fallback_name:
            metadata.pop(fallback_name, None)
    note_type_name = context.role_names.get("note_type")
    if note_type_name:
        role_id = str(_mapping(context.config.get("brain_roles")).get("note_type") or "")
        metadata[note_type_name] = context.dependencies.note_type_value(
            "reading",
            context.config,
            context.props_by_id.get(role_id),
        )
    _apply_role_values(metadata, note, position, context)


def _apply_role_values(
    metadata: PageMetadata,
    note: dict[str, object],
    position: int,
    context: _WriteContext,
) -> None:
    if context.role_names.get("idea_type"):
        metadata[context.role_names["idea_type"]] = metadata.get("Tipus")
    if context.role_names.get("position"):
        metadata[context.role_names["position"]] = position
    if context.role_names.get("verification"):
        metadata[context.role_names["verification"]] = "provisional"
    if context.role_names.get("last_reviewed"):
        metadata[context.role_names["last_reviewed"]] = context.dependencies.today()
    if context.role_names.get("tags") and note.get("tags"):
        metadata[context.role_names["tags"]] = list(
            dict.fromkeys(str(tag) for tag in iterable_values(note["tags"]) if tag)
        )


def _collect_existing_notes(
    brain_table_id: str,
    source_page_id: str,
    dependencies: WritingDependencies,
) -> _ExistingNotes:
    existing = _ExistingNotes({}, {}, [])
    for page in dependencies.get_pages_for_table(brain_table_id) or []:
        metadata = dependencies.page_metadata(page)
        if str(metadata.get("llm_wiki_resource_id") or "") == source_page_id:
            existing.managed_for_resource.append(page)
            key = str(metadata.get("llm_wiki_key") or "")
            if key:
                existing.by_key[key] = page
        elif (
            source_page_id in dependencies.fonts_ids(metadata)
            and str(metadata.get("note_type") or "").casefold() == "lectura"
        ):
            try:
                position = integer_value(metadata.get("Posició") or 0)
            except (TypeError, ValueError):
                continue
            existing.legacy_by_position.setdefault(position, []).append(page)
    return existing


def _existing_page(
    note: dict[str, object],
    managed_key: str,
    existing: _ExistingNotes,
) -> object:
    page = existing.by_key.get(managed_key)
    if page is not None:
        return page
    position = integer_value(note.get("position") or 0)
    candidates = existing.legacy_by_position.get(position, [])
    if len(candidates) == 1:
        existing.legacy_by_position[position] = []
        return candidates[0]
    return None


def _update_existing_page(
    page: object,
    metadata: PageMetadata,
    managed_key: str,
    managed_body: str,
    dependencies: WritingDependencies,
) -> bool:
    path = dependencies.page_path(page)
    if not path or not path.exists():
        return False
    old_metadata, old_body = dependencies.parse_frontmatter(
        path.read_text(encoding="utf-8"),
        path,
    )
    old_metadata = dependencies.merge_page_metadata(
        old_metadata,
        str(getattr(page, "id", "") or old_metadata.get("id") or ""),
    )
    old_metadata.update(metadata)
    portable = dependencies.prepare_managed_markdown(old_metadata)
    dependencies.save_page_md(
        path,
        portable,
        dependencies.replace_note_block(old_body, managed_key, managed_body),
    )
    dependencies.register_page_in_index(path)
    return True


def _mark_stale_notes(context: _WriteContext, active_keys: set[str]) -> None:
    for page in context.existing.managed_for_resource:
        metadata = context.dependencies.page_metadata(page)
        key = str(metadata.get("llm_wiki_key") or "")
        if not key or key in active_keys or metadata.get("llm_wiki_stale"):
            continue
        path = context.dependencies.page_path(page)
        if not path or not path.exists():
            continue
        old_metadata, old_body = context.dependencies.parse_frontmatter(
            path.read_text(encoding="utf-8"),
            path,
        )
        old_metadata = context.dependencies.merge_page_metadata(
            old_metadata,
            str(getattr(page, "id", "") or old_metadata.get("id") or ""),
        )
        old_metadata["llm_wiki_stale"] = True
        context.dependencies.save_page_md(
            path,
            context.dependencies.prepare_managed_markdown(old_metadata),
            old_body,
        )
        context.dependencies.register_page_in_index(path)


def _properties_by_id(table: RegistryData) -> dict[str, RegistryData]:
    raw_properties = table.get("properties") or []
    return {
        str(prop.get("id") or ""): dict(prop)
        for prop in iterable_values(raw_properties)
        if is_record(prop) and prop.get("id")
    }


def _role_names(
    config: dict[str, object],
    props_by_id: dict[str, RegistryData],
) -> dict[str, str]:
    return {
        str(role): str((props_by_id.get(str(prop_id)) or {}).get("name") or "")
        for role, prop_id in _mapping(config.get("brain_roles")).items()
    }


def _relation_name(
    config: dict[str, object],
    source_config: dict[str, object],
    props_by_id: dict[str, RegistryData],
) -> str:
    relation_prop = props_by_id.get(str(source_config.get("relation_property_id") or ""))
    locale = str(config.get("ui_locale") or "en").split("-", 1)[0].lower()
    fallback = {
        "ca": "Font",
        "en": "Source",
        "es": "Fuente",
        "fr": "Source",
    }.get(locale, "Source")
    return str((relation_prop or {}).get("name") or fallback)


def _mapping(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


__all__ = ["WritingDependencies", "apply_plan"]
