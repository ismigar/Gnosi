import asyncio
import inspect
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from backend.services import academic_connectors, literature_import_service, literature_service
from backend.services.literature_models import canonical_work
from backend.services.workspace_service import WorkspaceContext


@pytest.fixture()
def literature_env(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    local_data = tmp_path / "local-data"
    vault.mkdir()
    params = SimpleNamespace(paths={"VAULT": vault, "LOCAL_DATA": local_data})
    monkeypatch.setattr(literature_service, "load_params", lambda strict_env=False: params)
    monkeypatch.setattr(literature_service, "get_primary_vault_path", lambda: vault)
    monkeypatch.setattr(literature_service, "_credential_value", lambda _key: "")
    return vault


def test_configuration_is_vault_native_and_credentials_are_not_persisted(literature_env):
    saved = literature_service.save_config(literature_env, {
        "contact_email": "research@example.org",
        "source_defaults": {"crossref": False},
        "hidden_sources": ["google-scholar"],
        "credential": "must-not-be-saved",
    })
    assert saved["contact_email"] == "research@example.org"
    raw = (literature_env / ".gnosi" / "literature" / "repositories.json").read_text()
    assert "must-not-be-saved" not in raw
    assert literature_service.index_path(literature_env).is_relative_to(literature_env.parent / "local-data")


def test_search_route_keeps_the_asgi_event_loop():
    from backend.api import literature_routes

    assert inspect.iscoroutinefunction(literature_routes.create_search)


def test_membership_annotation_works_before_resources_table_is_configured(literature_env, monkeypatch):
    from backend.api import vault_routes

    monkeypatch.setattr(literature_import_service, "get_primary_vault_path", lambda: literature_env)
    monkeypatch.setattr(vault_routes, "get_reference_table_id", lambda: None)
    context = WorkspaceContext("workspace", "researcher", "viewer", literature_env, ["read"])
    work = canonical_work("crossref", "one", title="Open science")

    annotated = literature_import_service.mark_resource_membership([work], context)

    assert annotated[0]["in_resources"] is False
    assert annotated[0]["resource_id"] is None


def test_oai_index_uses_fts_and_applies_date_filters(literature_env):
    first = canonical_work("dialnet-articles", "one", title="Open science education", authors=["Riu, Ada"], year=2024)
    second = canonical_work("dialnet-articles", "two", title="Open science archives", authors=["Riu, Ada"], year=2018)
    with literature_service._connect_index(literature_env) as connection:
        literature_service._upsert_oai_page(connection, "dialnet-articles", {"works": [first, second], "deleted": []})
        connection.commit()
    rows = literature_service.search_oai_index(literature_env, "dialnet-articles", "open science", {"date_from": 2020}, 10)
    assert [row["title"] for row in rows] == ["Open science education"]


def test_oai_tombstone_removes_record_and_fts_entry(literature_env):
    work = canonical_work("dialnet-theses", "oai:test:1", title="Research methods", authors=["Riu, Ada"], year=2020)
    with literature_service._connect_index(literature_env) as connection:
        literature_service._upsert_oai_page(connection, "dialnet-theses", {"works": [work], "deleted": []})
        literature_service._upsert_oai_page(connection, "dialnet-theses", {"works": [], "deleted": ["oai:test:1"]})
        connection.commit()
    assert literature_service.search_oai_index(literature_env, "dialnet-theses", "research methods", {}, 10) == []


def test_progressive_search_preserves_results_when_one_source_fails(literature_env, monkeypatch):
    async def fake_search(source_id, *_args, **_kwargs):
        await asyncio.sleep(0)
        if source_id == "datacite":
            raise academic_connectors.ConnectorError("Quota reached", retry_after=30)
        return [canonical_work(source_id, "one", title="Shared evidence", authors=["Riu, Ada"], year=2024, identifiers={"doi": "10.1000/shared", "isbn13": [], "provider": {}})]

    async def exercise():
        monkeypatch.setattr(academic_connectors, "search_source", fake_search)
        created = literature_service.start_search(
            literature_env, query="shared evidence", filters={}, source_ids=["crossref", "datacite"], limit_per_source=5,
        )
        task = literature_service._SEARCH_TASKS[created["id"]]
        await task
        return literature_service.get_search(literature_env, created["id"], limit=20)

    finished = asyncio.run(exercise())
    assert finished["state"] == "completed"
    assert len(finished["results"]) == 1
    assert finished["source_status"]["crossref"]["state"] == "completed"
    assert finished["source_status"]["datacite"]["retry_after"] == 30


def test_repository_history_snapshot_keeps_used_name(literature_env, monkeypatch):
    monkeypatch.setattr(academic_connectors, "validate_public_https_url", lambda value: value)
    custom = literature_service.save_repository(literature_env, {
        "name": "Institutional Archive", "kind": "oai", "base_url": "https://repository.example/oai",
        "metadata_prefix": "oai_dc", "set": "", "sync_mode": "incremental", "tombstones": True,
        "default_enabled": True, "query_parameter": "q", "limit_parameter": "limit", "results_path": "results",
        "pagination": "none", "static_filters": {}, "mapping": {},
    })
    snapshot = next(item for item in literature_service.catalog(literature_env) if item["id"] == custom["id"])
    assert snapshot["name"] == "Institutional Archive"


def test_due_review_updates_are_durable_and_require_a_saved_strategy(literature_env, monkeypatch):
    from backend.services import literature_review_service

    monkeypatch.setattr(literature_review_service, "list_reviews", lambda: [
        {"id": "due", "configuration": {"schedule": {"enabled": True, "interval_days": 7, "strategy": {"query": "open science", "source_ids": ["crossref"]}}}},
        {"id": "disabled", "configuration": {"schedule": {"enabled": False, "strategy": {"query": "ignored"}}}},
        {"id": "missing", "configuration": {"schedule": {"enabled": True, "strategy": {}}}},
    ])
    queued = []
    monkeypatch.setattr(literature_service.durable_job_queue, "enqueue", lambda job_type, payload, **kwargs: queued.append((job_type, payload, kwargs)))
    assert literature_service.enqueue_due_review_updates(literature_env) == 1
    assert queued[0][0] == "academic_review_update"
    assert queued[0][1]["review_id"] == "due"


def test_daily_oai_sync_skips_first_harvest_and_queues_initialized_due_source(literature_env, monkeypatch):
    queued = []
    monkeypatch.setattr(literature_service, "enqueue_sync", lambda _vault, source_id, full=False: queued.append((source_id, full)))

    assert literature_service.enqueue_due_syncs(literature_env) == 0

    completed = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    with literature_service._connect_index(literature_env) as connection:
        connection.execute(
            """INSERT INTO oai_sync_state(
                source_id,state,received_count,indexed_count,deleted_count,
                cancel_requested,updated_at,completed_at
            ) VALUES(?,?,?,?,?,?,?,?)""",
            ("dialnet-articles", "completed", 1, 1, 0, 0, completed, completed),
        )
        connection.commit()

    assert literature_service.enqueue_due_syncs(literature_env) == 1
    assert queued == [("dialnet-articles", False)]
