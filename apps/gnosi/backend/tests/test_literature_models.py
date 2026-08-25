from backend.services.literature_models import (
    canonical_work,
    clean_text,
    deduplicate_works,
    deterministic_key,
    normalize_arxiv,
    normalize_doi,
    normalize_isbn13,
)


def _work(provider, provider_id, *, title="Evidence synthesis", year=2024, author="Riu, Ada", **identifiers):
    return canonical_work(
        provider,
        provider_id,
        title=title,
        year=year,
        authors=[author],
        identifiers={"isbn13": [], "provider": {}, **identifiers},
        sources=[{"provider": provider, "provider_id": provider_id, "url": f"https://example.org/{provider_id}"}],
    )


def test_identifier_normalization_removes_resolvers_and_versions():
    assert normalize_doi("https://doi.org/10.1000/ABC.123.") == "10.1000/abc.123"
    assert normalize_arxiv("arXiv:2401.01234v3") == "2401.01234"
    assert normalize_isbn13("978-0-306-40615-7") == "9780306406157"


def test_provider_text_decodes_entities_before_removing_markup():
    assert clean_text("&lt;strong&gt;Open&amp;nbsp; science&lt;/strong&gt;") == "Open science"


def test_deterministic_key_uses_required_identifier_priority():
    work = _work("source", "one", doi="10.1000/test", pmid="12345", arxiv="2401.01234")
    assert deterministic_key(work) == "doi:10.1000/test"


def test_deduplication_merges_sources_and_keeps_provider_citation_counts():
    first = _work("crossref", "10.1000/test", doi="10.1000/test")
    first["abstract"] = "Longer abstract from Crossref."
    first["metrics"] = {"citations": {"crossref": 12}}
    second = _work("openaire", "record-2", doi="10.1000/TEST")
    second["metrics"] = {"citations": {"openaire": 9}}

    merged = deduplicate_works([first, second])

    assert len(merged) == 1
    assert {item["provider"] for item in merged[0]["sources"]} == {"crossref", "openaire"}
    assert merged[0]["metrics"]["citations"] == {"crossref": 12, "openaire": 9}


def test_conflicting_values_are_visible_with_field_provenance():
    first = _work("crossref", "10.1000/test", title="Primary title", doi="10.1000/test")
    second = _work("datacite", "10.1000/test", title="Conflicting title", doi="10.1000/test")

    merged = deduplicate_works([first, second])[0]

    assert {entry["provider"] for entry in merged["conflicts"]["title"]} == {"crossref", "datacite"}
    assert merged["provenance"]["title"] == ["crossref", "datacite"]


def test_fuzzy_matches_are_only_warnings_and_are_not_merged():
    first = _work("source-a", "a", title="A systematic review of open science practices", year=None, author="")
    second = _work("source-b", "b", title="A systematic review of open science practice", year=None, author="")

    results = deduplicate_works([first, second])

    assert len(results) == 2
    assert results[0]["possible_duplicates"][0]["result_id"] == results[1]["id"]
