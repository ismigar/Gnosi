import asyncio

import pytest

from backend.services import academic_connectors
from backend.services.literature_models import canonical_work


def test_ssrf_validation_rejects_private_dns(monkeypatch):
    monkeypatch.setattr(
        academic_connectors.socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [(2, 1, 6, "", ("127.0.0.1", 443))],
    )
    with pytest.raises(academic_connectors.ConnectorError, match="blocked network"):
        academic_connectors.validate_public_https_url("https://repository.example/oai")


def test_ssrf_validation_rejects_non_https_and_embedded_credentials():
    with pytest.raises(academic_connectors.ConnectorError, match="HTTPS"):
        academic_connectors.validate_public_https_url("http://example.org/oai")
    with pytest.raises(academic_connectors.ConnectorError, match="credentials"):
        academic_connectors.validate_public_https_url("https://user:secret@example.org/oai")


def test_xml_parser_rejects_doctype_and_entities():
    body = b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>'
    with pytest.raises(academic_connectors.ConnectorError, match="unsafe XML"):
        academic_connectors.parse_safe_xml(body)


def test_oai_parser_handles_resumption_tokens_and_tombstones():
    body = b'''<?xml version="1.0"?>
    <OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <ListRecords>
        <record><header status="deleted"><identifier>oai:test:deleted</identifier></header></record>
        <record><header><identifier>oai:test:1</identifier></header><metadata><dc:dc>
          <dc:title>Open research evidence</dc:title><dc:creator>Ada Riu</dc:creator>
          <dc:date>2024</dc:date><dc:identifier>https://doi.org/10.1000/example</dc:identifier>
        </dc:dc></metadata></record>
        <resumptionToken cursor="0" completeListSize="42">next-token</resumptionToken>
      </ListRecords>
    </OAI-PMH>'''
    page = academic_connectors.parse_oai_page(body, {"id": "dialnet-articles"})
    assert page["deleted"] == ["oai:test:deleted"]
    assert page["resumption_token"] == "next-token"
    assert page["complete_list_size"] == 42
    assert page["works"][0]["identifiers"]["doi"] == "10.1000/example"


def test_eric_normalizer_uses_authorized_json_api(monkeypatch):
    payload = {"response": {"docs": [{
        "id": "EJ1", "title": "Education evidence", "author": ["Riu, Ada"],
        "description": "Abstract", "publicationdateyear": 2024,
        "publicationtype": ["Journal Articles"], "language": ["English"],
        "peerreviewed": "T",
    }]}}

    async def fake_get(*_args, **_kwargs):
        return payload, "https://api.ies.ed.gov/eric/", {}

    monkeypatch.setattr(academic_connectors, "safe_get_json", fake_get)
    works = asyncio.run(academic_connectors.search_eric("education", {"peer_reviewed": True}, 1))
    assert works[0]["sources"][0]["provider"] == "eric"
    assert works[0]["year"] == 2024
    assert works[0]["peer_reviewed"] is True


def test_datacite_date_range_uses_supported_query_syntax(monkeypatch):
    seen = {}

    async def fake_get(_url, *, params):
        seen.update(params)
        return {"data": [{"id": "10.1000/example", "attributes": {
            "doi": "10.1000/example", "titles": [{"title": "Open data"}],
            "publicationYear": 2024, "types": {"resourceTypeGeneral": "Dataset"},
            "creators": [], "rightsList": [], "url": "https://doi.org/10.1000/example",
        }}]}, "https://api.datacite.org/dois", {}

    monkeypatch.setattr(academic_connectors, "safe_get_json", fake_get)
    works = asyncio.run(academic_connectors.search_source(
        "datacite", "open data", {"date_from": "2020-01-01", "date_to": "2025-12-31"}, 1,
    ))
    assert seen["query"] == "(open data) AND publicationYear:[2020 TO 2025]"
    assert len(works) == 1


def test_canonical_filters_require_provider_evidence():
    confirmed = canonical_work(
        "doaj-articles", "one", title="Evidence", year=2024, language="eng",
        type="journal-article", peer_reviewed=True, open_access={"is_oa": True},
    )
    unknown = canonical_work(
        "crossref", "two", title="Unknown review status", year=2024, language="en",
        type="journal-article", open_access={"is_oa": True},
    )
    filtered = academic_connectors.filter_works(
        [confirmed, unknown],
        {"date_from": 2020, "language": "en, ca", "type": "journal-article", "open_access": True, "peer_reviewed": True},
    )
    assert [work["id"] for work in filtered] == [confirmed["id"]]


