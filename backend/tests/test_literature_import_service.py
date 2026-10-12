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


def test_academic_import_preserves_structured_roles_and_complete_bibliography(isolated_validation_runtime):
    person = {"nom": "Ada", "cognom1": "García", "cognom2": "Riu"}
    metadata = {
        "Title": "A chapter", "Autoría": [person], "Editors": [{"nom": "Joan", "cognom1": "Puig", "cognom2": ""}],
        "Traductors": [{"nom": "Anna", "cognom1": "Sol", "cognom2": ""}], "Item Type": "bookSection",
        "Any": 2024, "Mes": 6, "Dia": 12, "Lloc": "Barcelona", "Edició": "2", "Data de consulta": "2025-01-02",
        "Zotero Extras": {"custom": "preserved"},
    }
    work = literature_import_service.suggested_resource_to_work(metadata, provider="crossref", provider_id="x")
    assert work["authors"][0]["given"] == "Ada"
    assert work["authors"][0]["family"] == "García Riu"
    assert work["dates"]["issued"] == "2024-06-12"
    result = literature_import_service.work_to_resources(work)
    for field in ("Autoría", "Editors", "Traductors", "Lloc", "Edició", "Data de consulta", "Zotero Extras", "Mes", "Dia"):
        assert result[field] == metadata[field]
