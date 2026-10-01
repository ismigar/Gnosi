"""Persist source-owned section rows through the existing Vault page writer."""

from __future__ import annotations

from typing import TYPE_CHECKING
from collections.abc import Mapping
from uuid import NAMESPACE_URL, uuid5

from backend.domains.llm_wiki.source_structure import section_id
from backend.domains.vault.pages.foundation_values import PageMetadata

if TYPE_CHECKING:
    from backend.domains.llm_wiki.writing import WritingDependencies


def persist_sections(notes: list[dict[str, object]], prop: Mapping[object, object],
                     brain_id: str, source_table_id: str, resource_id: str,
                     resource_title: str, dependencies: WritingDependencies,
                     ) -> dict[str, list[str]]:
    """Return one section id per note, plus ancestor ids for hierarchy filtering."""
    table_id = str(prop.get("relation_database_id") or "")
    table = dependencies.table_by_id(table_id) or {}
    folder = dependencies.resolve_table_folder({"table_id": table_id})
    if not table or folder is None:
        raise RuntimeError("The source sections table is unavailable")
    folder.mkdir(parents=True, exist_ok=True)
    raw_properties = table.get("properties")
    props = [p for p in raw_properties if isinstance(p, dict)] if isinstance(raw_properties, list) else []
    names = {role: str(next((p.get("name") for p in props if p.get("id") ==
                            str(uuid5(NAMESPACE_URL, f"gnosi:{table_id}:{role}"))), role))
             for role in ("source", "parent", "position")}
    existing = {str(dependencies.page_metadata(page).get("id") or getattr(page, "id", "")): page
                for page in dependencies.get_pages_for_table(table_id)}
    result: dict[str, list[str]] = {}
    rows: dict[str, PageMetadata] = {}
    multiple_documents = len({str(note.get("source_document_key") or "") for note in notes
                              if note.get("source_section_path")}) > 1
    for note in notes:
        raw_path = note.get("source_section_path")
        nodes = [node for node in raw_path if isinstance(node, dict)] if isinstance(raw_path, list) else []
        ids: list[str] = []
        titles: list[str] = []
        document = str(note.get("source_document_key") or "")
        for node in nodes:
            if not document or not node.get("key") or not node.get("title"):
                continue
            identity = str(node.get("identity") or node["key"])
            identifier = section_id(brain_id, source_table_id, resource_id, document, identity)
            titles.append(str(node["title"]))
            label = str(note.get("source_document_label") or "")
            display_path = " › ".join([label, *titles] if multiple_documents and label else titles)
            rows[identifier] = {
                "id": identifier, "table_id": table_id,
                "title": f"{resource_title} › {display_path}",
                names["source"]: resource_title,
                names["parent"]: ids[-1:] if ids else [],
                names["position"]: node.get("order", 0),
                "llm_wiki_resource_id": resource_id,
                "llm_wiki_source_table_id": source_table_id,
                "llm_wiki_section_path": " › ".join(titles),
                "llm_wiki_section_display_path": display_path,
                "llm_wiki_document_label": label,
                "llm_wiki_section_parent_id": ids[-1] if ids else "",
                "llm_wiki_section_ancestor_ids": list(ids),
                "llm_wiki_section_key": node["key"],
                "llm_wiki_section_stale": False,
                "llm_wiki_document_key": document,
                "llm_wiki_section_order": rows.get(identifier, {}).get("llm_wiki_section_order",
                    [note.get("origin_order", 0), note.get("segment_order", 0), len(titles)]),
            }
            ids.append(identifier)
        result[str(note.get("managed_key") or "")] = ids
    for identifier, metadata in rows.items():
        page = existing.get(identifier)
        path = dependencies.page_path(page) if page is not None else None
        body = ""
        if path is not None and path.exists():
            current, body = dependencies.parse_frontmatter(path.read_text(encoding="utf-8"), path)
            metadata = {**current, **metadata}
        else:
            path = folder / f"{identifier}.md"
        portable = dependencies.prepare_managed_markdown(metadata)
        dependencies.save_page_md(path, portable, body)
        dependencies.register_page_in_index(path)
    for identifier, page in existing.items():
        metadata = dependencies.page_metadata(page)
        if (identifier in rows or metadata.get("llm_wiki_resource_id") != resource_id
                or metadata.get("llm_wiki_source_table_id") != source_table_id
                or metadata.get("llm_wiki_section_stale")):
            continue
        path = dependencies.page_path(page)
        if path is None or not path.exists():
            continue
        _current, body = dependencies.parse_frontmatter(path.read_text(encoding="utf-8"), path)
        metadata["llm_wiki_section_stale"] = True
        portable = dependencies.prepare_managed_markdown(metadata)
        dependencies.save_page_md(path, portable, body)
        dependencies.register_page_in_index(path)
    return result
