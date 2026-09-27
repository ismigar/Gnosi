"""Specialized inference engines registered and audited as principal tools."""
from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from typing import Any, TypeVar
from pathlib import Path

from backend.models.agent_skills import CatalogOrigin, ConfirmationPolicy, OriginType, ToolDescriptor, ToolEffect
from backend.services.agent_execution_models import AgentRun

T = TypeVar("T")
ENGINES = {
    "transcription": ("capture", "Whisper"),
    "handwriting": ("capture", "TrOCR"),
    "speech": ("podcast", "gTTS"),
    "semantic-ranking": ("literature", "sentence-transformers"),
}


def run_engine(kind: str, resource: str, invoke: Callable[[], T]) -> T:
    from backend.services.agent_execution import operation_origin, prepare_snapshot, _run, _snapshot
    from backend.services.agent_execution_scope import current_scope, revalidate_scope
    from backend.services.agent_operation_catalog import skill_id
    from backend.services.agent_run_middleware import report_run
    from backend.services import agent_execution_store as store

    operation, engine = ENGINES[kind]
    scope = current_scope()
    revalidate_scope(scope)
    snapshot = prepare_snapshot(skill_id(operation))
    if snapshot.scope != scope:
        raise PermissionError("agent_execution_scope_changed")
    from backend.config.app_config import load_params
    from backend.services.agent_skill_catalog import resolve_agent_runtime
    current = next((profile for profile in load_params(strict_env=False).ai.get("agents", []) if profile.get("id") == snapshot.agent_id), None)
    if not current or not current.get("enabled", True):
        raise PermissionError("agent_execution_profile_revoked")
    runtime = resolve_agent_runtime(current, vault_path=Path(scope.vault_path), active_skill_ids=[skill_id(operation)])
    if skill_id(operation) not in runtime.active_skill_ids:
        raise PermissionError("agent_execution_skill_revoked")
    if kind == "speech" and scope.role == "viewer":
        raise PermissionError("agent_execution_write_forbidden")
    parent = _run.get()
    if parent and store.cancelled(scope, parent):
        from backend.services.agent_cancellation import AgentTurnCancelled
        raise AgentTurnCancelled("agent_run_cancelled")
    run_id = uuid.uuid4().hex
    row = AgentRun(run_id=run_id, parent_run_id=_run.get(), agent_id=snapshot.agent_id,
        skill_id=skill_id(operation), operation=kind, origin=operation_origin(), status="running",
        created_at=time.time(), updated_at=time.time(), model=engine,
        provider="google-tts" if kind == "speech" else "local-engine", execution_revision=snapshot.revision)
    store.create(row, scope, {"mode": "specialized", "resource": resource}, snapshot.model_dump())
    report_run(run_id)
    from backend.services.agent_execution_trace import append
    append(scope, run_id, "engine.request", {"engine": engine, "resource": resource, "classification": "technical_inference", "provider_internal_visibility": False})
    try:
        result = invoke()
        append(scope, run_id, "engine.response", result)
        revalidate_scope(scope)
        if store.cancelled(scope, run_id) or (parent and store.cancelled(scope, parent)):
            from backend.services.agent_cancellation import AgentTurnCancelled
            raise AgentTurnCancelled("agent_run_cancelled")
        store.update(scope, run_id, status="completed")
        return result
    except BaseException as error:
        append(scope, run_id, "engine.error", {"type": type(error).__name__, "message": str(error)})
        from backend.services.agent_cancellation import AgentTurnCancelled
        store.update(scope, run_id, status="cancelled" if isinstance(error, AgentTurnCancelled) else "failed", error=type(error).__name__)
        raise
    finally:
        if row.parent_run_id:
            store.aggregate(scope, row.parent_run_id)


def _vault_asset(relative_path: str) -> Path:
    from backend.services.agent_execution_scope import current_scope
    root = Path(current_scope().vault_path).resolve()
    path = (root / relative_path).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise PermissionError("agent_asset_outside_vault")
    return path


def transcribe_asset(relative_path: str, language: str = "") -> dict[str, Any]:
    """Transcribe an exact audio asset in the authorized Vault."""
    from backend.services.transcription import transcribe
    return dict(transcribe(str(_vault_asset(relative_path)), language=language or None))


def recognize_asset(relative_path: str, language: str = "") -> dict[str, Any]:
    """Read handwriting from an exact image asset in the authorized Vault."""
    from backend.services.handwriting import recognize
    return recognize(_vault_asset(relative_path).read_bytes(), correct=False, language=language or None)


def synthesize_speech(text: str, language: str = "ca") -> dict[str, Any]:
    """Synthesize speech and save one deterministic audio artifact in the Vault."""
    import hashlib
    from backend.services.audio_summarizer import _generate_tts_atomically
    from backend.services.agent_execution_scope import current_scope
    digest = hashlib.sha256((language + "\0" + text).encode()).hexdigest()
    relative = Path("data") / "podcasts" / f"speech-{digest}.mp3"
    path = Path(current_scope().vault_path) / relative
    def generate() -> dict[str, Any]:
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            _generate_tts_atomically(text, path, language)
        return {"path": relative.as_posix()}
    return run_engine("speech", relative.as_posix(), generate)


def rank_literature(query: str, works: list[dict[str, Any]]) -> dict[str, Any]:
    """Rank supplied bibliography records with the local semantic engine."""
    from backend.services.literature_ai_service import _local_embedding_rerank
    result, model, reason = run_engine("semantic-ranking", "literature selection", lambda: _local_embedding_rerank(query, works))
    return {"result": result, "model": model, "fallback_reason": reason}


def registrations() -> list[tuple[ToolDescriptor, Any]]:
    from langchain_core.tools import tool
    entries = []
    specs: list[tuple[str, Callable[..., Any], str]] = [
        ("transcribe_asset", transcribe_asset, "Whisper"),
        ("recognize_asset", recognize_asset, "TrOCR"),
        ("synthesize_speech", synthesize_speech, "gTTS"),
        ("rank_literature", rank_literature, "sentence-transformers"),
    ]
    for name, function, engine in specs:
        handler = tool(function)
        schema = handler.get_input_schema()
        input_schema = schema.model_json_schema() if hasattr(schema, "model_json_schema") else schema.schema()
        entries.append((ToolDescriptor(id=f"core.{name.replace('_', '-')}", name=name,
            description=function.__doc__ or name, origin=CatalogOrigin(type=OriginType.CORE,id="gnosi"),
            input_schema=input_schema, output_schema={"type":"object"},
            confirmation=ConfirmationPolicy.EXPLICIT_REQUEST if name == "synthesize_speech" else ConfirmationPolicy.NONE,
            effects=[ToolEffect.LOCAL_WRITE, ToolEffect.DATA_EGRESS] if name == "synthesize_speech" else [ToolEffect.READ], minimum_role="editor" if name == "synthesize_speech" else "viewer", metadata={"specialized_engine":engine}), handler))
    return entries


def register_engines(register: Callable[[ToolDescriptor, Any], Any]) -> None:
    for descriptor, handler in registrations():
        register(descriptor, handler)
