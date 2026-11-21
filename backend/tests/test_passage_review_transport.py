"""Early review runs through distinct governed operations on one book budget."""

from dataclasses import replace
import json
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage

from backend.agent import factory
from backend.config import app_config
from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.reading_batch_recovery import IncompleteReadingBatch
from backend.domains.llm_wiki.reading_skill import SKILL_ID
from backend.domains.llm_wiki.semantic_reading import SemanticReader
from backend.services import agent_execution, agent_skill_catalog, reading_budget
from backend.services.agent_execution_scope import execution_scope
from backend.services.agent_operation_catalog import skill_id
from backend.services.llm_wiki_reading_runtime import ReadingRuntime
from backend.tests.test_agent_execution import runtime as runtime  # shared governed-operation fixture
from backend.tests.test_semantic_reading import setup


@pytest.mark.parametrize("mixed,interrupted", [(False, False), (True, False), (True, True)])
def test_wrong_primary_reaches_only_the_reviewer_even_after_length_failure(runtime, monkeypatch, tmp_path, mixed, interrupted):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    scope, reader = runtime
    reader.skill_ids[:] = [SKILL_ID]
    reader.profile["model"] = "reader-model"
    review = reader.model_copy(deep=True)
    review.agent_id = "specialist"
    review.profile.update(id=review.agent_id, model="review-model")
    review.skill_ids = [skill_id("reading-review")]
    agents = {s.agent_id: s for s in (reader, review)}
    resolved = agent_skill_catalog.resolve_agent_runtime({})
    monkeypatch.setattr(agent_skill_catalog, "resolve_agent_runtime", lambda profile, **kw:
                        replace(resolved, active_skill_ids=tuple(agents[profile["id"]].skill_ids)))
    monkeypatch.setattr(app_config, "load_params", lambda **kw: SimpleNamespace(ai={"agents": [s.profile for s in agents.values()]}, paths={}))
    calls = []

    class Provider:
        def __init__(self, sender):
            self.sender = sender

        def compile(self):
            return self

        async def astream(self, inputs, **kwargs):
            outer = json.loads(inputs["messages"][0].content)
            prompt = json.loads(outer["input"])
            phase = prompt["phase"]
            owner = agents[self.sender["agent_id"]]
            assert reading_budget.active() and inputs["current_user_role"] == scope.role
            assert self.sender["active_skill_ids"] == owner.skill_ids
            assert self.sender["prepared_agent_data"]["model"] == owner.profile["model"]
            calls.append((owner.agent_id, phase))
            assert phase in {"interpret", "source-repair"}
            catalog = prompt["source_quotes"]
            passages = {}
            for key, ref in prompt["primary_passages"].items():
                span = catalog[ref["source"] - 1]["quotes"][0]
                ids = [span["quote_id"]]
                if phase == "interpret" and key == "passage_1":
                    foreign = catalog[1]["quotes"][0]["quote_id"]
                    allowed = outer["output_schema"]["properties"]["passages"]["properties"][key]
                    assert foreign not in allowed["properties"]["notes"]["items"]["properties"]["primary_quote_ids"]["items"]["enum"]
                    ids = [*ids, foreign] if mixed else [foreign]
                note = {"title": "An objection", "body_md": span["text"], "properties": {},
                        "primary_quote_ids": ids, "context_quote_ids": []}
                passages[key] = {"reason": "The author qualifies an objection using experience.", "notes": [note]}
                if phase == "interpret":
                    passages[key]["needs_specialist"] = False
            if phase == "interpret":
                raw = encoded(dict(passages=passages, themes=[], contradictions=[], questions=[], warnings=[]))
            else:
                assert "primary quotation" in prompt["validation_error"]
                raw = encoded(dict(passages=passages, unresolved_issues=[], evidence_quote=catalog[0]["quotes"][0]["text"]))
                if interrupted and len(calls) == 2:
                    raw = '{"evidence_quote":"' + "a" * 4400
            yield {"operation": {"messages": [AIMessage(content=raw)]}}

    async def create(*args, **kwargs):
        return Provider(kwargs), {"provider": "test", "model": kwargs["prepared_agent_data"]["model"]}

    monkeypatch.setattr(factory, "create_agent_workflow", create)
    book, _, checkpoints = setup(count=3)
    with execution_scope(scope), reading_budget.session(reading_budget.configure(0.5)):
        reader = agent_execution.create_job_run(reader, "parent", "knowledge.process-source")
        review = review.model_copy(update={"parent_run_id": "parent"})
        def engine(book):
            rr, rv = [ReadingRuntime(s.agent_id, "test", s.profile["model"], "", 48000, s, skill_id=s.skill_ids[0])
                      for s in (reader, review)]
            book.dependencies.generate_structured = rr.generate_structured
            book.dependencies.reviewer = rv
            book.dependencies.citation_issues = None
            return SemanticReader(book)

        active = engine(book)
        if interrupted:
            with pytest.raises(IncompleteReadingBatch):
                active.extract("Argument")
            assert not active.state["plans"] and calls == [("personal", "interpret"), ("specialist", "source-repair")]
            book, _, _ = setup(count=3, checkpoints=checkpoints, resume="new")
            book.job_id = "resumed"
            book.dependencies.resume_job_status = lambda _: {"error": "reading_batch_response_incomplete"}
            active = engine(book)
        active.extract("Argument")
        assert calls == [("personal", "interpret")] + [("specialist", "source-repair")] * (2 if interrupted else 1)
        assert len(active.state["plans"]) == 3
        observation, = active.state["observations"].values()
        assert len(observation["review_passages"]) == 1
        note, = active.state["plans"]["chunk-1"]["notes"]
        assert all(c["segment_id"] == note["source_segment_id"] for c in note["citations"])
