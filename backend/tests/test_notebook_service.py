from pathlib import Path
from types import SimpleNamespace

import pytest
import requests
from fastapi import HTTPException

from backend.services import context_vars, durable_job_queue, notebook_service
from backend.services.workspace_service import WorkspaceContext


@pytest.fixture()
def notebook_env(tmp_path, monkeypatch):
    local_data = tmp_path / "local_data"
    vault = tmp_path / "vault"
    vault.mkdir()
    params = SimpleNamespace(paths={"LOCAL_DATA": local_data, "VAULT": vault})
    monkeypatch.setattr(notebook_service, "load_params", lambda strict_env=False: params)
    monkeypatch.setattr(context_vars, "get_active_vault_path", lambda: vault)
    monkeypatch.setattr(durable_job_queue, "load_params", lambda strict_env=False: params)
    monkeypatch.setattr(notebook_service, "launch_ingest", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(notebook_service, "launch_analysis", lambda *_args, **_kwargs: None)

    attachment = vault / "evidence.txt"
    attachment.write_text("Grounded evidence about deterministic retrieval.", encoding="utf-8")
    table = {
        "id": "references-table",
        "name": "References",
        "properties": [
            {"id": "files-field", "name": "Attachments", "type": "files"},
            {"id": "url-field", "name": "URL", "type": "url"},
            {"id": "notes-field", "name": "Notes", "type": "text"},
        ],
    }
    page = SimpleNamespace(
        id="resource-1",
        title="Resource title metadata",
        last_modified="2026-08-20T10:00:00+00:00",
        metadata={
            "files-field": "evidence.txt",
            "url-field": "",
            "notes-field": "SECRET RECORD METADATA MUST NEVER BE INDEXED",
            "database_table_id": table["id"],
        },
    )
    monkeypatch.setattr(
        notebook_service,
        "_reference_table",
        lambda: (table["id"], table, [page]),
    )
    monkeypatch.setattr(
        notebook_service,
        "_current_resource_snapshot",
        lambda _notebook: (
            table,
            {
                "table_id": table["id"],
                "attachment_property_ids": ["files-field"],
                "url_property_ids": ["url-field"],
                "include_body": False,
            },
            [page],
        ),
    )
    context = WorkspaceContext("workspace-1", "user-1", "owner", vault, ["read", "write"])
    return {
        "context": context,
        "vault": vault,
        "page": page,
        "attachment": attachment,
    }


def _run_queued_ingest(vault: Path):
    job = durable_job_queue.ready_jobs(job_type="notebook_ingest", limit=1)[0]
    worker_id = "test-worker"
    assert durable_job_queue.claim(job["job_id"], worker_id=worker_id)
    result = notebook_service._run_ingest(vault, job["job_id"], worker_id)  # noqa: SLF001
    assert durable_job_queue.complete(job["job_id"], worker_id, result)
    return result


def _write_text_pdf(path: Path, text: str) -> None:
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
    })
    page[NameObject("/Resources")] = DictionaryObject({
        NameObject("/Font"): DictionaryObject({
            NameObject("/F1"): writer._add_object(font),  # noqa: SLF001
        }),
    })
    content = DecodedStreamObject()
    safe_text = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    content.set_data(f"BT /F1 12 Tf 72 720 Td ({safe_text}) Tj ET".encode("latin-1"))
    page[NameObject("/Contents")] = writer._add_object(content)  # noqa: SLF001
    with path.open("wb") as handle:
        writer.write(handle)


def test_notebook_indexes_only_attachment_and_url_fields(notebook_env):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Research notebook",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    result = _run_queued_ingest(notebook_env["vault"])
    assert result["available_sources"] == 1

    detail = notebook_service.get_notebook(notebook["id"], context)
    assert detail["chat_ready"] is True
    assert detail["source_counts"] == {
        "total": 1,
        "available": 1,
        "stale": 0,
        "error": 0,
    }
    hits = notebook_service.search_notebook(notebook["id"], "deterministic retrieval")
    assert hits["revision"] == 1
    assert "Grounded evidence" in hits["results"][0]["text"]
    assert all("SECRET RECORD METADATA" not in item["text"] for item in hits["results"])
    assert hits["results"][0]["citation"]["href"].startswith("gnosi-cite:?")


def test_legacy_attachment_citations_are_upgraded_without_reindexing(notebook_env):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Legacy citations",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    _run_queued_ingest(notebook_env["vault"])
    with notebook_service._connect() as connection:  # noqa: SLF001
        connection.execute(
            "UPDATE notebook_chunks SET citation_href=? WHERE notebook_id=?",
            ("gnosi-cite:?res=resource-1&page=1", notebook["id"]),
        )
        connection.commit()

    hit = notebook_service.search_notebook(
        notebook["id"], "deterministic retrieval"
    )["results"][0]

    assert f"notebook={notebook['id']}" in hit["citation"]["href"]
    assert "revision=1" in hit["citation"]["href"]
    assert f"chunk={hit['chunk_id']}" in hit["citation"]["href"]


