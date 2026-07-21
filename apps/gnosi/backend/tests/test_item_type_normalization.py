"""Item Type write-space normalization (canonical Zotero key → catalog label).

Covers the two-space problem of the Recursos `Item Type` select: the catalog
speaks translated labels ('Llibre') while every import pipeline produces
canonical Zotero keys ('book'). `normalize_item_type` converts at the write
boundary with the table's catalog as the authority; `resolve_zotero_type`
resolves both spaces for the BibTeX/RIS export.

Pure functions — no live backend required.

    python -m pytest backend/tests/test_item_type_normalization.py -v
"""
from __future__ import annotations

import pytest

from backend.services.csl_type_resolver import (
    LEGACY_TYPE_ALIASES,
    LEGACY_TYPE_TO_ZOTERO,
    normalize_item_type,
    resolve_csl_type,
    resolve_zotero_item_type,
    resolve_zotero_type,
)
from backend.services.references_io import entry_to_bibtex, entry_to_ris, parse_bibtex
from backend.services.zotero_schema import (
    LABEL_TO_ZOTERO_TYPE,
    ZOTERO_TO_CSL_TYPE,
)

# The real Recursos catalog mixes canonical ca-AD labels, legacy aliases,
# typos and fully custom types — the fixtures below reproduce that mix.
CATALAN_CATALOG = [
    'Article científic',        # legacy → journalArticle
    'Article divulgatiu',       # legacy → magazineArticle
    'Llibre',                   # ca-AD → book
    'Tesis',                    # legacy/es-ES → thesis
    'Tesi',                     # ca-AD → thesis
    'Pàgina web',               # ca-AD → webpage
    'Article de revista acadèmica',  # ca-AD → journalArticle
    'Article de revista',       # legacy → journalArticle (ca-AD would say magazineArticle)
    'Ruta en bici',             # custom — not a Zotero type
    'Document',                 # legacy AND ca-AD → document
]


# --- Legacy alias coherence --------------------------------------------------


def test_legacy_zotero_map_mirrors_csl_aliases():
    """Same keys, and the Zotero twin must cite like the CSL alias does."""
    assert set(LEGACY_TYPE_TO_ZOTERO) == set(LEGACY_TYPE_ALIASES)
    for label, zotero_key in LEGACY_TYPE_TO_ZOTERO.items():
        assert ZOTERO_TO_CSL_TYPE[zotero_key] == LEGACY_TYPE_ALIASES[label], label


def test_resolvers_agree_on_every_space():
    """resolve_csl_type(x) == CSL(resolve_zotero_type(x)) for keys, labels and aliases.

    Same 'document' fallback on both sides: 'annotation' (and its labels) is a
    valid Zotero key with no CSL mapping.
    """
    samples = list(ZOTERO_TO_CSL_TYPE) + list(LEGACY_TYPE_TO_ZOTERO) + ["annotation"]
    for labels in LABEL_TO_ZOTERO_TYPE.values():
        samples.extend(labels)
    for raw in samples:
        assert resolve_csl_type(raw) == ZOTERO_TO_CSL_TYPE.get(resolve_zotero_type(raw), 'document'), raw


# --- resolve_zotero_type -----------------------------------------------------


@pytest.mark.parametrize("raw,expected", [
    ("journalArticle", "journalArticle"),      # canonical key → identity
    ("book", "book"),
    ("Llibre", "book"),                        # ca-AD label
    ("Libro", "book"),                         # es-ES label
    ("Journal Article", "journalArticle"),     # en-US label
    ("Article científic", "journalArticle"),   # legacy alias
    ("Tesis", "thesis"),                       # legacy AND es-ES: same key
    ("Vídeo", "videoRecording"),               # legacy alias
    ("Ruta en bici", None),                    # custom type
    ("", None),
    (None, None),
    (42, None),
])
def test_resolve_zotero_type(raw, expected):
    assert resolve_zotero_type(raw) == expected


