from backend.services import literature_import_service


def test_existing_lookup_suggestion_converts_to_academic_work():
    work = literature_import_service.suggested_resource_to_work({
        "Title": "Captured evidence",
        "Authors": "Riu, Ada; Sol, Pau",
        "Any": 2024,
        "Item Type": "Journal Article",
        "Llibre/Revista": "Evidence Journal",
        "DOI": "https://doi.org/10.1000/captured",
        "URL": "https://example.org/captured",
        "Open Access": True,
        "Zotero Extras": {"abstractNote": "Verified abstract"},
    }, provider="crossref", provider_id="10.1000/captured")
    assert work["title"] == "Captured evidence"
    assert work["type"] == "journal-article"
    assert work["identifiers"]["doi"] == "10.1000/captured"
    assert work["open_access"]["is_oa"] is True
    assert work["abstract"] == "Verified abstract"
