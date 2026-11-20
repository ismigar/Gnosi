"""Synthetic native-provider reads at the note and file entry points."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, FastAPI
from fastapi.testclient import TestClient

from backend.api import vault_routes
from backend.domains.vault.api import pages_queries
from backend.domains.vault.assets import api as assets_api
from backend.domains.vault.files import api as files_api, local_service, serving, thumbnails
from backend.domains.vault.files.state import LocalLinkStore
from backend.domains.vault.history.repository import HistoryRepository
from backend.domains.vault.pages import (
    foundation,
    index_service,
    patch_helpers,
    preview_routes,
    save_helpers,
    save_service,
)
from backend.domains.vault.schemas.pages import PageInfo, PageSaveRequest
from backend.platform.files import snapshots
from backend.services.context_vars import active_vault_path
from backend.utils import metadata_io


@pytest.fixture
def cloud(tmp_path, monkeypatch):
    vault = tmp_path / "Vault"
    vault.mkdir()
    contents: dict[Path, bytes] = {}
    reads: list[Path] = []
    copies: list[Path] = []

    def managed(path, _stat=None, **_kwargs):
        return path in contents

    async def copy(path, destination, timeout):
        reads.append(path)
        copies.append(Path(destination.name))
        payload = contents[path]
        destination.write(payload)
        return path.stat()

    for module in (metadata_io, pages_queries, serving, thumbnails, local_service, preview_routes):
        monkeypatch.setattr(module, "is_native_vault_file", managed)
    monkeypatch.setattr(snapshots, "copy_coordinated", copy)
    monkeypatch.setattr(vault_routes, "get_active_vault_path", lambda: vault)

    def source(relative: str, payload: bytes) -> Path:
        path = vault / relative
        path.parent.mkdir(exist_ok=True, parents=True)
        path.write_bytes(b"!" * len(payload))
        contents[path] = payload
        return path

    token = active_vault_path.set(vault)
    try:
        yield SimpleNamespace(vault=vault, source=source, reads=reads, copies=copies)
    finally:
        active_vault_path.reset(token)


@pytest.mark.parametrize("group", ["raw", "assets", "images", "library", "linked"])
def test_selected_files_stream_first_range_from_coordinated_bytes(cloud, monkeypatch, group):
    folders = {
        "raw": "Wiki",
        "assets": "Assets",
        "images": "Images",
        "library": "Library",
        "linked": "Links",
    }
    path = cloud.source(f"{folders[group]}/test.png", b"0123456789")
    monkeypatch.setattr(
        vault_routes,
        "get_p",
        lambda name: cloud.vault / "Assets" if name == "ASSETS" else cloud.vault,
    )
    monkeypatch.setattr(vault_routes, "_library_roots", lambda _vault: [cloud.vault / "Library"])
    links = LocalLinkStore(lambda: cloud.vault / ".test")
    token = links.token_for(str(path))
    deps = files_api._deps()
    monkeypatch.setattr(
        files_api,
        "_dependencies",
        replace(deps, local_files=replace(deps.local_files, store=links)),
    )
    app = FastAPI()
    endpoints = {
        "raw": ("/{rel_path:path}", files_api.serve_vault_raw_file, "/Wiki/test.png"),
        "assets": ("/{asset_path:path}", assets_api.get_asset, "/test.png"),
        "images": ("/{image_path:path}", assets_api.serve_vault_image, "/test.png"),
        "library": ("/{rel_path:path}", files_api.serve_library_file, "/test.png"),
        "linked": ("/{token}", files_api.serve_local_file, f"/{token}"),
    }
    route, endpoint, url = endpoints[group]
    app.add_api_route(route, endpoint, methods=["GET"], response_model=None)
    with TestClient(app) as client:
        first = client.get(url, headers={"Range": "bytes=2-5"})
        assert first.status_code == 206 and first.content == b"2345"
        assert first.headers["Content-Range"] == "bytes 2-5/10"
        assert first.headers["Content-Type"] == "image/png"
        if group != "linked":
            assert first.headers["Cache-Control"] == "public, max-age=300"
        tag = first.headers["ETag"]
        second = client.get(url, headers={"Range": "bytes=8-", "If-Range": tag})
        assert second.status_code == 206 and second.content == b"89"
        stale = client.get(url, headers={"Range": "bytes=8-", "If-Range": '"old"'})
        assert stale.status_code == 200 and stale.content == b"0123456789"
        unsatisfied = client.get(url, headers={"Range": "bytes=99-"})
        assert unsatisfied.status_code == 416
    assert cloud.reads == [path] * 4
    assert all(not copy.exists() for copy in cloud.copies)


def test_disconnected_file_response_releases_its_copy(cloud):
    path = cloud.source("media.wav", b"audio")

    async def scenario():
        response = await serving.serve_snapshot(path, cloud.vault)

        async def disconnect(message):
            if message["type"] == "http.response.body":
                raise asyncio.CancelledError
            assert message["type"] == "http.response.start"

        async def receive():
            return {"type": "http.disconnect"}

        scope = {
            "type": "http",
            "method": "GET",
            "headers": [],
            "extensions": {"http.response.pathsend": {}},
        }
        with pytest.raises(asyncio.CancelledError):
            await response(scope, receive, disconnect)
        assert not Path(response.path).exists()

    asyncio.run(scenario())


def test_native_thumbnail_keeps_selected_snapshot_and_original_validators(cloud, monkeypatch):
    path = cloud.source("Assets/article.pdf", b"synthetic pdf")
    deps = replace(files_api._deps().thumbnails, get_path=lambda _name: cloud.vault)

    async def render(source, size, _timeout):
        assert source != path and source.name == "article.pdf" and size == 128
        assert source.read_bytes() == b"synthetic pdf"
        return b"thumbnail"

    monkeypatch.setattr(thumbnails, "_render_native_thumbnail", render)
    response = asyncio.run(thumbnails.serve_thumb("assets/article.pdf", 128, "revision", deps))
    assert response.body == b"thumbnail"
    assert response.headers["Cache-Control"] == "public, max-age=86400, immutable"
    assert response.headers["ETag"] == f'W/"{int(path.stat().st_mtime)}-128"'
    assert cloud.reads == [path] and not cloud.copies[0].exists()


def test_agent_note_and_pdf_read_the_coordinated_source_within_vault(cloud, monkeypatch):
    import pypdf
    from backend.agent import vault_tools

    note = cloud.source("Wiki/note.md", b"native note")
    pdf = cloud.source("Assets/report.pdf", b"native PDF")
    monkeypatch.setattr(vault_tools, "_resolve_page_path", lambda _id: note)

    def reader(source):
        assert source.read() == b"native PDF"
        return SimpleNamespace(pages=[SimpleNamespace(extract_text=lambda: "PDF contents")])

    monkeypatch.setattr(pypdf, "PdfReader", reader)
    assert vault_tools.read_page.func("note") == "native note"
    assert vault_tools.read_pdf.func("Assets/report.pdf", 4) == "PDF "
    assert vault_tools.read_pdf.func("../elsewhere.pdf").startswith("Access denied")
    assert cloud.reads == [note, pdf]


def test_open_preview_and_save_reads_use_authorized_source(cloud, monkeypatch):
    note = cloud.source("Wiki/note.md", b"# coordinated body")

    def parse(raw, path, **_kwargs):
        assert path == note
        return {"id": "note", "title": "A note"}, raw

    async def unexpected_materialize(*_args):
        pytest.fail("The selected native note was warmed separately")

    deps = replace(
        pages_queries._deps(),
        find_page=lambda _id: note,
        active_vault_path=lambda: cloud.vault,
        materialize_page=unexpected_materialize,
        is_dashboard=lambda _: False,
        parse_frontmatter=parse,
        resolve_title=None,
        enrich_single_page=lambda metadata, *_: (metadata, "Wiki", None),
    )
    monkeypatch.setattr(pages_queries, "_dependencies", deps)
    monkeypatch.setattr(vault_routes, "_is_dashboard_file_path", lambda _: False)
    monkeypatch.setattr(vault_routes, "_materialize_if_online_only", unexpected_materialize)
    monkeypatch.setattr(vault_routes, "parse_frontmatter", parse)
    assert asyncio.run(pages_queries.get_page("note"))["content"] == "# coordinated body"
    preview = asyncio.run(preview_routes._compute_preview(note, "note"))
    assert preview[1]["body_md"] == "# coordinated body"
    helpers = SimpleNamespace(
        active_vault_path=lambda: cloud.vault,
        parse_frontmatter=parse,
        find_page_for_write=lambda _: note,
        is_dashboard_file=lambda _: False,
    )
    assert save_helpers.read_save_page(note, helpers)[1] == "# coordinated body"
    assert (
        patch_helpers.find_and_read_patch_page("note", None, False, helpers)[2]
        == "# coordinated body"
    )
    assert cloud.reads == [note] * 4


def test_save_refuses_an_unavailable_previous_revision(tmp_path, monkeypatch):
    note = tmp_path / "page.md"
    note.write_text("previous revision")

    def denied(path, *, root):
        assert path == note and root == tmp_path
        raise metadata_io.MetadataUnavailable("offline", path=path, reason="offline")

    monkeypatch.setattr(save_helpers, "read_vault_text", denied)
    helpers = SimpleNamespace(active_vault_path=lambda: tmp_path, parse_frontmatter=object())
    with pytest.raises(metadata_io.MetadataUnavailable, match="offline"):
        save_helpers.read_save_page(note, helpers)
    assert note.read_text() == "previous revision"

    from backend.tests.page_write_open_fixtures import _save_dependencies

    ports = replace(
        _save_dependencies(note, {}, []),
        read_page=lambda path: save_helpers.read_save_page(path, helpers),
        locate_file=lambda *_args: pytest.fail(
            "The note moved before its previous revision was readable"
        ),
    )
    with pytest.raises(metadata_io.MetadataUnavailable, match="offline"):
        asyncio.run(
            save_service.save_page(
                "page",
                PageSaveRequest(title="New name", content="New"),
                BackgroundTasks(),
                None,
                ports,
            )
        )


def test_selected_table_reads_requested_stub_without_downloading_neighbor(cloud, monkeypatch):
    note = cloud.source("Rows/one.md", b"---\nid: one\ntitle: Selected\nstatus: read\n---\nBody")
    cloud.source("Rows/neighbor.md", b"unselected")
    page = PageInfo(id="one", title="One", last_modified="", size=0, path=str(note))
    key = str(cloud.vault)
    index = replace(
        index_service._deps(),
        active_vault_path=lambda: cloud.vault,
        index_entries={key: {str(note): {"_cloud_pending": True}}},
        id_to_path={},
        index_version={},
    )
    monkeypatch.setattr(index_service, "_dependencies", index)
    monkeypatch.setattr(
        foundation,
        "parse_frontmatter",
        lambda raw, _path: (
            {"title": "Selected", "id": "one", "status": "read"},
            raw.split("---")[-1],
        ),
    )
    monkeypatch.setattr(
        vault_routes,
        "_build_cache_entry_from_memory",
        lambda path, stat, md, _body: {
            "id": md["id"],
            "title": md["title"],
            "metadata": md,
            "mtime_ns": stat.st_mtime_ns,
        },
    )
    asyncio.run(pages_queries._materialize_metadata_pages([page]))
    assert cloud.reads == [note]
    assert page.title == "Selected" and page.metadata["status"] == "read"
    assert "_cloud_pending" not in index.index_entries[key][str(note)]


def test_note_history_preserves_bytes_and_timestamp_from_source_revision(cloud):
    note = cloud.source("note.md", b"original note")
    source_time = note.stat().st_mtime_ns
    history = HistoryRepository(cloud.vault)
    history.create_file_version("note-id", note)
    (version,) = history.page_root("note-id").glob("*.md")
    assert version.read_bytes() == b"original note"
    assert version.stat().st_mtime_ns == source_time
    assert cloud.reads == [note]



def test_registry_and_folder_schema_return_coordinated_source(cloud, monkeypatch):
    from backend.domains.vault.registry import runtime as registry
    from backend.domains.vault.tables import routes

    path = cloud.source("BD/vault_db_registry.json", b'{"databases":[{"id":"db","name":"Chosen"}],"tables":[],"views":[]}')
    schema = cloud.source("BD/Chosen/schema.json", b'{"columns":["title"]}')
    monkeypatch.setattr(vault_routes, "get_p", lambda key: path if key == "REGISTRY" else cloud.vault)
    result = asyncio.run(registry.get_registry())
    assert result["databases"] == [{"id": "db", "name": "Chosen"}]
    assert asyncio.run(routes.get_schema("BD/Chosen")) == {"columns": ["title"]}
    assert cloud.reads == [path, schema]


def test_unavailable_registry_never_seeds_or_authorizes_an_empty_schema(cloud, monkeypatch):
    from backend.app.errors import register_error_handlers
    from backend.domains.vault.registry import runtime as registry

    path = cloud.source("BD/vault_db_registry.json", b'{"tables":[{"id":"original"}]}')
    original = path.read_bytes()
    monkeypatch.setattr(vault_routes, "get_p", lambda key: path if key == "REGISTRY" else cloud.vault)

    async def offline(path, destination, timeout):
        raise metadata_io.MetadataUnavailable(path=path, reason="offline")

    monkeypatch.setattr(snapshots, "copy_coordinated", offline)
    app = FastAPI()
    register_error_handlers(app)
    app.add_api_route("/registry", registry.get_registry, response_model=None)
    with TestClient(app) as client:
        response = client.get("/registry")
    assert response.status_code == 503
    assert response.json()["reason"] == "offline"
    for operation in (
        vault_routes.ensure_default_registry_structure,
        registry.load_registry_for_write,
        lambda: registry.save_registry({"databases": [], "tables": [], "views": []}),
    ):
        with pytest.raises(metadata_io.MetadataUnavailable):
            operation()
    assert path.read_bytes() == original
    assert str(path) not in vault_routes.registry_repository.state.cache


def test_rule_lookup_reads_related_page_without_materializing_table_scan(cloud, monkeypatch):
    from backend.domains.vault.tables.rules import records
    from backend.services.rule_engine import RuleEngine

    selected = cloud.source("chosen.md", b"---\nid: chosen\ndatabase_table_id: t\nprice: 23\n---\n")
    neighbor = cloud.source("ignored.md", b"---\nid: ignored\ndatabase_table_id: t\nprice: 99\n---\n")
    monkeypatch.setattr(records, "is_cloud_placeholder", lambda path, stat: path in {selected, neighbor})
    engine = RuleEngine(cloud.vault)
    assert engine._lookup("t", "chosen", "price") == 23
    assert engine._query("t", "True", "price") == []
    assert cloud.reads == [selected]


def test_composer_reads_selected_bytes_and_preserves_unavailable_backlinks(cloud, monkeypatch):
    import yaml
    from fastapi import HTTPException
    from backend.domains.vault.composer import service as composer
    from backend.domains.vault.composer.schemas import ComposerRequest

    source = cloud.source("Wiki/source.md", b"---\nid: source\ntitle: Source\n---\nCoordinated body.\n")
    sidecar = cloud.source(".gnosi/page_meta/source.json", b'{"is_template":true}')

    def parse(text, path):
        _, frontmatter, body = text.split("---\n", 2)
        return yaml.safe_load(frontmatter), body

    deps = composer.ComposerDependencies(parse=parse, save=lambda *args: None, refresh=lambda *args: None)
    request = ComposerRequest(source_id="source", mode="extract", title="New")
    plan = composer.build_plan(cloud.vault, request, deps)
    assert plan.documents["source"].body == "Coordinated body.\n"
    assert plan.documents["source"].metadata["is_template"] is True
    assert cloud.reads == [source, sidecar]

    neighbor = cloud.source("Wiki/unselected.md", b"Possible backlink")
    monkeypatch.setattr(composer, "is_cloud_placeholder", lambda path, stat: path == neighbor)
    with pytest.raises(HTTPException, match="backlinks"):
        composer.build_plan(cloud.vault, request, deps)
    assert neighbor not in cloud.reads
    assert not (cloud.vault / ".history").exists()


def test_drawing_catalog_is_lazy_and_selected_drawing_opens(cloud, monkeypatch):
    from backend.domains.vault.drawings import routes, service

    path = cloud.source("Drawings/one.tldraw.json", b'{"title":"One","data":{"strokes":[1]}}')
    other = cloud.source("Drawings/two.tldraw.json", b'{"title":"Two","data":{}}')
    monkeypatch.setattr(vault_routes, "get_p", lambda key: path.parent if key == "DIBUIXOS" else cloud.vault)
    monkeypatch.setattr(service, "is_cloud_placeholder", lambda candidate, stat: candidate in {path, other})
    assert {item["id"] for item in asyncio.run(routes.list_drawings())} == {"one", "two"}
    assert cloud.reads == []
    assert asyncio.run(routes.get_drawing("one")) == {"strokes": [1]}
    assert cloud.reads == [path]



def test_publication_preview_reads_selected_note_and_uses_index_for_evicted_neighbor(cloud, monkeypatch):
    from backend.domains.vault.publishing import service

    selected = cloud.source("Wiki/Filename.md", b"Only the selected body")
    neighbor = cloud.source("Wiki/Other.md", b"Unselected body")
    monkeypatch.setattr(service, "is_cloud_placeholder", lambda path, info: True)
    entries = {
        str(path): {
            "id": identity, "title": identity.title(), "size": path.stat().st_size,
            "mtime_ns": path.stat().st_mtime_ns,
        }
        for path, identity in ((selected, "selected"), (neighbor, "neighbor"))
    }
    deps = service.PublicationDependencies(
        parse=lambda text, _path: ({"id": "selected", "title": "Selected"}, text),
        page_entries=entries,
    )
    assert {item.id for item in service.candidates(cloud.vault, deps)} == {"selected", "neighbor"}
    assert cloud.reads == []
    notes = service.inventory(cloud.vault, deps, {"selected"})
    assert notes["selected"].body == "Only the selected body"
    assert notes["neighbor"].body == ""
    assert cloud.reads == [selected]



def test_offline_replacement_preserves_prior_registry_and_trash_recovery(cloud, monkeypatch):
    from backend.domains.vault.registry import runtime as registry
    from backend.domains.vault.trash.repository import TrashRepository

    path = cloud.source("BD/vault_db_registry.json", b'{"tables":[{"id":"saved"}],"databases":[]}')
    original = path.read_bytes()
    source = cloud.source("note.md", b"Second revision")
    trash = TrashRepository(cloud.vault, retention_days=90,
                           parse_frontmatter=lambda *_: ({}, ""), write_json=lambda *args, **kwargs: None)
    entry = trash.entry_dir("note")
    entry.mkdir()
    (entry / "_trash.json").write_text('{"id":"note"}')
    (entry / "page.md").write_text("First revision")
    monkeypatch.setattr(vault_routes, "get_p", lambda key: path if key == "REGISTRY" else cloud.vault)
    vault_routes.registry_repository.state.seen_nondegenerate.add(str(path))

    async def offline(path, destination, timeout):
        raise metadata_io.MetadataUnavailable(path=path, reason="offline")

    monkeypatch.setattr(snapshots, "copy_coordinated", offline)
    with pytest.raises(metadata_io.MetadataUnavailable):
        registry.save_registry({"tables": [], "views": [], "databases": []})
    with pytest.raises(metadata_io.MetadataUnavailable):
        trash.move_page("note", source)
    assert path.read_bytes() == original
    assert source.exists()
    assert (entry / "page.md").read_text() == "First revision"
    assert (entry / "_trash.json").read_text() == '{"id":"note"}'



@pytest.mark.parametrize("target", ["renamed", "template"])
@pytest.mark.parametrize("offline", [False, True])
def test_daily_creation_waits_for_existing_note_and_template(cloud, monkeypatch, target, offline):
    import json
    from backend.domains.vault.api import core_routes

    date = "2026-11-20"
    daily = cloud.vault / "Daily Notes"
    templates = cloud.vault / "Templates"
    daily.mkdir()
    templates.mkdir()
    past = cloud.source("Daily Notes/Earlier.md", b"cached")
    unused = cloud.source("Templates/Other.md", b"cached")
    entries = {}
    for path, metadata in (
        (past, {"note_type": "daily", "date": "2026-10-01", "id": "past"}),
        (unused, {"is_daily_template": False, "id": "other-template"}),
    ):
        entries[str(path)] = {"size": path.stat().st_size, "mtime_ns": path.stat().st_mtime_ns, "metadata": metadata}
    if target == "renamed":
        selected = cloud.source("Daily Notes/A renamed journal.md", json.dumps(
            {"id": "original", "note_type": "daily", "date": date, "body": "Original"}
        ).encode())
    else:
        selected = cloud.source("Templates/Journal.md", b'{"is_daily_template":true,"body":"Template seed"}')

    monkeypatch.setattr(vault_routes, "_page_index_entries", {str(cloud.vault): entries})
    monkeypatch.setattr(vault_routes, "get_p", lambda key: {"DAILY": daily, "PLANTILLES": templates}.get(key, cloud.vault))
    monkeypatch.setattr(vault_routes, "_daily_source_config", lambda: (None, None))
    def parse(raw, _path):
        metadata = json.loads(raw)
        return metadata, metadata.pop("body", "")
    monkeypatch.setattr(vault_routes, "parse_frontmatter", parse)
    created = []
    opened = []
    async def open_page(page_id):
        opened.append(page_id)
        return {"id": page_id}
    async def create(request, tasks):
        created.append((request.title, request.content))
        return {"id": "new"}
    monkeypatch.setattr(vault_routes, "get_page", open_page)
    monkeypatch.setattr(vault_routes, "create_page", create)
    if offline:
        async def failed(path, destination, timeout):
            cloud.reads.append(path)
            raise metadata_io.MetadataUnavailable(path=path, reason="offline")
        monkeypatch.setattr(snapshots, "copy_coordinated", failed)

    request = core_routes.get_or_create_daily_note(vault_routes.DailyNoteRequest(date=date), BackgroundTasks())
    if offline:
        with pytest.raises(metadata_io.MetadataUnavailable) as failure:
            asyncio.run(request)
        assert failure.value.reason == "offline"
        assert created == [] and opened == []
    else:
        result = asyncio.run(request)
        if target == "renamed":
            assert result == {"id": "original"} and opened == ["original"] and not created
        else:
            assert result == {"id": "new"} and created == [(date, "Template seed")] and not opened
    assert cloud.reads == [selected]



@pytest.mark.parametrize("offline", [False, True])
def test_cloud_reference_survives_export_and_prevents_duplicate_import(cloud, monkeypatch, offline):
    import json
    from fastapi import APIRouter
    from backend.app.errors import register_error_handlers
    from backend.domains.vault.citations import export_routes, io_api
    from backend.services.workspace_service import WorkspaceContext, get_workspace_context

    reference = {
        "Citation Key": "retained", "Title": "Retained citation", "Item Type": "book",
        "DOI": "10.1234/example", "ISBN": "9780306406157",
    }
    selected = cloud.source("References/Renamed.md", json.dumps(reference).encode())
    neighbor = cloud.source("Other/private.md", b"Other table")
    pages = [
        SimpleNamespace(id="ref", path=str(selected), metadata={}, resolved_table_id="refs"),
        SimpleNamespace(id="other", path=str(neighbor), metadata={}, resolved_table_id="other"),
    ]
    writes = []
    async def create(request, _):
        writes.append(request)
        return {"id": "duplicate"}
    deps = replace(
        export_routes._REFERENCES_IO_DEPENDENCIES,
        active_vault_path=lambda: cloud.vault,
        load_registry=lambda: {"tables": [{"id": "refs"}]},
        item_type_catalog_names=lambda *_: [],
        resolve_existing_keys=lambda: set,
        resolve_ensure_index=lambda: (lambda _: {}),
        find_page=lambda key: selected if key == "ref" else neighbor,
        parse_frontmatter=lambda raw, _: (json.loads(raw), ""),
        page_snapshot=lambda: pages,
        resolve_create_page=lambda: create,
        resolve_invalidate_index=lambda: (lambda: None),
    )
    if offline:
        async def fail(path, destination, timeout):
            cloud.reads.append(path)
            raise metadata_io.MetadataUnavailable(path=path, reason="offline")
        monkeypatch.setattr(snapshots, "copy_coordinated", fail)
    app = FastAPI()
    router = APIRouter()
    io_api.register_import_route(router, editor_dependencies=[], dependencies=deps)
    io_api.register_catalog_export_routes(router, upload_dependencies=[], export_dependencies=[], dependencies=deps)
    app.include_router(router)
    register_error_handlers(app)
    app.dependency_overrides[get_workspace_context] = lambda: WorkspaceContext("workspace", "user", "editor", cloud.vault)
    with TestClient(app) as client:
        exported = client.get("/export-references?table_id=refs&keys=retained")
        imported = client.post("/import-references?table_id=refs&fmt=bibtex", files={"file": ("refs.bib", (
            "@book{newdoi,title={A different title},doi={10.1234/EXAMPLE}}\n"
            "@book{newisbn,title={Another title},isbn={978-0-306-40615-7}}"
        ), "text/plain")})
    if offline:
        assert exported.status_code == imported.status_code == 503
        assert exported.json()["reason"] == imported.json()["reason"] == "offline"
    else:
        assert exported.status_code == 200 and "retained" in exported.text and "10.1234/example" in exported.text
        assert imported.status_code == 200
        result = imported.json()
        assert result["created"] == 0 and result["skipped"] == 2
        assert result["skip_summary"]["doi"] == result["skip_summary"]["isbn"] == 1
    assert writes == [] and set(cloud.reads) == {selected}



@pytest.mark.parametrize("loaded", [False, True])
def test_selected_citation_export_skips_offline_same_table_neighbor(cloud, monkeypatch, loaded):
    import json
    from fastapi import APIRouter
    from backend.app.errors import register_error_handlers
    from backend.domains.vault.citations import export_routes, io_api

    offline = cloud.source("Refs/Unselected.md", b"unavailable")
    metadata = {"Citation Key": "selected", "Title": "Selected reference", "Item Type": "book"}
    selected = cloud.source("Refs/Chosen.md", json.dumps(metadata).encode())
    pages = [
        SimpleNamespace(id="other", path=str(offline), metadata={}, resolved_table_id="refs"),
        SimpleNamespace(id="chosen", path=str(selected), metadata=metadata if loaded else {}, resolved_table_id="refs"),
    ]
    old_copy = snapshots.copy_coordinated
    async def copy(path, destination, timeout):
        if path == offline:
            cloud.reads.append(path)
            raise metadata_io.MetadataUnavailable(path=path, reason="offline")
        return await old_copy(path, destination, timeout)
    monkeypatch.setattr(snapshots, "copy_coordinated", copy)
    deps = replace(
        export_routes._REFERENCES_IO_DEPENDENCIES, active_vault_path=lambda: cloud.vault,
        page_snapshot=lambda: pages,
        resolve_ensure_index=lambda: (lambda _: pytest.fail("A complete selection needs no index rebuild")
                                        if loaded else {"selected": {"id": "chosen"}}),
        find_page=lambda identifier: selected if identifier == "chosen" else offline,
        parse_frontmatter=lambda text, _: (json.loads(text), ""),
    )
    app, router = FastAPI(), APIRouter()
    io_api.register_catalog_export_routes(router, upload_dependencies=[], export_dependencies=[], dependencies=deps)
    app.include_router(router)
    register_error_handlers(app)
    with TestClient(app) as client:
        response = client.get("/export-references?table_id=refs&keys=selected")
        assert response.status_code == 200 and "Selected reference" in response.text
        assert cloud.reads == ([] if loaded else [selected])
        full = client.get("/export-references?table_id=refs")
    assert full.status_code == 503 and full.json()["reason"] == "offline"


def test_selected_reference_export_recovers_stale_index_in_table_and_keeps_order_and_duplicates(cloud, monkeypatch):
    import json
    from backend.domains.vault.citations import export_routes, io_api

    bad = cloud.source("Refs/offline.md", b"unavailable")
    stale = cloud.source("Refs/moved.md", b'{"Citation Key":"second","database_table_id":"elsewhere"}')
    good = cloud.source("Refs/good.md", b'{"Citation Key":"second","Title":"recovered"}')
    outside = cloud.source("Other/outside.md", b'{"Citation Key":"second","Title":"secret"}')
    paths = {"offline": bad, "moved": stale, "good": good, "outside": outside}
    first = {"Citation Key": "first", "Title": "first match"}
    duplicate = {"Citation Key": "first", "Title": "duplicate match"}
    pages = [
        SimpleNamespace(id="first", metadata=first, resolved_table_id="refs"),
        SimpleNamespace(id="offline", path=bad, metadata={}, resolved_table_id="refs"),
        SimpleNamespace(id="outside", path=outside, metadata={}, resolved_table_id="other"),
        SimpleNamespace(id="moved", path=stale, metadata={}, resolved_table_id="refs"),
        SimpleNamespace(id="good", path=good, metadata={}, resolved_table_id="refs"),
        SimpleNamespace(id="duplicate", metadata=duplicate, resolved_table_id="refs"),
    ]
    old_copy = snapshots.copy_coordinated
    async def copy(path, destination, timeout):
        if path == bad:
            cloud.reads.append(path)
            raise metadata_io.MetadataUnavailable(path=path, reason="offline")
        return await old_copy(path, destination, timeout)
    monkeypatch.setattr(snapshots, "copy_coordinated", copy)
    deps = replace(
        export_routes._REFERENCES_IO_DEPENDENCIES, active_vault_path=lambda: cloud.vault,
        resolve_ensure_index=lambda: (lambda _: {"second": {"id": "outside", "path": str(stale)}}),
        find_page=lambda identifier: outside if identifier == "moved" else paths.get(identifier),
        page_snapshot=lambda: pages,
        parse_frontmatter=lambda raw, _: (json.loads(raw), ""),
    )
    result = io_api.collect_table_reference_metas("refs", {"first", "second"}, deps)
    assert [item["Title"] for item in result] == ["first match", "recovered", "duplicate match"]
    assert cloud.reads == [stale, bad, good]
    with pytest.raises(metadata_io.MetadataUnavailable) as failure:
        io_api.collect_table_reference_metas("refs", {"absent"}, deps)
    assert failure.value.reason == "offline" and outside not in cloud.reads



@pytest.mark.parametrize("snapshot_path", ["Missing/old.md", None])
@pytest.mark.parametrize("folder, stored_table, expected_count", [
    ("Renamed", "refs", 1), ("Renamed", "other", 0), ("Renamed", None, 0),
    ("Current", None, 1), ("Other", "refs", 0),
])
def test_relocated_selected_reference_verifies_current_table(cloud, snapshot_path, folder, stored_table, expected_count):
    import json
    from backend.domains.vault.citations import export_routes, io_api

    metadata = {"Citation Key": "requested", "table_id": stored_table}
    moved = cloud.source(f"{folder}/note.md", json.dumps(metadata).encode())
    page = SimpleNamespace(id="old", path=snapshot_path, metadata={}, resolved_table_id="refs")
    deps = replace(
        export_routes._REFERENCES_IO_DEPENDENCIES, active_vault_path=lambda: cloud.vault,
        load_registry=lambda: {"tables": [{"id": "refs", "folder": "Current"}, {"id": "other", "folder": "Other"}]},
        resolve_ensure_index=lambda: (lambda _: {"requested": {"id": "old"}}),
        find_page=lambda _: moved, page_snapshot=lambda: [page],
        parse_frontmatter=lambda raw, _: (json.loads(raw), ""),
    )
    result = io_api.collect_table_reference_metas("refs", {"requested"}, deps)
    assert result == [metadata] * expected_count
    assert cloud.reads == [moved]


def test_loaded_citation_keeps_indexed_duplicate_without_inspecting_unknowns(cloud, monkeypatch):
    import json
    from backend.domains.vault.citations import export_routes, io_api

    duplicate = cloud.source("Refs/duplicate.md", b'{"Citation Key":"edition","Title":"Indexed first"}')
    skipped = cloud.source("Refs/unknown.md", b"unrelated")
    pages = [
        SimpleNamespace(id="unknown", path=skipped, metadata={}, resolved_table_id="refs"),
        SimpleNamespace(id="duplicate", path=duplicate, metadata={}, resolved_table_id="refs"),
        SimpleNamespace(id="loaded", metadata={"Citation Key": "edition", "Title": "Loaded last"}, resolved_table_id="refs"),
    ]
    monkeypatch.setitem(io_api.citation_index_state.indexes, str(cloud.vault), {"edition": {"id": "duplicate"}})
    deps = replace(
        export_routes._REFERENCES_IO_DEPENDENCIES, active_vault_path=lambda: cloud.vault,
        resolve_ensure_index=lambda: pytest.fail("A complete selection needs no index rebuild"),
        find_page=lambda page_id: duplicate if page_id == "duplicate" else skipped,
        page_snapshot=lambda: pages, parse_frontmatter=lambda raw, _: (json.loads(raw), ""),
    )
    result = io_api.collect_table_reference_metas("refs", {"edition"}, deps)
    assert [item["Title"] for item in result] == ["Indexed first", "Loaded last"]
    assert cloud.reads == [duplicate]