def test_item_type_variant_is_total():
    # The export-facing wrapper degrades unrecognized values to 'document'
    # instead of None, and otherwise delegates to resolve_zotero_type.
    assert resolve_zotero_item_type("Llibre") == "book"
    assert resolve_zotero_item_type("Ruta en bici") == "document"
    assert resolve_zotero_item_type("") == "document"
    assert resolve_zotero_item_type("annotation") == "annotation"


def test_legacy_precedence_over_canonical_label():
    # 'Article de revista' is ca-AD for magazineArticle, but its LEGACY meaning
    # (journalArticle) must win — exactly like it wins in resolve_csl_type.
    assert resolve_zotero_type("Article de revista") == "journalArticle"
    assert resolve_csl_type("Article de revista") == "article-journal"


# --- normalize_item_type: the catalog is the authority -----------------------


def test_key_becomes_catalog_label():
    assert normalize_item_type("book", CATALAN_CATALOG) == "Llibre"
    assert normalize_item_type("webpage", CATALAN_CATALOG) == "Pàgina web"


def test_canonical_catalog_label_beats_legacy_alias():
    # journalArticle is denoted by three catalog options; the canonical ca-AD
    # one must win over 'Article científic' / 'Article de revista' (legacy).
    assert normalize_item_type("journalArticle", CATALAN_CATALOG) == "Article de revista acadèmica"
    # thesis: 'Tesi' (canonical ca-AD) wins over 'Tesis' (legacy/es-ES).
    assert normalize_item_type("thesis", CATALAN_CATALOG) == "Tesi"
    # bookSection: canonical "Capítol d'un llibre" over the legacy spelling.
    assert normalize_item_type(
        "bookSection", ["Secció de Llibre", "Capítol d'un llibre"],
    ) == "Capítol d'un llibre"


def test_legacy_only_match_is_still_used():
    assert normalize_item_type("conferencePaper", ["Ponència", "Llibre"]) == "Ponència"
    # 'Article de revista' resolves as legacy journalArticle, so it can NOT
    # denote magazineArticle — only 'Article divulgatiu' matches.
    assert normalize_item_type("magazineArticle", CATALAN_CATALOG) == "Article divulgatiu"


def test_label_input_converges_onto_catalog_label():
    # Catalog authority also unifies label-space variants.
    assert normalize_item_type("Libro", CATALAN_CATALOG) == "Llibre"
    assert normalize_item_type("Tesis", CATALAN_CATALOG) == "Tesi"


def test_missing_type_falls_back_to_catalog_locale():
    # No preprint option: a Catalan-dominant catalog extends in Catalan.
    assert normalize_item_type("preprint", CATALAN_CATALOG) == "Prepublicació"


def test_missing_type_without_catalog_falls_back_to_en_us():
    assert normalize_item_type("book", []) == "Book"
    assert normalize_item_type("preprint", None) == "Preprint"


def test_label_without_catalog_is_kept():
    # Already human-readable: without catalog evidence there is no reason to
    # move it between locales.
    assert normalize_item_type("Llibre", []) == "Llibre"
    assert normalize_item_type("Tesis", []) == "Tesis"


def test_custom_values_pass_through():
    assert normalize_item_type("Ruta en bici", CATALAN_CATALOG) == "Ruta en bici"
    assert normalize_item_type("", CATALAN_CATALOG) == ""
    assert normalize_item_type(None, CATALAN_CATALOG) is None


@pytest.mark.parametrize("value", [
    "book", "journalArticle", "thesis", "preprint", "Llibre", "Libro",
    "Tesis", "Article de revista", "Ruta en bici", "Journal Article",
])
@pytest.mark.parametrize("catalog", [CATALAN_CATALOG, [], ["Book", "Thesis"]])
def test_normalization_is_idempotent(value, catalog):
    once = normalize_item_type(value, catalog)
    assert normalize_item_type(once, catalog) == once


# --- BibTeX/RIS export resolves both spaces ----------------------------------