def test_notebook_ingests_pdf_and_web_sources_with_navigable_citations(
    notebook_env,
    monkeypatch,
):
    from backend.agent import web_context

    context = notebook_env["context"]
    page = notebook_env["page"]
    pdf_path = notebook_env["vault"] / "evidence.pdf"
    _write_text_pdf(pdf_path, "PDF grounded evidence appears on this page.")
    page.metadata["files-field"] = "evidence.pdf"
    page.metadata["url-field"] = "https://sources.example/article"
    monkeypatch.setattr(web_context, "is_public_http_url", lambda _url: (True, ""))

    def public_html(_url, **_kwargs):
        response = requests.Response()
        response.status_code = 200
        response.headers.update({
            "Content-Type": "text/html; charset=utf-8",
            "ETag": '"web-v1"',
            "Last-Modified": "Wed, 20 Aug 2026 10:00:00 GMT",
        })
        response.encoding = "utf-8"
        response._content = (  # noqa: SLF001
            b"<html><body><h1>Research</h1>"
            b"<p>Web grounded evidence is independently available.</p></body></html>"
        )
        response.iter_content = lambda **_kwargs: iter([response._content])  # noqa: SLF001
        return response

    monkeypatch.setattr(
        notebook_service.llm_wiki_extractors.requests,
        "get",
        public_html,
    )
    notebook = notebook_service.create_notebook(
        context,
        title="PDF and web",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    result = _run_queued_ingest(notebook_env["vault"])

    assert result["available_sources"] == 2
    pdf_hit = notebook_service.search_notebook(notebook["id"], "PDF grounded")["results"][0]
    web_hit = notebook_service.search_notebook(notebook["id"], "Web grounded")["results"][0]
    assert "page=1" in pdf_hit["citation"]["href"]
    assert pdf_hit["citation"]["href"].startswith("gnosi-cite:?")
    assert f"notebook={notebook['id']}" in pdf_hit["citation"]["href"]
    assert "revision=1" in pdf_hit["citation"]["href"]
    assert f"chunk={pdf_hit['chunk_id']}" in pdf_hit["citation"]["href"]
    assert web_hit["citation"]["href"] == "https://sources.example/article"
    inventory = notebook_service.inspect_notebook(notebook["id"])
    source_ids = {item["kind"]: item["source_id"] for item in inventory["sources"]}
    filtered = notebook_service.search_notebook(
        notebook["id"],
        "grounded evidence",
        source_ids=[source_ids["url"]],
    )
    assert filtered["results"]
    assert {item["source_id"] for item in filtered["results"]} == {source_ids["url"]}
    with pytest.raises(KeyError):
        notebook_service.read_notebook_evidence(
            notebook["id"],
            pdf_hit["chunk_id"],
            source_ids=[source_ids["url"]],
        )
    analysis = notebook_service.start_notebook_analysis(
        notebook["id"],
        "Summarize the selected web source",
        revision=1,
        source_ids=[source_ids["url"]],
    )
    analysis_job = durable_job_queue.get(analysis["job_id"])
    assert analysis["source_selection"] == "selected"
    assert analysis_job["payload"]["source_ids"] == [source_ids["url"]]


def test_chat_context_can_pin_selected_sources_and_another_notebook(notebook_env):
    context = notebook_env["context"]
    primary = notebook_service.create_notebook(
        context,
        title="Primary",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    _run_queued_ingest(notebook_env["vault"])
    secondary = notebook_service.create_notebook(
        context,
        title="Secondary",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    _run_queued_ingest(notebook_env["vault"])
    result = notebook_service.resolve_chat_contexts(
        primary["id"],
        [
            {"ref": primary["id"], "scope": {"selection": "sources", "source_ids": []}},
            {"ref": secondary["id"], "scope": {"selection": "all"}},
        ],
        context,
        schedule_refresh=False,
    )

    assert result["notebook_id"] == primary["id"]
    assert [item["ref"] for item in result["contexts"]] == [primary["id"], secondary["id"]]
    assert result["contexts"][0]["scope"]["source_ids"] == []
    assert result["contexts"][1]["scope"]["selection"] == "all"
    assert all(item["scope"]["revision"] == 1 for item in result["contexts"])
    options = notebook_service.list_chat_source_options(primary["id"], context)
    assert len(options["sources"]) == 1
    assert [(item["id"], item["source_count"]) for item in options["notebooks"]] == [
        (secondary["id"], 1),
    ]


def test_attachment_change_triggers_automatic_incremental_refresh(notebook_env):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Automatic refresh",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    _run_queued_ingest(notebook_env["vault"])
    notebook_env["attachment"].write_text(
        "Updated attachment evidence after editing the source.",
        encoding="utf-8",
    )

    queued = notebook_service.request_refresh(
        notebook["id"], context, reason="open", force=False
    )
    assert queued["state"] == "queued"
    refreshed = _run_queued_ingest(notebook_env["vault"])

    assert refreshed["revision"] == 2
    hits = notebook_service.search_notebook(notebook["id"], "Updated attachment")
    assert "Updated attachment evidence" in hits["results"][0]["text"]


def test_notebook_ingests_ocr_and_preserves_large_chunks(notebook_env, monkeypatch):
    context = notebook_env["context"]
    page = notebook_env["page"]
    image = notebook_env["vault"] / "scan.png"
    image.write_bytes(b"fixture image bytes")
    large_text = notebook_env["vault"] / "large.txt"
    large_text.write_text("Large grounded paragraph " * 1_200, encoding="utf-8")
    page.metadata["files-field"] = ["scan.png", "large.txt"]
    monkeypatch.setattr(
        notebook_service.llm_wiki_extractors,
        "_run_tesseract",
        lambda _path: "OCR grounded evidence from a scanned source.",
    )
    notebook = notebook_service.create_notebook(
        context,
        title="OCR and large chunks",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    _run_queued_ingest(notebook_env["vault"])

    assert notebook_service.search_notebook(notebook["id"], "OCR grounded")["results"]
    with notebook_service._connect() as connection:  # noqa: SLF001
        chunks = connection.execute(
            "SELECT text FROM notebook_chunks WHERE notebook_id=? ORDER BY ordinal",
            (notebook["id"],),
        ).fetchall()
    large_chunks = [row["text"] for row in chunks if "Large grounded paragraph" in row["text"]]
    assert len(large_chunks) >= 2
    assert sum(len(text) for text in large_chunks) == len("Large grounded paragraph " * 1_200) - 1


def test_removing_resource_excludes_active_revision_immediately(notebook_env):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Removal",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    _run_queued_ingest(notebook_env["vault"])
    assert notebook_service.search_notebook(notebook["id"], "evidence")["results"]

    notebook_service.remove_resource(notebook["id"], context, "resource-1")
    assert notebook_service.search_notebook(notebook["id"], "evidence")["results"] == []
    assert notebook_env["attachment"].exists()


def test_incremental_refresh_reuses_unchanged_attachment(notebook_env, monkeypatch):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Incremental",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    _run_queued_ingest(notebook_env["vault"])
    monkeypatch.setattr(
        notebook_service.llm_wiki_extractors,
        "extract_resource_sources",
        lambda *_args, **_kwargs: pytest.fail("Unchanged attachment was re-extracted"),
    )
    notebook_service.request_refresh(
        notebook["id"], context, reason="test", force=True
    )
    result = _run_queued_ingest(notebook_env["vault"])
    assert result["revision"] == 1
    assert result["unchanged"] is True
    assert notebook_service.get_notebook(notebook["id"], context)["active_revision"] == 1


def test_failed_refresh_keeps_last_valid_source_as_stale(notebook_env, monkeypatch):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Stale fallback",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    _run_queued_ingest(notebook_env["vault"])
    table, source_config, _pages = notebook_service._current_resource_snapshot(  # noqa: SLF001
        notebook
    )
    monkeypatch.setattr(
        notebook_service,
        "_current_resource_snapshot",
        lambda _notebook: (table, source_config, []),
    )

    notebook_service.request_refresh(notebook["id"], context, reason="test", force=True)
    result = _run_queued_ingest(notebook_env["vault"])

    assert result["revision"] == 2
    detail = notebook_service.get_notebook(notebook["id"], context)
    assert detail["active_revision"] == 2
    assert detail["source_counts"]["stale"] == 1
    assert notebook_service.search_notebook(notebook["id"], "deterministic")["results"]


def test_three_hundred_resources_are_paged_with_multiple_sources(notebook_env, monkeypatch):
    context = notebook_env["context"]
    table, _source_config, _pages = notebook_service._current_resource_snapshot(  # noqa: SLF001
        {"source_table_id": "references-table"}
    )
    pages = [
        SimpleNamespace(
            id=f"resource-{index}",
            title=f"Resource {index:03d}",
            last_modified="2026-08-20T10:00:00+00:00",
            metadata={
                "files-field": ["evidence.txt", "second.pdf"],
                "url-field": f"https://example.org/{index}",
                "notes-field": "Excluded metadata",
                "database_table_id": table["id"],
            },
        )
        for index in range(300)
    ]
    monkeypatch.setattr(
        notebook_service,
        "_reference_table",
        lambda: (table["id"], table, pages),
    )

    selector_page = notebook_service.list_reference_resources(
        context, page=2, page_size=125
    )
    assert selector_page["total"] == 300
    assert len(selector_page["items"]) == 125
    assert selector_page["items"][0]["source_count"] == 3

    notebook = notebook_service.create_notebook(
        context,
        title="Load boundary",
        visibility="workspace",
        conversation_mode="shared",
        resource_ids=[page.id for page in pages],
    )
    assert notebook_service.get_notebook(notebook["id"], context)["resource_count"] == 300


def test_three_hundred_resources_complete_one_bounded_ingestion_job(
    notebook_env,
    monkeypatch,
):
    context = notebook_env["context"]
    table, source_config, _pages = notebook_service._current_resource_snapshot(  # noqa: SLF001
        {"source_table_id": "references-table"}
    )
    pages = [
        SimpleNamespace(
            id=f"resource-{index}",
            title=f"Resource {index:03d}",
            last_modified="2026-08-20T10:00:00+00:00",
            metadata={
                "files-field": "evidence.txt",
                "url-field": f"https://example.org/{index}",
                "resource_marker": str(index),
            },
        )
        for index in range(300)
    ]
    monkeypatch.setattr(
        notebook_service,
        "_reference_table",
        lambda: (table["id"], table, pages),
    )
    monkeypatch.setattr(
        notebook_service,
        "_current_resource_snapshot",
        lambda _notebook: (table, source_config, pages),
    )

    def cheap_sources(metadata, *_args, **_kwargs):
        marker = metadata["resource_marker"]
        attachment = notebook_service.llm_wiki_extractors._finalize_origin({  # noqa: SLF001
            "kind": "text",
            "label": "evidence.txt",
            "source_url": "",
            "input_order": 0,
            "segments": [{"text": f"Attachment evidence {marker}", "locator": {"line_start": 1}}],
        })
        web = notebook_service.llm_wiki_extractors._finalize_origin({  # noqa: SLF001
            "kind": "url",
            "label": f"Web {marker}",
            "source_url": f"https://example.org/{marker}",
            "input_order": 1,
            "segments": [{"text": f"Web evidence {marker}", "locator": {"paragraph": 1}}],
        })
        web.update({
            "requested_url": f"https://example.org/{marker}",
            "http_final_url": f"https://example.org/{marker}",
            "http_etag": f'"{marker}"',
            "http_last_modified": "",
            "http_content_hash": f"raw-{marker}",
            "http_checked_at": notebook_service._now(),  # noqa: SLF001
        })
        return [attachment, web], []

    monkeypatch.setattr(
        notebook_service.llm_wiki_extractors,
        "extract_resource_sources",
        cheap_sources,
    )
    heartbeat_calls = []
    original_heartbeat = durable_job_queue.heartbeat

    def heartbeat(*args, **kwargs):
        heartbeat_calls.append(args[0])
        return original_heartbeat(*args, **kwargs)

    monkeypatch.setattr(durable_job_queue, "heartbeat", heartbeat)
    notebook = notebook_service.create_notebook(
        context,
        title="Real 300 Resource ingestion",
        visibility="workspace",
        conversation_mode="shared",
        resource_ids=[page.id for page in pages],
    )
    result = _run_queued_ingest(notebook_env["vault"])

    assert result["available_sources"] == 600
    assert len(heartbeat_calls) == 30
    assert notebook_service.get_notebook(notebook["id"], context)["active_revision"] == 1


def test_expired_notebook_ingestion_lease_is_recovered_after_restart(notebook_env):
    context = notebook_env["context"]
    notebook_service.create_notebook(
        context,
        title="Restart recovery",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    job = durable_job_queue.ready_jobs(job_type="notebook_ingest", limit=1)[0]
    assert durable_job_queue.claim(job["job_id"], worker_id="stopped-worker", lease_seconds=10)
    with durable_job_queue._connect() as connection:  # noqa: SLF001
        connection.execute(
            "UPDATE agent_jobs SET lease_until=? WHERE job_id=?",
            ("2000-01-01T00:00:00+00:00", job["job_id"]),
        )

    assert durable_job_queue.reconcile_expired() == 1
    recovered = durable_job_queue.ready_jobs(job_type="notebook_ingest", limit=1)
    assert [item["job_id"] for item in recovered] == [job["job_id"]]


def test_resource_selector_sorts_before_paging_and_filters_schema_facets(notebook_env, monkeypatch):
    context = notebook_env["context"]
    table = {
        "id": "references-table",
        "name": "References",
        "properties": [
            {"id": "files", "name": "Attachments", "type": "files"},
            {"id": "kind", "name": "Item Type", "type": "select"},
            {"id": "authors", "name": "Autoría", "type": "autoria"},
            {
                "id": "tags",
                "name": "Etiquetes",
                "type": "multi_select",
                "config": {"role": "tags"},
            },
        ],
    }
    pages = [
        SimpleNamespace(
            id="zebra",
            title="Zebra",
            last_modified="2026-08-20T10:00:00+00:00",
            metadata={
                "files": "evidence.txt",
                "kind": "Book",
                "authors": [{"nom": "Grace", "cognom1": "Hopper", "cognom2": ""}],
                "tags": ["Computing"],
            },
        ),
        SimpleNamespace(
            id="alpha",
            title="Àlpha",
            last_modified="2026-08-20T10:00:00+00:00",
            metadata={
                "files": "evidence.txt",
                "kind": "Course",
                "authors": [{"nom": "Ada", "cognom1": "Lovelace", "cognom2": ""}],
                "tags": ["Education", "Computing"],
            },
        ),
        SimpleNamespace(
            id="beta",
            title="beta",
            last_modified="2026-08-20T10:00:00+00:00",
            metadata={
                "files": "evidence.txt",
                "kind": "Book",
                "authors": [{"nom": "Ada", "cognom1": "Lovelace", "cognom2": ""}],
                "tags": ["History"],
            },
        ),
        SimpleNamespace(
            id="course-template",
            title="Course template",
            last_modified="2026-08-20T10:00:00+00:00",
            metadata={
                "is_template": True,
                "files": "evidence.txt",
                "kind": "Course",
                "authors": [
                    {"nom": "Template", "cognom1": "Author", "cognom2": ""}
                ],
                "tags": ["Education"],
            },
        ),
    ]
    monkeypatch.setattr(
        notebook_service,
        "_reference_table",
        lambda: (table["id"], table, pages),
    )

    first_page = notebook_service.list_reference_resources(context, page=1, page_size=2)

    assert first_page["total"] == 3
    assert [item["title"] for item in first_page["items"]] == ["Àlpha", "beta"]
    assert first_page["facets"]["types"] == [
        {"value": "Book", "count": 2},
        {"value": "Course", "count": 1},
    ]
    assert first_page["facets"]["authors"] == [
        {"value": "Ada Lovelace", "count": 2},
        {"value": "Grace Hopper", "count": 1},
    ]
    assert first_page["facets"]["tags"] == [
        {"value": "Computing", "count": 2},
        {"value": "Education", "count": 1},
        {"value": "History", "count": 1},
    ]
    assert "metadata" not in first_page["items"][0]

    filtered = notebook_service.list_reference_resources(
        context,
        resource_type="Course",
        author="Ada Lovelace",
        tag="Computing",
    )

    assert filtered["total"] == 1
    assert [item["id"] for item in filtered["items"]] == ["alpha"]

    with pytest.raises(HTTPException, match="do not belong"):
        notebook_service._validate_current_resources(["course-template"])  # noqa: SLF001


def test_resource_selector_hides_records_without_attachment_or_url_sources(
    notebook_env,
    monkeypatch,
):
    context = notebook_env["context"]
    table, _source_config, _pages = notebook_service._current_resource_snapshot(  # noqa: SLF001
        {"source_table_id": "references-table"}
    )
    pages = [
        SimpleNamespace(
            id="with-source",
            title="Available source",
            last_modified="2026-08-20T10:00:00+00:00",
            metadata={"files-field": "evidence.txt", "url-field": ""},
        ),
        SimpleNamespace(
            id="without-source",
            title="Empty record",
            last_modified="2026-08-20T10:00:00+00:00",
            metadata={"files-field": "", "url-field": "", "notes-field": "Metadata only"},
        ),
    ]
    monkeypatch.setattr(
        notebook_service,
        "_reference_table",
        lambda: (table["id"], table, pages),
    )

    selector = notebook_service.list_reference_resources(context)

    assert selector["total"] == 1
    assert selector["hidden_without_sources"] == 1
    assert [item["id"] for item in selector["items"]] == ["with-source"]
    with pytest.raises(HTTPException, match="no attachment or URL sources"):
        notebook_service._validate_current_resources(["without-source"])  # noqa: SLF001


def test_url_refresh_uses_validators_and_keeps_revision_when_content_is_unchanged(
    notebook_env,
    monkeypatch,
):
    context = notebook_env["context"]
    page = notebook_env["page"]
    page.metadata["files-field"] = ""
    page.metadata["url-field"] = "https://example.org/article"
    version = {"value": 1}
    extraction_calls = []

    def extract_sources(*_args, **_kwargs):
        extraction_calls.append(version["value"])
        text = f"Grounded web evidence version {version['value']}."
        origin = notebook_service.llm_wiki_extractors._finalize_origin({  # noqa: SLF001
            "kind": "url",
            "label": "Example article",
            "source_url": "https://example.org/article",
            "input_order": 0,
            "segments": [{"text": text, "locator": {"paragraph": 1}}],
        })
        origin.update({
            "requested_url": "https://example.org/article",
            "http_final_url": "https://example.org/article",
            "http_etag": f'"v{version["value"]}"',
            "http_last_modified": "Wed, 20 Aug 2026 10:00:00 GMT",
            "http_content_hash": f"raw-v{version['value']}",
            "http_checked_at": notebook_service._now(),  # noqa: SLF001
        })
        return [origin], []

    monkeypatch.setattr(
        notebook_service.llm_wiki_extractors,
        "extract_resource_sources",
        extract_sources,
    )
    notebook = notebook_service.create_notebook(
        context,
        title="Conditional URL",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    _run_queued_ingest(notebook_env["vault"])

    assert notebook_service.request_refresh(
        notebook["id"], context, reason="question", force=False
    )["state"] == "current"
    probe_calls = []

    def unchanged_probe(url, *, etag, last_modified, content_hash):
        probe_calls.append((url, etag, last_modified, content_hash))
        return {
            "changed": False,
            "final_url": url,
            "etag": etag,
            "last_modified": last_modified,
            "content_hash": content_hash,
            "checked_at": notebook_service._now(),  # noqa: SLF001
        }

    monkeypatch.setattr(
        notebook_service.llm_wiki_extractors,
        "probe_public_url",
        unchanged_probe,
    )
    notebook_service.request_refresh(
        notebook["id"], context, reason="manual", force=True
    )
    unchanged = _run_queued_ingest(notebook_env["vault"])

    assert unchanged["unchanged"] is True
    assert unchanged["revision"] == 1
    assert extraction_calls == [1]
    assert probe_calls == [(
        "https://example.org/article",
        '"v1"',
        "Wed, 20 Aug 2026 10:00:00 GMT",
        "raw-v1",
    )]

    version["value"] = 2
    monkeypatch.setattr(
        notebook_service.llm_wiki_extractors,
        "probe_public_url",
        lambda url, **_kwargs: {
            "changed": True,
            "final_url": url,
            "etag": '"v2"',
            "last_modified": "Thu, 21 Aug 2026 10:00:00 GMT",
            "content_hash": "raw-v2",
            "checked_at": notebook_service._now(),  # noqa: SLF001
        },
    )
    notebook_service.request_refresh(
        notebook["id"], context, reason="manual", force=True
    )
    changed = _run_queued_ingest(notebook_env["vault"])

    assert changed["unchanged"] is False
    assert changed["revision"] == 3
    hits = notebook_service.search_notebook(notebook["id"], "version 2")
    assert "version 2" in hits["results"][0]["text"]


def test_targeted_resource_retry_reextracts_only_the_selected_resource(
    notebook_env,
    monkeypatch,
):
    context = notebook_env["context"]
    table, source_config, _pages = notebook_service._current_resource_snapshot(  # noqa: SLF001
        {"source_table_id": "references-table"}
    )
    second_attachment = notebook_env["vault"] / "second.txt"
    second_attachment.write_text("Second Resource evidence.", encoding="utf-8")
    second_page = SimpleNamespace(
        id="resource-2",
        title="Second Resource",
        last_modified="2026-08-20T10:00:00+00:00",
        metadata={"files-field": "second.txt", "url-field": "", "notes-field": ""},
    )
    pages = [notebook_env["page"], second_page]
    monkeypatch.setattr(
        notebook_service,
        "_reference_table",
        lambda: (table["id"], table, pages),
    )
    monkeypatch.setattr(
        notebook_service,
        "_current_resource_snapshot",
        lambda _notebook: (table, source_config, pages),
    )
    notebook = notebook_service.create_notebook(
        context,
        title="Targeted retry",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1", "resource-2"],
    )
    _run_queued_ingest(notebook_env["vault"])

    original_extract = notebook_service.llm_wiki_extractors.extract_resource_sources
    extracted = []
    progress_resources = []

    def tracked_extract(metadata, *args, **kwargs):
        extracted.append(metadata["files-field"])
        progress_resources.append(
            notebook_service.get_notebook(notebook["id"], context)["progress"][
                "current_resource_title"
            ]
        )
        return original_extract(metadata, *args, **kwargs)

    monkeypatch.setattr(
        notebook_service.llm_wiki_extractors,
        "extract_resource_sources",
        tracked_extract,
    )
    notebook_env["attachment"].write_text(
        "Retried Resource evidence with changed content.", encoding="utf-8"
    )
    notebook_service.request_refresh(
        notebook["id"],
        context,
        reason="resource_retry",
        force=True,
        resource_ids=["resource-1"],
    )
    result = _run_queued_ingest(notebook_env["vault"])

    assert result["revision"] == 2
    assert extracted == ["evidence.txt"]
    assert progress_resources == ["Resource title metadata"]
    source_detail = notebook_service.list_notebook_sources(notebook["id"], context)
    assert source_detail["items"][0]["last_checked_at"]
    assert notebook_service.search_notebook(
        notebook["id"], "Second Resource evidence"
    )["results"]


def test_cancel_refresh_stops_a_queued_ingestion_and_exposes_diagnostics(notebook_env):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Cancellation diagnostics",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    queued = durable_job_queue.ready_jobs(job_type="notebook_ingest", limit=1)[0]

    detail = notebook_service.cancel_refresh(notebook["id"], context)

    assert durable_job_queue.get(queued["job_id"])["state"] == "cancelled"
    assert detail["status"] == "error"
    assert detail["progress"]["state"] == "cancelled"
    assert detail["progress"]["cancellable"] is False
    assert "cancelled" in detail["last_error"].lower()


def test_streaming_refresh_uses_metadata_fingerprint_without_reextracting(
    notebook_env,
    monkeypatch,
):
    context = notebook_env["context"]
    page = notebook_env["page"]
    page.metadata["files-field"] = ""
    page.metadata["url-field"] = "https://www.youtube.com/watch?v=stable"
    extraction_calls = []

    def extract_sources(*_args, **_kwargs):
        extraction_calls.append(True)
        origin = notebook_service.llm_wiki_extractors._finalize_origin({  # noqa: SLF001
            "kind": "stream",
            "label": "Stable lecture",
            "source_url": page.metadata["url-field"],
            "input_order": 0,
            "segments": [{"text": "Stable streaming evidence.", "locator": {"start": 0}}],
        })
        origin.update({
            "requested_url": page.metadata["url-field"],
            "http_final_url": page.metadata["url-field"],
            "http_content_hash": origin["content_hash"],
            "http_stream_fingerprint": "stream-v1",
            "http_checked_at": notebook_service._now(),  # noqa: SLF001
        })
        return [origin], []

    monkeypatch.setattr(
        notebook_service.llm_wiki_extractors,
        "extract_resource_sources",
        extract_sources,
    )
    notebook = notebook_service.create_notebook(
        context,
        title="Streaming fingerprint",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    _run_queued_ingest(notebook_env["vault"])
    probes = []

    def stable_probe(url, *, fingerprint):
        probes.append((url, fingerprint))
        return {
            "changed": False,
            "final_url": url,
            "stream_fingerprint": fingerprint,
            "checked_at": notebook_service._now(),  # noqa: SLF001
        }

    monkeypatch.setattr(
        notebook_service.llm_wiki_extractors,
        "probe_streaming_url",
        stable_probe,
    )
    notebook_service.request_refresh(
        notebook["id"], context, reason="manual", force=True
    )
    result = _run_queued_ingest(notebook_env["vault"])

    assert result["unchanged"] is True
    assert extraction_calls == [True]
    assert probes == [(page.metadata["url-field"], "stream-v1")]


def test_revision_retention_preserves_pinned_conversation_evidence(
    notebook_env,
    monkeypatch,
):
    monkeypatch.setenv("GNOSI_NOTEBOOK_COMPLETED_REVISION_RETENTION", "1")
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Revision retention",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    _run_queued_ingest(notebook_env["vault"])
    notebook_service.resolve_chat_context(
        notebook["id"], context, schedule_refresh=False
    )

    for revision in range(2, 5):
        notebook_env["attachment"].write_text(
            f"Revision {revision} evidence with {'more ' * revision}content.",
            encoding="utf-8",
        )
        notebook_service.request_refresh(
            notebook["id"], context, reason="test", force=True
        )
        _run_queued_ingest(notebook_env["vault"])

    with notebook_service._connect() as connection:  # noqa: SLF001
        revisions = [
            int(row[0])
            for row in connection.execute(
                "SELECT revision FROM notebook_revisions WHERE notebook_id=? ORDER BY revision",
                (notebook["id"],),
            ).fetchall()
        ]
        stale_fts = int(
            connection.execute(
                """SELECT COUNT(*) FROM notebook_chunks_fts WHERE notebook_id=?
                AND revision IN (2,3)""",
                (notebook["id"],),
            ).fetchone()[0]
        )

    assert revisions == [1, 4]
    assert stale_fts == 0
    assert notebook_service.search_notebook(
        notebook["id"], "deterministic retrieval", revision=1
    )["results"]


def test_resource_selector_excludes_items_already_in_notebook(notebook_env):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Selector exclusion",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )

    selector = notebook_service.list_reference_resources(
        context,
        page=1,
        page_size=50,
        exclude_notebook_id=notebook["id"],
    )

    assert selector["total"] == 0
    assert selector["items"] == []


def test_private_and_workspace_permissions_are_isolated(notebook_env):
    owner = notebook_env["context"]
    private_notebook = notebook_service.create_notebook(
        owner,
        title="Private",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    other = WorkspaceContext(
        owner.workspace_id,
        "user-2",
        "editor",
        owner.vault_path,
        ["read", "write"],
    )
    with pytest.raises(HTTPException) as private_error:
        notebook_service.authorize(private_notebook["id"], other)
    assert private_error.value.status_code == 404

    notebook_service.update_notebook(
        private_notebook["id"], owner, visibility="workspace"
    )
    assert notebook_service.authorize(private_notebook["id"], other)["id"] == private_notebook["id"]
    with pytest.raises(HTTPException) as manage_error:
        notebook_service.authorize(private_notebook["id"], other, action="manage")
    assert manage_error.value.status_code == 403
    viewer = WorkspaceContext(
        owner.workspace_id,
        "user-3",
        "viewer",
        owner.vault_path,
        ["read"],
    )
    viewer_detail = notebook_service.get_notebook(
        private_notebook["id"],
        viewer,
        schedule_refresh=False,
    )
    assert viewer_detail["can_chat"] is False
    assert viewer_detail["can_manage"] is False


def test_conversation_modes_keep_distinct_checkpoint_principals(notebook_env):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Conversation modes",
        visibility="workspace",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    private_principal = notebook_service.conversation_principal(notebook, "user-1")
    assert private_principal.endswith(":member:user-1")
    shared = notebook_service.update_notebook(
        notebook["id"], context, conversation_mode="shared"
    )
    shared_principal = notebook_service.conversation_principal(shared, "user-1")
    assert shared_principal.endswith(":shared")
    assert shared_principal != private_principal

    notebook_service.register_conversation_principal(notebook, "user-1")
    notebook_service.register_conversation_principal(shared, "user-2")
    scopes = notebook_service.conversation_scopes(notebook["id"], context)
    assert {item["principal_id"] for item in scopes} == {
        private_principal,
        shared_principal,
    }


def test_whole_notebook_analysis_is_durable_and_revision_pinned(notebook_env, monkeypatch):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Whole notebook",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    _run_queued_ingest(notebook_env["vault"])
    monkeypatch.setattr(
        notebook_service,
        "_model_analysis",
        lambda prompt, request: f"Summary for {request}: {len(prompt)} chars",
    )
    started = notebook_service.start_notebook_analysis(
        notebook["id"],
        "Compare every source",
        revision=1,
    )
    assert started["state"] == "queued"
    job = durable_job_queue.ready_jobs(job_type="notebook_analysis", limit=1)[0]
    worker_id = "analysis-worker"
    assert durable_job_queue.claim(job["job_id"], worker_id=worker_id)
    result = notebook_service._run_analysis(  # noqa: SLF001
        notebook_env["vault"], job["job_id"], worker_id
    )
    assert durable_job_queue.complete(job["job_id"], worker_id, result)
    completed = notebook_service.get_notebook_analysis(
        notebook["id"], started["analysis_id"], revision=1, include_result=True
    )
    assert completed["state"] == "completed"
    assert completed["result"]["revision"] == 1
    assert completed["result"]["chunk_ids"]


def test_notebook_custom_groups_persistence_and_update(notebook_env):
    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Grouped notebook",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )
    assert notebook.get("groups") == []

    updated = notebook_service.update_notebook(
        notebook["id"],
        context,
        groups=[
            {"id": "grp-1", "name": "Primary sources", "resource_ids": ["resource-1"]},
            {"id": "grp-2", "name": "Background", "resource_ids": []},
        ],
    )
    assert len(updated.get("groups", [])) == 2
    assert updated["groups"][0]["name"] == "Primary sources"
    assert updated["groups"][0]["resource_ids"] == ["resource-1"]
    assert updated["groups"][1]["name"] == "Background"

    fetched = notebook_service.get_notebook(notebook["id"], context)
    assert len(fetched.get("groups", [])) == 2
    assert fetched["groups"][0]["name"] == "Primary sources"


def test_notebook_patch_request_model_and_service_with_groups(notebook_env):
    from backend.api.notebook_routes import NotebookPatchRequest

    payload = NotebookPatchRequest.model_validate({
        "groups": [
            {"id": "grp-1", "name": "Created group", "resource_ids": ["resource-1"]}
        ]
    })
    assert payload.groups == [{"id": "grp-1", "name": "Created group", "resource_ids": ["resource-1"]}]

    context = notebook_env["context"]
    notebook = notebook_service.create_notebook(
        context,
        title="Route patch notebook",
        visibility="private",
        conversation_mode="private_member",
        resource_ids=["resource-1"],
    )

    updated = notebook_service.update_notebook(
        notebook["id"],
        context,
        groups=payload.groups,
    )
    assert len(updated.get("groups", [])) == 1
    assert updated["groups"][0]["name"] == "Created group"
    assert updated["groups"][0]["resource_ids"] == ["resource-1"]



