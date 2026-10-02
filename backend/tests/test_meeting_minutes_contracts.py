"""Source grounding and meeting persistence failure contracts."""
import asyncio
import json
from pathlib import Path
from unittest.mock import Mock

import pytest

from backend.services.meeting_contracts import parse_minutes, render_minutes

TRANSCRIPT = "Taller a Girona amb 12 persones i 240 euros. Maria coordina el taller. Cal comprar material abans del 10 de març."


def payload():
    return {"summary": ["Taller a Girona amb 12 persones i 240 euros."], "topics": ["Maria coordina el taller."], "decisions": [], "tasks": [{"evidence": "Cal comprar material abans del 10 de març.", "owner": None, "deadline": "10 de març"}], "next_steps": []}


@pytest.mark.parametrize("language,heading", [("ca", "Resum"), ("es", "Resumen"), ("en", "Summary"), ("fr", "Résumé")])
def test_localized_minutes_preserve_source_and_unassigned_owner(language, heading):
    body = render_minutes(parse_minutes(json.dumps(payload()), TRANSCRIPT), language)
    assert f"## {heading}" in body
    assert "12 persones i 240 euros" in body
    assert "2026" not in body
    assert "Maria" not in body.split("- [ ]")[1]


@pytest.mark.parametrize("change", ["owner", "year", "summary", "blank", "extra"])
def test_invented_or_unrelated_evidence_rejected(change):
    data = payload()
    if change == "owner":
        data["tasks"][0]["owner"] = "Maria"
    elif change == "year":
        data["tasks"][0]["deadline"] = "10 de març de 2026"
    elif change == "summary":
        data["summary"] = ["Taller a Barcelona."]
    elif change == "blank":
        data["topics"] = [" "]
    else:
        data["warning"] = "all good"
    with pytest.raises(Exception):
        parse_minutes(json.dumps(data), TRANSCRIPT)


def setup_pipeline(monkeypatch, text=TRANSCRIPT, language="ca"):
    from backend.services import meeting_notes, transcription, agent_execution_scope
    from backend.services.agent_execution_models import ExecutionScope
    scope = ExecutionScope(user_id="test", workspace_id="test", role="owner", vault_path="/private/tmp/meeting-test")
    monkeypatch.setattr(meeting_notes, "current_scope", lambda: scope)
    monkeypatch.setattr(transcription, "transcribe", lambda _: {"text": text, "language": language, "duration": 120})
    monkeypatch.setattr(agent_execution_scope, "current_scope", lambda: scope)
    monkeypatch.setattr(agent_execution_scope, "revalidate_scope", lambda _: None)
    save = Mock(return_value="page-1")
    monkeypatch.setattr(meeting_notes, "_create_vault_page", save)
    return meeting_notes, save


def test_pipeline_preserves_raw_transcript_and_validates_before_save(monkeypatch, tmp_path):
    from backend.services import agent_execution
    raw = " \n" + TRANSCRIPT + "\n "
    meeting_notes, save = setup_pipeline(monkeypatch, raw)
    def generate(*args, **kwargs):
        assert kwargs["output_schema"]["additionalProperties"] is False
        output = json.dumps(payload())
        kwargs["output_validator"](output)
        return output, {}
    monkeypatch.setattr(agent_execution, "generate_for", generate)
    audio = tmp_path / "audio.webm"
    audio.write_bytes(b"fixture")
    result = meeting_notes._process_meeting(str(audio), "Taller")
    assert result["page_id"] == "page-1" and result["warning"] is None
    assert save.call_args.args[2]["meeting_transcript"] == raw
    assert save.call_args.args[2]["minutes_status"] == "validated"
    assert not audio.exists()


def test_invalid_ai_saves_transcript_with_explicit_warning(monkeypatch, tmp_path):
    from backend.services import agent_execution
    meeting_notes, save = setup_pipeline(monkeypatch, language="fr")
    monkeypatch.setattr(agent_execution, "generate_for", lambda *a, **kw: ("Invented minutes", {}))
    result = meeting_notes._process_meeting(str(tmp_path / "audio"), "Test")
    assert result["warning"]
    assert "Invented minutes" not in save.call_args.args[1]
    assert result["warning"] in save.call_args.args[1]
    assert save.call_args.args[2]["minutes_status"] == "unavailable"
    assert meeting_notes.get_status()["warning"] == result["warning"]


def test_empty_transcript_never_generates_or_saves(monkeypatch, tmp_path):
    from backend.services import agent_execution
    meeting_notes, save = setup_pipeline(monkeypatch, text=" \n")
    generate = Mock()
    monkeypatch.setattr(agent_execution, "generate_for", generate)
    assert meeting_notes._process_meeting(str(tmp_path / "audio"), "Test")["error"]
    generate.assert_not_called()
    save.assert_not_called()


def test_page_creation_passes_scope_executes_tasks_and_checks_id(monkeypatch):
    from backend.services import meeting_notes, agent_execution_scope
    from backend.api import vault_routes
    from backend.services.agent_execution_models import ExecutionScope
    scope = ExecutionScope(user_id="u", workspace_id="w", role="owner", vault_path="/private/tmp/fixture")
    monkeypatch.setattr(agent_execution_scope, "current_scope", lambda: scope)
    effect = Mock()
    async def create(request, tasks, context, idempotency_key=None):
        assert context.user_id == "u" and context.vault_path == Path(scope.vault_path)
        assert request.metadata["minutes_status"] == "validated"
        tasks.add_task(effect)
        return {"id": "page-3"}
    monkeypatch.setattr(vault_routes, "create_page", create)
    assert meeting_notes._create_vault_page("Test", "body", {"minutes_status": "validated"}) == "page-3"
    effect.assert_called_once()
    async def missing(*args, **kwargs):
        return {}
    monkeypatch.setattr(vault_routes, "create_page", missing)
    with pytest.raises(ValueError, match="no page ID"):
        meeting_notes._create_vault_page("Test", "body")


def test_transcript_html_cannot_close_details():
    from backend.services.meeting_notes import _acta_page_markdown
    body = _acta_page_markdown("Acta", "</pre></details><script>x</script>", "meta")
    assert "<script>" not in body and "&lt;script&gt;" in body


def test_record_busy_race_removes_uploaded_audio(monkeypatch, tmp_path):
    from backend.api import meeting_routes
    from fastapi import HTTPException, UploadFile
    from io import BytesIO
    monkeypatch.setattr(meeting_routes, "_audio_dir", lambda: tmp_path)
    monkeypatch.setattr(meeting_routes.meeting_notes, "get_status", lambda: {"running": False})
    monkeypatch.setattr(meeting_routes.meeting_notes, "start_async", lambda *args: False)
    with pytest.raises(HTTPException) as error:
        asyncio.run(meeting_routes.record_meeting(UploadFile(file=BytesIO(b"audio")), "Test", "online"))
    assert error.value.status_code == 409 and list(tmp_path.iterdir()) == []


def test_revoked_scope_cannot_save_meeting(monkeypatch, tmp_path):
    from backend.services import agent_execution, agent_execution_scope
    meeting_notes, save = setup_pipeline(monkeypatch)
    monkeypatch.setattr(agent_execution, "generate_for", lambda *a, **kw: (json.dumps(payload()), {}))
    def revoked(_):
        raise PermissionError("agent_execution_membership_revoked")
    monkeypatch.setattr(agent_execution_scope, "revalidate_scope", revoked)
    assert "revoked" in meeting_notes._process_meeting(str(tmp_path / "audio"), "Test")["error"]
    save.assert_not_called()