@pytest.mark.parametrize("item_type,btype", [
    ("Llibre", "@book"),                        # catalog label
    ("Article de revista acadèmica", "@article"),
    ("Tesis", "@phdthesis"),                    # legacy alias
    ("Article científic", "@article"),
    ("journalArticle", "@article"),             # canonical key (round-trip)
    ("Ruta en bici", "@misc"),                  # custom → generic
])
def test_bibtex_export_resolves_item_type(item_type, btype):
    bib = entry_to_bibtex({"Citation Key": "k1", "Item Type": item_type, "Title": "T"})
    assert bib.startswith(f"{btype}{{k1,"), bib


@pytest.mark.parametrize("item_type,ty", [
    ("Llibre", "BOOK"),
    ("Article de revista acadèmica", "JOUR"),
    ("Tesi", "THES"),
    ("webpage", "ELEC"),
    ("Ruta en bici", "GEN"),
])
def test_ris_export_resolves_item_type(item_type, ty):
    ris = entry_to_ris({"Citation Key": "k1", "Item Type": item_type, "Title": "T"})
    assert ris.splitlines()[0] == f"TY  - {ty}", ris


def test_parse_still_emits_canonical_keys():
    # Parsing stays in the canonical space: the write boundary (the import
    # endpoint) is the one converting to the target table's catalog label.
    entries = parse_bibtex("@book{marx1867, title = {El Capital}}")
    assert entries[0]["Item Type"] == "book"


# --- vault_routes glue: catalog extraction + suggested normalization ---------

from backend.api.vault_routes import (  # noqa: E402
    _item_type_catalog_names,
    _normalize_suggested_item_type,
)

_REF_TABLE = {
    "id": "tbl-ref",
    "properties": [
        {"id": "f1", "name": "Title", "type": "title"},
        {"id": "f2", "name": "Item Type", "type": "select",
         "config": {"options": [{"name": "Llibre", "color": "blue"}, "Tesi"]}},
    ],
}


def test_item_type_catalog_names_reads_rich_and_legacy_options():
    assert _item_type_catalog_names(_REF_TABLE) == ["Llibre", "Tesi"]


def test_item_type_catalog_names_matches_name_variants():
    table = {"properties": [{"name": "item type", "type": "select",
                             "options": ["Llibre"]}]}
    assert _item_type_catalog_names(table) == ["Llibre"]
    assert _item_type_catalog_names({"properties": [{"name": "Estat"}]}) == []
    assert _item_type_catalog_names(None) == []


def test_item_type_catalog_names_resolves_catalog_ref():
    table = {"properties": [{"name": "Item Type", "type": "select",
                             "config": {"catalog_ref": "tipus"}}]}
    registry = {"option_catalogs": {"tipus": ["Llibre", "Pàgina web"]}}
    assert _item_type_catalog_names(table, registry) == ["Llibre", "Pàgina web"]


def test_normalize_suggested_uses_reference_table_catalog(monkeypatch):
    monkeypatch.setattr("backend.api.vault_routes.get_reference_table_id", lambda: "tbl-ref")
    monkeypatch.setattr("backend.api.vault_routes.load_registry",
                        lambda: {"tables": [_REF_TABLE]})
    sug = _normalize_suggested_item_type({"Item Type": "book", "Title": "X"})
    assert sug["Item Type"] == "Llibre"
    assert sug["Title"] == "X"


def test_normalize_suggested_without_item_type_is_noop(monkeypatch):
    monkeypatch.setattr("backend.api.vault_routes.get_reference_table_id",
                        lambda: (_ for _ in ()).throw(AssertionError("must not be called")))
    assert _normalize_suggested_item_type({"Title": "X"}) == {"Title": "X"}
    assert _normalize_suggested_item_type({}) == {}


def test_normalize_suggested_survives_registry_errors(monkeypatch):
    monkeypatch.setattr("backend.api.vault_routes.get_reference_table_id",
                        lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    # Best-effort: the bare key still becomes a human label (en-US fallback).
    sug = _normalize_suggested_item_type({"Item Type": "book"})
    assert sug["Item Type"] == "Book"