def test_generic_rest_requires_a_list_at_the_mapped_path(monkeypatch):
    async def fake_get(*_args, **_kwargs):
        return {"items": {"not": "a list"}}, "https://repo.example/search", {}

    monkeypatch.setattr(academic_connectors, "validate_public_https_url", lambda value: value)
    monkeypatch.setattr(academic_connectors, "safe_get_json", fake_get)
    with pytest.raises(academic_connectors.ConnectorError, match="JSON list"):
        asyncio.run(academic_connectors.search_generic_json(
            {"id": "custom", "base_url": "https://repo.example/search", "results_path": "items"},
            "test", {}, 10,
        ))


def test_generic_rest_page_pagination_is_bounded(monkeypatch):
    calls = []

    async def fake_get(_url, *, params):
        calls.append(dict(params))
        page = int(params.get("page", 1))
        return {"items": [{"id": f"item-{page}", "title": f"Title {page}"}]}, "https://repo.example/search", {}

    monkeypatch.setattr(academic_connectors, "validate_public_https_url", lambda value: value)
    monkeypatch.setattr(academic_connectors, "safe_get_json", fake_get)
    works = asyncio.run(academic_connectors.search_generic_json({
        "id": "custom", "base_url": "https://repo.example/search", "results_path": "items",
        "pagination": "page", "page_parameter": "page", "mapping": {"id": "id", "title": "title"},
    }, "evidence", {}, 3))
    assert [work["title"] for work in works] == ["Title 1", "Title 2", "Title 3"]
    assert [call["page"] for call in calls] == [1, 2, 3]


def test_request_audit_redacts_academic_api_credentials():
    value = academic_connectors._auditable_url("https://api.openalex.org/works?search=test&api_key=secret")
    assert "secret" not in value
    assert "api_key=%5Bconfigured%5D" in value
    assert "search=test" in value


def test_openalex_search_sends_the_configured_api_key(monkeypatch):
    captured = {}

    async def fake_get(_url, *, params):
        captured.update(params)
        return {"results": []}, "https://api.openalex.org/works", {}

    monkeypatch.setattr(academic_connectors, "safe_get_json", fake_get)
    asyncio.run(academic_connectors.search_openalex("evidence", {}, 10, "configured-key"))
    assert captured["api_key"] == "configured-key"
    assert "mailto" not in captured


def test_semantic_scholar_neighbors_use_supported_ids_and_relation_shape(monkeypatch):
    calls = []

    async def fake_get(url, *, params, headers):
        calls.append((url, params, headers))
        return {"data": [{"citedPaper": {
            "paperId": "neighbor-1", "title": "Cited evidence", "year": 2022,
            "authors": [{"name": "Ada Riu"}], "externalIds": {"DOI": "10.1000/cited"},
            "url": "https://www.semanticscholar.org/paper/neighbor-1", "openAccessPdf": {},
        }}]}, url, {}

    monkeypatch.setattr(academic_connectors, "safe_get_json", fake_get)
    seed = canonical_work("crossref", "seed", title="Seed", identifiers={"doi": "10.1000/seed", "isbn13": [], "provider": {}})
    works = asyncio.run(academic_connectors.semantic_scholar_neighbors([seed], "backward", 5, "api-key"))
    assert calls[0][0].endswith("/paper/DOI%3A10.1000%2Fseed/references")
    assert calls[0][2] == {"x-api-key": "api-key"}
    assert works[0]["title"] == "Cited evidence"
    assert works[0]["identifiers"]["doi"] == "10.1000/cited"


def test_generic_rest_maps_complete_canonical_contract(monkeypatch):
    async def fake_get(*_args, **_kwargs):
        return {"items": [{
            "key": "one", "name": "Evidence", "journal": "Review Journal", "isbn": ["9780306406157"],
            "citations": 7, "oa": True,
        }]}, "https://repo.example/search", {}

    monkeypatch.setattr(academic_connectors, "validate_public_https_url", lambda value: value)
    monkeypatch.setattr(academic_connectors, "safe_get_json", fake_get)
    works = asyncio.run(academic_connectors.search_generic_json({
        "id": "custom", "base_url": "https://repo.example/search", "results_path": "items",
        "mapping": {"provider_id": "key", "title": "name", "container": "journal", "isbn": "isbn", "citations": "citations", "is_oa": "oa"},
    }, "evidence", {}, 1))
    assert works[0]["publication"]["container_title"] == "Review Journal"
    assert works[0]["identifiers"]["isbn13"] == ["9780306406157"]
    assert works[0]["metrics"]["citations"] == {"custom": 7}
