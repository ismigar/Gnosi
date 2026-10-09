"""Real property contracts carry idea classification without implicit concepts."""

import json
from dataclasses import replace
from pathlib import Path

import pytest

from backend.domains.llm_wiki import classification_repair, writing
from backend.domains.llm_wiki.dimensions import (
    DimensionDependencies,
    build_dimension_context,
    canonical_dimension_value,
    dimension_options,
    metadata_property_value,
)
from backend.domains.llm_wiki.reading_action_contracts import validate_note_dimensions
from backend.domains.llm_wiki.semantic_contracts import bind_note, semantic_note
from backend.domains.vault.registry.state import RegistryData
from backend.tests.test_llm_wiki_writing_open_metadata_contract import _dependencies, _Page

IDEA: RegistryData = {
    "id": "idea",
    "name": "Idea",
    "type": "select",
    "config": {
        "plugin_roles": {"llm-wiki": "idea_type"},
        "options": ["Entity", "Concept", "Summary", "Synthesis"],
        "plugin_option_values": {
            "entitat": "Entity",
            "concepte": "Concept",
            "resum": "Summary",
            "síntesi": "Synthesis",
        },
    },
}
TABLE: RegistryData = {"id": "brain", "properties": [IDEA]}
CONFIG = {"brain_table_id": "brain", "brain_roles": {"idea_type": "idea"}, "index_field_ids": []}
DEPS = DimensionDependencies(
    table_by_id=lambda _id: TABLE,
    pages_for_table=lambda _id: [],
    canonical_value=canonical_dimension_value,
    dimension_options=dimension_options,
    metadata_value=metadata_property_value,
)


def test_idea_is_classified_even_when_not_an_index_or_selected_assignment() -> None:
    mapped, specs = build_dimension_context(
        CONFIG, {}, {"assignment_field_ids": []}, {}, dependencies=DEPS
    )
    assert mapped == {} and len(specs) == 1
    assert specs[0]["field_id"] == "idea" and specs[0]["role"] == "idea_type"
    assert specs[0]["allowed_labels"] == ["Entity", "Concept", "Summary", "Synthesis"]


@pytest.mark.parametrize(
    ("mode", "fixed", "expected"),
    [("fixed", "Summary", "Summary"), ("empty", None, None), ("source", None, "Entity")],
)
def test_explicit_mapping_overrides_default_ai(mode: str, fixed: object, expected: object) -> None:
    source = {"properties": [{"id": "kind", "name": "Kind", "type": "select"}]}
    mapped, specs = build_dimension_context(
        CONFIG,
        source,
        {
            "dimension_mappings": {
                "idea": {"mode": mode, "fixed_value": fixed, "source_property_id": "kind"}
            }
        },
        {"Kind": "Entity"},
        dependencies=DEPS,
    )
    assert mapped == {"idea": expected} and specs == []


@pytest.mark.parametrize("label", ["Entity", "Concept", "Summary", "Synthesis", None])
def test_classification_and_abstention_survive_binding_and_review_projection(
    label: str | None,
) -> None:
    _, specs = build_dimension_context(CONFIG, {}, {}, {}, dependencies=DEPS)
    original = {"id": "segment", "text": "A concrete claim has qualifications."}
    value = {
        "title": "A qualified claim",
        "body_md": "The author qualifies this claim.",
        "quotes": [original["text"]],
        "properties": {"property_1": [label] if label else []},
        "classification_reason": "The note develops a claim."
        if label
        else "Its function is ambiguous.",
    }
    note = bind_note(value, original, [original], specs)
    assert note["dimensions"] == {"idea": [label] if label else []}
    assert semantic_note(note, specs) == value
    with pytest.raises(ValueError, match="classification_reason"):
        validate_note_dimensions({"notes": [{"dimensions": note["dimensions"]}]}, specs)


def test_missing_classification_cannot_silently_be_written_as_concept(tmp_path: Path) -> None:
    deps = replace(
        _dependencies(tmp_path), table_by_id=lambda _id: TABLE, load_config=lambda: CONFIG
    )
    with pytest.raises(ValueError, match="Missing idea classification"):
        writing.apply_plan(
            {"notes": [{"title": "Note", "managed_key": "key"}]},
            "source",
            "Source",
            "brain",
            dependencies=deps,
        )


def test_manually_edited_type_survives_reprocessing(tmp_path: Path) -> None:
    path = tmp_path / "Note.md"
    path.write_text("Existing file")
    old = {
        "id": "note",
        "table_id": "brain",
        "Idea": "Synthesis",
        "llm_wiki_key": "key",
        "llm_wiki_resource_id": "source",
        "llm_wiki_idea_classification": {"version": 1, "value": "Concept"},
    }
    saved = []
    deps = replace(
        _dependencies(tmp_path),
        table_by_id=lambda _id: TABLE,
        load_config=lambda: CONFIG,
        get_pages_for_table=lambda _id: [_Page("note", path, old)],
        parse_frontmatter=lambda _text, _path: (dict(old), "Original body"),
        save_page_md=lambda _path, meta, _body: saved.append(meta),
    )
    writing.apply_plan(
        {
            "notes": [
                {
                    "title": "Note",
                    "managed_key": "key",
                    "dimensions": {"idea": "Summary"},
                    "classification_reason": "A condensed argument.",
                }
            ]
        },
        "source",
        "Source",
        "brain",
        dependencies=deps,
    )
    assert saved[-1]["Idea"] == "Synthesis"
    assert saved[-1]["llm_wiki_idea_classification"] == old["llm_wiki_idea_classification"]


def test_repair_rejects_repeated_ids_and_accepts_explained_abstention() -> None:
    notes = [{"id": "a"}, {"id": "b"}]
    rows = [
        {"id": "a", "values": [], "reason": "Ambiguous"},
        {"id": "b", "values": ["Concept"], "reason": "One idea"},
    ]
    result = classification_repair.classify(
        notes, ["Concept"], lambda _p, _s: json.dumps({"classifications": rows})
    )
    assert result["a"]["value"] is None
    rows[1]["id"] = "a"
    with pytest.raises(ValueError, match="Repeated"):
        classification_repair.classify(
            notes, ["Concept"], lambda _p, _s: json.dumps({"classifications": rows})
        )
