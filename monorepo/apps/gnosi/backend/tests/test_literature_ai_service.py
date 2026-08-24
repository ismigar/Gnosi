from backend.services import literature_ai_service
from backend.services.literature_models import canonical_work


def test_local_reranking_preserves_original_rank_and_audit(monkeypatch):
    class FakeVectors:
        def __init__(self, rows):
            self.rows = rows

        def __getitem__(self, index):
            return FakeVector(self.rows[index])

    class FakeVector:
        def __init__(self, values):
            self.values = values

        def __matmul__(self, other):
            return sum(left * right for left, right in zip(self.values, other.values, strict=True))

    class FakeModel:
        def encode(self, _texts, **_kwargs):
            return FakeVectors([[1.0, 0.0], [0.2, 0.8], [0.9, 0.1]])

    monkeypatch.setattr(literature_ai_service, "_EMBEDDING_MODEL", FakeModel())
    monkeypatch.setattr(literature_ai_service, "_EMBEDDING_UNAVAILABLE", False)
    works = [
        canonical_work("crossref", "one", title="First result"),
        canonical_work("crossref", "two", title="Second result"),
    ]
    response = literature_ai_service.run_operation("rerank", {"mode": "local", "query": "evidence", "works": works})
    assert response["audit"]["cost"] == 0
    assert response["audit"]["provider"] == "local"
    assert response["result"]["ranking"][0]["id"] == works[1]["id"]
    assert response["result"]["ranking"][0]["original_rank"] == 2


def test_token_overlap_fallback_still_preserves_original_order_metadata(monkeypatch):
    monkeypatch.setattr(literature_ai_service, "_EMBEDDING_MODEL", None)
    monkeypatch.setattr(literature_ai_service, "_EMBEDDING_UNAVAILABLE", True)
    works = [canonical_work("crossref", "one", title="Open evidence")]
    response = literature_ai_service.run_operation("rerank", {"mode": "local", "query": "open evidence", "works": works})
    assert response["audit"]["model"] == "local-token-overlap"
    assert response["audit"]["fallback_reason"]
    assert response["result"]["ranking"][0]["original_rank"] == 1


def test_query_strategy_uses_selected_agent_and_auto_framework(monkeypatch):
    captured = {}

    def fake_generate_text(prompt, **kwargs):
        captured["prompt"] = prompt
        captured.update(kwargs)
        return '{"framework":"concepts","concepts":{},"synonyms":{},"boolean_query":"history","cautions":[]}', "test-model"

    monkeypatch.setattr("backend.agent.factory.generate_text", fake_generate_text)
    response = literature_ai_service.run_operation(
        "query_strategy",
        {"question": "Historical periodization", "framework": "AUTO", "languages": ["es", "en"]},
        agent_id="research-agent",
    )

    assert captured["agent_id"] == "research-agent"
    assert "use PICO or SPIDER only when they fit" in captured["prompt"]
    assert "require only the central subject concept" in captured["prompt"]
    assert response["audit"]["agent_id"] == "research-agent"
