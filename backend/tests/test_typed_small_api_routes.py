"""Direct-call contracts for the remaining small typed API facades."""

from __future__ import annotations

import asyncio
import io

from fastapi import UploadFile


def test_identity_routes_keep_mapping_results(tmp_path, monkeypatch) -> None:
    from backend.api import identity_routes

    identity_path = tmp_path / "identity.json"
    monkeypatch.setattr(identity_routes, "get_identity_path", lambda: identity_path)

    empty = asyncio.run(identity_routes.get_identity())
    saved = asyncio.run(
        identity_routes.save_identity(identity_routes.IdentityProfile(full_name="Ada Lovelace"))
    )

    assert empty["full_name"] == ""
    assert saved == {"status": "success"}
    assert identity_path.is_file()


def test_handwriting_routes_validate_historical_dictionaries(monkeypatch) -> None:
    from backend.api import handwriting_routes

    result = {
        "text": "Hola",
        "raw": "Hola",
        "lines": ["Hola"],
        "model": "local-model",
        "corrected": False,
    }
    monkeypatch.setattr(handwriting_routes.handwriting, "is_available", lambda: True)
    monkeypatch.setattr(handwriting_routes.handwriting, "is_loaded", lambda: True)
    monkeypatch.setattr(handwriting_routes.handwriting, "_model_id", lambda: "local-model")
    monkeypatch.setattr(handwriting_routes.handwriting, "warmup", lambda: False)
    monkeypatch.setattr(
        handwriting_routes.handwriting,
        "recognize",
        lambda *_args: result,
    )
    upload = UploadFile(filename="ink.png", file=io.BytesIO(b"png"))

    assert asyncio.run(handwriting_routes.handwriting_status()) == {
        "available": True,
        "loaded": True,
        "model": "local-model",
    }
    assert asyncio.run(handwriting_routes.handwriting_warmup()) == {
        "warming": False,
        "loaded": True,
    }
    assert asyncio.run(handwriting_routes.recognize_handwriting(upload)) == result


def test_meeting_routes_keep_status_and_start_shapes(tmp_path, monkeypatch) -> None:
    from backend.api import meeting_routes

    status = {
        "running": False,
        "stage": "idle",
        "progress": 0,
        "error": None,
        "page_id": None,
        "title": None,
    }
    monkeypatch.setattr(meeting_routes.meeting_notes, "get_status", lambda: status)
    monkeypatch.setattr(meeting_routes.meeting_notes, "start_async", lambda *_args: True)
    monkeypatch.setattr(meeting_routes, "_audio_dir", lambda: tmp_path)
    upload = UploadFile(filename="meeting.webm", file=io.BytesIO(b"audio"))

    assert asyncio.run(meeting_routes.meeting_status()) == status
    assert asyncio.run(meeting_routes.record_meeting(upload)) == {"status": "started"}


def test_tool_mutations_keep_mapping_results(tmp_path, monkeypatch) -> None:
    from backend.api import tools_routes

    monkeypatch.setattr(tools_routes.registry, "approve", lambda _name: True)
    monkeypatch.setattr(tools_routes.registry, "reject", lambda _name, _reason: True)
    monkeypatch.setattr(tools_routes, "_get_tools_base", lambda: tmp_path)

    approved = asyncio.run(tools_routes.approve_tool(tools_routes.ApproveRequest(name="safe_tool")))
    rejected = asyncio.run(
        tools_routes.reject_tool(tools_routes.RejectRequest(name="unsafe_tool", reason="unsafe"))
    )

    assert approved == {"status": "approved", "name": "safe_tool"}
    assert rejected == {
        "status": "rejected",
        "name": "unsafe_tool",
        "reason": "unsafe",
    }
