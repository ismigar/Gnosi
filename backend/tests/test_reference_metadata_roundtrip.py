"""Bibliographic data survives lookup, display, citations and format round trips.

Persisted Resources labels and source data are language examples. @language-example
"""
from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

import pytest

from backend.domains.vault.citations.authors import recursos_metadata_to_csl
from backend.services.csl_type_resolver import resolve_csl_type
from backend.services.reference_catalog import REFERENCE_CREATOR_ROLES, REFERENCE_TEXT_FIELDS, ZOTERO_CREATOR_COLUMNS
from backend.services.reference_dates import csl_date
from backend.services.reference_exchange import canonical_metadata
from backend.services.reference_metadata import reference_schema
from backend.services.reference_schema import author_property, bind_roles, complete_properties
from backend.services.references_io import parse_bibtex, parse_ris, to_bibtex, to_ris
from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos


def person(given: str, family: str = "", second: str = "") -> dict[str, str]:
    return {"nom": given, "cognom1": family, "cognom2": second}


@pytest.fixture
def full_record():
    return {
        "Citation Key": "garcia2024", "Item Type": "bookSection", "Title": "A {B} & C: 50%_x",
        "Autoría": [person("Ada", "García", "Riu"), person("Research and Development Council")],
        "Editors": [person("Joan", "Puig")], "Traductors": [person("Anna", "Sol")],
        "Autors del llibre": [person("Pau", "Roca")], "Editors de col·lecció": [person("Maria", "Vila")],
        "Any": 2024, "Mes": 6, "Dia": 12, "Data de consulta": "2025-02-28", "Data original": "1900",
        "Llibre/Revista": "A collected work", "Lloc": "Barcelona", "Editorial": "Edicions X",
        "Volum": "2", "Número": "3", "Pàgines": "14-28", "Núm. pàgines": 400,
        "Edició": "2", "Col·lecció": "Studies", "Número de col·lecció": "14", "Idioma": "ca",
        "ISBN": "9780306406157", "ISSN": "1234-567X", "DOI": "10.1000/test", "URL": "https://example.org",
        "Abstract": "First line\nSecond line", "Notes bibliogràfiques": "An annotation",
        "Zotero Extras": {"customBibliographicField": {"value": "keep"}},
        "Personal notes": "PRIVATE", "path": "/PRIVATE/path", "id": "PRIVATE-id",
    }


@pytest.mark.parametrize("export,parse", [(to_bibtex, parse_bibtex), (to_ris, parse_ris)])
def test_complete_record_roundtrip_preserves_roles_names_dates_and_extras(full_record, export, parse):
    expected = canonical_metadata(full_record)
    text = export([full_record])
    actual = parse(text)[0]
    assert {key: actual[key] for key in expected} == expected
    assert "PRIVATE" not in text
    # Repeated round trips do not grow envelopes or accumulate legacy fields.
    assert export(parse(text)) == text


@pytest.mark.parametrize("export,parse,old,new", [
    (to_bibtex, parse_bibtex, "editor = {Puig, Joan}", "editor = {Nou, Editor}"),
    (to_ris, parse_ris, "A2  - Puig, Joan", "A2  - Nou, Editor"),
])
def test_external_edits_win_while_unchanged_supplemental_data_survives(full_record, export, parse, old, new):
    text = export([full_record])
    assert old in text
    result = parse(text.replace(old, new))[0]
    assert result["Editors"] == [person("Editor", "Nou")]
    assert result["Autoría"] == full_record["Autoría"]
    assert result["Zotero Extras"] == full_record["Zotero Extras"]


def test_bibtex_corporate_names_and_book_roles_without_envelope():
    result = parse_bibtex('@incollection{x, title={Chapter}, author={{Research and Development Council}}, editor={Puig, Joan and Sol, Anna}, translator={Riu, Maria}, bookauthor={Vila, Pau}, date={2024-05-12}, urldate={2025-02-01}, series={Studies}, institution={UNED}}')[0]
    assert result["Autoría"] == [person("Research and Development Council")]
    assert result["Editors"] == [person("Joan", "Puig"), person("Anna", "Sol")]
    assert result["Traductors"] == [person("Maria", "Riu")]
    assert result["Mes"] == 5 and result["Dia"] == 12
    assert result["Data de consulta"] == "2025-02-01"


def test_ris_book_and_chapter_editor_roles_follow_format_without_envelope():
    for kind, tag in (("BOOK", "A3"), ("CHAP", "A2")):
        result = parse_ris(f"TY  - {kind}\nTI  - Title\n{tag}  - Puig, Joan\nA4  - Sol, Anna\nPY  - 2024/06/12/\nER  - \n")[0]
        assert result["Editors"] == [person("Joan", "Puig")]
        assert result["Traductors"] == [person("Anna", "Sol")]
        assert result["Mes"] == 6 and result["Dia"] == 12
        assert "Autoría" not in result and "Authors" not in result


def test_ris_unknown_and_repeated_fields_and_continuations_survive():
    text = "TY  - THES\nTI  - Thesis\nPB  - UNED\nAB  - First\n      Second\nUR  - https://one.org\nUR  - https://two.org\nZZ  - custom\nER  - \n"
    data = parse_ris(text)[0]
    assert data["Institució"] == "UNED"
    assert data["Abstract"] == "First\nSecond"
    assert data["RIS Extras"]["UR"] == ["https://one.org", "https://two.org"]
    assert parse_ris(to_ris([data]))[0]["RIS Extras"] == data["RIS Extras"]


