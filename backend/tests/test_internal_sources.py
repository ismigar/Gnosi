"""Coverage for scoped first-party sources and durable Reader analysis."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.agent import internal_sources
from backend.agent.agent_context import build_context_tools, normalize_refs
from backend.api.agent_routes import ChatRequest
from backend.data.db import Base
from backend.models.reader import Article, FeedSource
from backend.models.agent_skills import ConfirmationPolicy, ToolEffect
from backend.services import reader_analysis
from backend.services.gnosi_ai_contributions import core_gnosi_registrations


def test_internal_scope_is_bounded_and_normalized():
    scope = internal_sources.normalize_internal_scope("reader", {
        "unread_only": False,
        "source_ids": [1, "2", -1, 1],
        "categories": ["Politics", "Politics", ""],
        "limit": 10_000,
        "date_from": "2026-01-01",
    })

    assert scope["unread_only"] is False
    assert scope["source_ids"] == [1, 2]
    assert scope["categories"] == ["Politics"]
    assert scope["limit"] == internal_sources.MAX_RESULT_ITEMS
    assert scope["date_from"].startswith("2026-01-01T00:00:00")


def test_turn_context_accepts_internal_sources_only():
    request = ChatRequest(
        message="Summarize this Reader scope",
        context_refs=[{
            "id": "route-reader",
            "type": "internal",
            "ref": "reader",
            "scope": {"unread_only": True, "limit": 10_000},
        }],
    )

    assert request.context_refs[0].scope["limit"] == internal_sources.MAX_RESULT_ITEMS
    with pytest.raises(ValidationError):
        ChatRequest(
            message="Fetch an arbitrary URL",
            context_refs=[{
                "id": "external",
                "type": "url",
                "ref": "https://example.test",
            }],
        )


def test_integration_accounts_are_resolved_inside_personal_workspace(monkeypatch):
    monkeypatch.setattr(
        internal_sources,
        "_request_scope",
        lambda: {"workspace_id": "shared"},
    )
    with pytest.raises(PermissionError):
        internal_sources._allowed_accounts([])

    monkeypatch.setattr(
        internal_sources,
        "_request_scope",
        lambda: {"workspace_id": "personal"},
    )
    monkeypatch.setattr(
        internal_sources,
        "_configured_accounts",
        lambda calendar=False: ["allowed@example.test"],
    )
    assert internal_sources._allowed_accounts(["allowed@example.test"]) == [
        "allowed@example.test"
    ]
    with pytest.raises(PermissionError):
        internal_sources._allowed_accounts(["unknown@example.test"])


def test_reader_inventory_counts_filtered_rows_and_feed_breakdown(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()
    politics = FeedSource(name="Politics feed", url="https://p.example", category="Politics")
    science = FeedSource(name="Science feed", url="https://s.example", category="Science")
    db.add_all([politics, science])
    db.flush()
    politics_id = politics.id
    db.add_all([
        Article(source_id=politics.id, title="One", url="https://p.example/1", content="A", published_at=datetime(2026, 1, 1, tzinfo=timezone.utc), is_read=False),
        Article(source_id=politics.id, title="Two", url="https://p.example/2", content="B", published_at=datetime(2026, 1, 2, tzinfo=timezone.utc), is_read=True),
        Article(source_id=science.id, title="Three", url="https://s.example/3", content="C", published_at=datetime(2026, 1, 3, tzinfo=timezone.utc), is_read=False),
    ])
    db.commit()
    db.close()
    monkeypatch.setattr(internal_sources, "_reader_session", session_factory)

    scope = internal_sources.normalize_internal_scope("reader", {
        "unread_only": False,
        "categories": ["Politics"],
    })
    inventory = internal_sources._reader_inventory(scope)

    assert inventory["count"] == 2
    assert inventory["feeds"] == [{
        "id": politics_id,
        "name": "Politics feed",
        "category": "Politics",
        "count": 2,
    }]


def test_internal_context_tools_preserve_scope_and_exact_read(monkeypatch):
    refs = normalize_refs([{
        "id": "reader-source",
        "type": "internal",
        "ref": "reader",
        "label": "Pending Reader",
        "scope": {"unread_only": True, "source_ids": [7]},
    }])

    assert refs[0]["scope"]["source_ids"] == [7]
    monkeypatch.setattr(
        internal_sources,
        "search_internal_source",
        lambda source_id, scope, query: json.dumps({
            "source_id": source_id,
            "source_ids": scope["source_ids"],
            "query": query,
        }),
    )
    monkeypatch.setattr(
        internal_sources,
        "read_internal_record",
        lambda source_id, scope, record_id: json.dumps({
            "source_id": source_id,
            "source_ids": scope["source_ids"],
            "record_id": record_id,
        }),
    )
    tools = {tool.name: tool for tool in build_context_tools(refs)}

    searched = tools["search_context"].invoke({"query": "climate policy"})
    exact = tools["read_context_record"].invoke({
        "source_id": "reader-source",
        "record_id": "42",
    })

    assert '"source_ids": [7]' in searched
    assert '"query": "climate policy"' in searched
    assert '"record_id": "42"' in exact


def test_reader_analysis_processes_snapshot_with_checkpoints(tmp_path, monkeypatch):
    local_data = tmp_path / "local-data"
    vault_path = tmp_path / "vault"
    vault_path.mkdir()
    monkeypatch.setattr(
        reader_analysis,
        "load_params",
        lambda strict_env=False: SimpleNamespace(paths={"LOCAL_DATA": local_data}),
    )
    rows = [
        {
            "id": str(index),
            "title": f"Article {index}",
            "source": "Example",
            "category": "Politics" if index < 3 else "Science",
            "published_at": f"2026-01-0{index}T00:00:00+00:00",
            "url": f"https://example.test/{index}",
            "content": f"Evidence {index}",
        }
        for index in range(1, 5)
    ]
    monkeypatch.setattr(reader_analysis, "_snapshot_articles", lambda _vault, _scope: rows)

    def model_call(prompt, _user_message):
        if "BATCH ANALYSES" in prompt:
            supplied = json.loads(prompt.split("BATCH ANALYSES:\n", 1)[1])
            ids = [identifier for item in supplied for identifier in item["article_ids"]]
            return json.dumps({
                "topic": supplied[0]["topic"],
                "evolution": "The topic changed over time.",
                "turning_points": [],
                "article_ids": ids,
            })
        article_lines = prompt.split("ARTICLES:\n", 1)[1].splitlines()
        articles = [json.loads(line) for line in article_lines]
        return json.dumps({
            "topic": articles[0]["category"],
            "period_start": articles[0]["published_at"],
            "period_end": articles[-1]["published_at"],
            "article_count": len(articles),
            "summary": "Batch summary",
            "developments": [],
            "article_ids": [article["id"] for article in articles],
        })

    job = reader_analysis.start_analysis(
        vault_path,
        {"unread_only": True},
        model_call=model_call,
        launch=False,
    )
    reader_analysis._run_job(vault_path, job["job_id"], model_call=model_call)

    status = reader_analysis.get_status(vault_path, job["job_id"])
    result = reader_analysis.read_result(vault_path, job["job_id"])
    recent = reader_analysis.list_analyses(vault_path, limit=1)
    checkpoints = list((reader_analysis._root(vault_path) / "checkpoints" / job["job_id"]).glob("*.json"))

    assert status["state"] == "completed"
    assert status["processed_articles"] == len(rows)
    assert result["article_count"] == len(rows)
    assert {topic["topic"] for topic in result["topics"]} == {"Politics", "Science"}
    assert all(topic["article_ids"] for topic in result["topics"])
    assert len(checkpoints) == status["total_batches"]
    assert recent[0]["job_id"] == job["job_id"]
    assert "/reader?article=" in result["report_markdown"]


def test_reader_analysis_tools_are_governed_by_effect():
    descriptors = {
        descriptor.id: descriptor
        for descriptor, _handler in core_gnosi_registrations()
        if descriptor.metadata.get("domain") == "reader"
    }

    assert descriptors["core.gnosi.reader-inventory"].effects == [ToolEffect.READ]
    start = descriptors["core.gnosi.start-reader-topic-analysis"]
    assert start.effects == [ToolEffect.LOCAL_WRITE, ToolEffect.AI_COST]
    assert start.confirmation == ConfirmationPolicy.EXPLICIT_REQUEST