def test_creators_never_become_authors_by_array_order():
    metadata = {"Editors": [person("Editor", "Puig")], "Traductors": [person("Translator", "Sol")], "Citation Key": "x", "Item Type": "book"}
    csl = recursos_metadata_to_csl("An edited volume", metadata, resolve_csl_type)
    assert "author" not in csl
    assert csl["editor"] == [{"family": "Puig", "given": "Editor"}]
    assert csl["translator"] == [{"family": "Sol", "given": "Translator"}]
    metadata["Autoría"] = [person("Author", "Vila")]
    assert recursos_metadata_to_csl("T", metadata, resolve_csl_type)["author"][0]["family"] == "Vila"


def test_renamed_role_columns_are_explicit_and_do_not_create_duplicate_author_column():
    properties = [
        {"id": "edit", "name": "Scientific editors", "type": "autoria", "config": {"citation_role": "editor"}},
        {"id": "auth", "name": "My authors", "type": "autoria"},
    ]
    new, added = complete_properties(properties, reference_schema(), lambda: str(uuid4()))
    assert author_property(new)["id"] == "auth"
    assert not any(p["name"] == "Autoría" for p in new)
    assert added > 0 and properties[1].get("config") is None
    repeated, count = complete_properties(new, reference_schema(), lambda: str(uuid4()))
    assert count == 0 and repeated == new
    assert all(p["type"] == "autoria" for p in new if p["name"] in REFERENCE_CREATOR_ROLES)
    metadata = {"Citation Key": "x", "Scientific editors": [person("Joan", "Puig")]}
    bind_roles(metadata, new)
    csl = recursos_metadata_to_csl("T", metadata, resolve_csl_type)
    assert "author" not in csl and csl["editor"][0]["family"] == "Puig"


def test_full_dates_and_specialized_publication_fields_reach_csl(full_record):
    csl = recursos_metadata_to_csl("T", full_record, resolve_csl_type)
    assert csl["issued"] == {"date-parts": [[2024, 6, 12]]}
    assert csl["accessed"] == {"date-parts": [[2025, 2, 28]]}
    assert csl["author"][1] == {"literal": "Research and Development Council"}
    assert csl["publisher-place"] == "Barcelona"
    assert csl["collection-title"] == "Studies"


@pytest.mark.parametrize("raw,expected", [
    ("2024 May 15", {"date-parts": [[2024, 5, 15]]}),
    ("May 2024", {"date-parts": [[2024, 5]]}),
    ("2024-02-29", {"date-parts": [[2024, 2, 29]]}),
    ("2023-02-29", {"literal": "2023-02-29"}),
    ("in press", {"literal": "in press"}),
])
def test_date_precision_and_invalid_dates_are_preserved(raw, expected):
    assert csl_date(raw) == expected


def test_every_zotero_type_preserves_all_bibliographic_values_and_creator_roles():
    schema = json.loads((Path(__file__).parents[2] / "pipeline/skills/zotero_schema/schema.json").read_text())
    for item_type in schema["itemTypes"]:
        kind = item_type["itemType"]
        if kind in {"attachment", "note", "annotation"}:
            continue
        fields = {field["field"]: f"value:{field['field']}" for field in item_type.get("fields", [])}
        item = {"itemType": kind, **fields, "creators": [
            {"creatorType": creator["creatorType"], "lastName": creator["creatorType"], "firstName": "Name"}
            for creator in item_type.get("creatorTypes", [])
        ]}
        result = zotero_item_to_recursos(item)
        serialized = json.dumps(result, ensure_ascii=False)
        for key, value in fields.items():
            assert value in serialized, (kind, key)
        for source, column in ZOTERO_CREATOR_COLUMNS[kind].items():
            assert any(p["cognom1"] == source for p in result[column]), (kind, source, column)
        for export, parse in ((to_bibtex, parse_bibtex), (to_ris, parse_ris)):
            exported = parse(export([result]))[0]
            assert canonical_metadata(exported) == canonical_metadata(result), kind


def test_old_zotero_extras_are_citable_and_explicit_fields_win():
    metadata = {"Citation Key": "x", "Item Type": "thesis", "Zotero Extras": {"university": "UNED", "thesisType": "Doctoral thesis", "accessDate": "2024-01-02"}}
    result = recursos_metadata_to_csl("T", metadata, resolve_csl_type)
    assert result["publisher"] == "UNED" and result["genre"] == "Doctoral thesis"
    metadata["Institució"] = ""
    assert "publisher" not in recursos_metadata_to_csl("T", metadata, resolve_csl_type)


def test_field_rename_keeps_citation_role_binding_on_read_and_save():
    from backend.services.field_resolver import to_response_names, to_storage_names
    table = {"properties": [{"id": "fld_00000001", "name": "Scientific editors", "type": "autoria", "aliases": ["Editors"]}]}
    metadata = {"Editors": [person("Joan", "Puig")], "_citation_roles": {"Editors": "editor"}}
    for resolve in (to_response_names, lambda data, schema: to_storage_names(data, schema)[0]):
        resolved = resolve(metadata, table)
        assert resolved["_citation_roles"] == {"Scientific editors": "editor"}
        assert resolved["Scientific editors"] == metadata["Editors"]
    assert metadata["_citation_roles"] == {"Editors": "editor"}


def test_configured_roles_are_bound_on_native_page_writes_only_for_reference_schemas():
    from backend.services.reference_schema import bind_configured_roles
    metadata = {"Editors": [person("Joan", "Puig")]}
    bind_configured_roles(metadata, [{"name": "Other people", "type": "autoria"}])
    assert "_citation_roles" not in metadata
    bind_configured_roles(metadata, [{"name": "Editors", "type": "autoria", "config": {"citation_role": "editor"}}])
    assert metadata["_citation_roles"] == {"Editors": "editor"}
