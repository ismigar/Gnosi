"""Durable jobs, provenance manifests, and evidence snapshots for LLM Wiki."""

from __future__ import annotations

import hashlib
import json
import threading
import time
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Optional

from backend.domains.llm_wiki import legacy_ports
from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.registry.records import is_record
from backend.utils.open_values import float_value, get_value
from backend.utils.safe_io import safe_write_json

_LOCK = threading.RLock()
_JOBS: dict[str, dict[str, object]] = {}
_RUNNING_BY_RESOURCE: dict[tuple[str, str], str] = {}
_PAGE_STATE_CACHE: dict[str, tuple[int, int, dict[str, object]]] = {}

PAGE_STATE_VERSION = 1
MANAGED_METADATA_PREFIX = "llm_wiki_"


def _string_record(value: object) -> dict[str, object] | None:
    """Return a JSON object with textual keys without coercing malformed input."""
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        return None
    return {key: item for key, item in value.items() if isinstance(key, str)}


def _safe_component(value: object) -> str:
    raw = str(value or "").strip()
    cleaned = "".join(ch for ch in raw if ch.isalnum() or ch in {"-", "_"})
    return cleaned[:120] or "unknown"


def _vault_key() -> str:
    return hashlib.sha256(str(legacy_ports.path_for("VAULT")).encode("utf-8")).hexdigest()[:16]


def local_root() -> Path:
    root = legacy_ports.path_for("LOCAL_DATA") / "llm_wiki" / _vault_key()
    root.mkdir(parents=True, exist_ok=True)
    return root


def synced_root() -> Path:
    root = legacy_ports.path_for("GNOSI_CONFIG") / "llm_wiki"
    root.mkdir(parents=True, exist_ok=True)
    return root


def page_state_path(page_id: str) -> Path:
    """Return the synchronized sidecar path for one managed Brain page."""
    return synced_root() / "pages" / f"{_safe_component(page_id)}.json"


def _legacy_page_state(metadata: object) -> dict[str, object]:
    source = metadata if is_record(metadata) else {}
    state = {
        str(key): deepcopy(value)
        for key, value in source.items()
        if str(key).startswith(MANAGED_METADATA_PREFIX)
    }
    if state and "note_type" in source:
        state["note_type"] = deepcopy(source["note_type"])
    return state


def _read_page_state(path: Path) -> dict[str, object]:
    try:
        stat = path.stat()
    except OSError:
        _PAGE_STATE_CACHE.pop(str(path), None)
        return {}
    cache_key = str(path)
    cached = _PAGE_STATE_CACHE.get(cache_key)
    signature = (stat.st_mtime_ns, stat.st_size)
    if cached and cached[:2] == signature:
        return deepcopy(cached[2])
    payload = _read_json(path)
    raw_state = payload.get("metadata") if isinstance(payload, dict) else None
    state: dict[str, object] = raw_state if isinstance(raw_state, dict) else {}
    clean_state = {str(key): deepcopy(value) for key, value in state.items()}
    _PAGE_STATE_CACHE[cache_key] = (*signature, clean_state)
    return deepcopy(clean_state)


def load_page_state(
    page_id: str,
    legacy_metadata: object = None,
) -> dict[str, object]:
    """Load managed metadata, falling back to legacy Markdown frontmatter."""
    try:
        stored = _read_page_state(page_state_path(page_id)) if page_id else {}
    except (KeyError, RuntimeError, TypeError):
        stored = {}
    return {**_legacy_page_state(legacy_metadata), **stored}


def merge_page_metadata(
    metadata: object,
    page_id: str = "",
) -> PageMetadata:
    """Overlay synchronized managed state onto portable page metadata."""
    merged = deepcopy(metadata) if is_record(metadata) else {}
    resolved_id = str(page_id or merged.get("id") or "")
    if resolved_id:
        merged.update(load_page_state(resolved_id, merged))
    return merged


def page_metadata(page: object) -> PageMetadata:
    """Return one page's visible metadata plus its managed sidecar state."""
    raw: object = (
        page.get("metadata") if is_record(page) else getattr(page, "metadata", None)
    ) or {}
    page_id = (page.get("id") if is_record(page) else getattr(page, "id", "")) or get_value(
        raw, "id"
    )
    return merge_page_metadata(raw, str(page_id or ""))


def prepare_managed_markdown(metadata: PageMetadata) -> PageMetadata:
    """Persist managed state and return portable Markdown frontmatter.

    The sidecar is written before the caller rewrites the Markdown file. A
    failure can therefore leave legacy metadata in the document, but never
    removes the only durable copy of the managed state.
    """
    portable = deepcopy(metadata)
    page_id = str(portable.get("id") or "")
    legacy_state = _legacy_page_state(portable)
    if not page_id or (not legacy_state and not load_page_state(page_id)):
        return portable

    with _LOCK:
        stored_state = load_page_state(page_id)
        state = {**stored_state, **legacy_state}
        path = page_state_path(page_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": PAGE_STATE_VERSION,
            "page_id": page_id,
            "metadata": state,
        }
        safe_write_json(path, payload, indent=2, ensure_ascii=False)
        try:
            stat = path.stat()
            _PAGE_STATE_CACHE[str(path)] = (
                stat.st_mtime_ns,
                stat.st_size,
                deepcopy(state),
            )
        except OSError:
            _PAGE_STATE_CACHE.pop(str(path), None)

    for key in list(portable):
        if str(key).startswith(MANAGED_METADATA_PREFIX):
            portable.pop(key, None)
    portable.pop("note_type", None)
    return portable


def _job_path(job_id: str) -> Path:
    return local_root() / "jobs" / f"{_safe_component(job_id)}.json"


def _latest_path(source_table_id: str, resource_id: str) -> Path:
    return (
        local_root()
        / "latest"
        / _safe_component(source_table_id)
        / f"{_safe_component(resource_id)}.json"
    )


def create_job(source_table_id: str, resource_id: str) -> dict[str, object]:
    """Create and persist a running job, enforcing one worker per resource."""
    key = (str(source_table_id), str(resource_id))
    with _LOCK:
        running_id = _RUNNING_BY_RESOURCE.get(key)
        if running_id:
            return deepcopy(_JOBS[running_id])
        now = time.time()
        job: dict[str, object] = {
            "job_id": str(uuid.uuid4()),
            "source_table_id": key[0],
            "resource_id": key[1],
            "running": True,
            "phase": "reading",
            "progress": 0,
            "origins_total": 0,
            "origins_done": 0,
            "chunks_total": 0,
            "chunks_done": 0,
            "pages_touched": 0,
            "created": [],
            "updated": [],
            "model": None,
            "warnings": [],
            "error": None,
            "started_at": now,
            "updated_at": now,
            "finished_at": None,
        }
        job_id = str(job["job_id"])
        _JOBS[job_id] = job
        _RUNNING_BY_RESOURCE[key] = job_id
        _persist_job(job)
        return deepcopy(job)


def _persist_job(job: dict[str, object]) -> None:
    job_path = _job_path(str(job["job_id"]))
    job_path.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(job_path, job, indent=2, ensure_ascii=False)
    latest = _latest_path(str(job["source_table_id"]), str(job["resource_id"]))
    latest.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(
        latest,
        {"job_id": job["job_id"], "updated_at": job.get("updated_at")},
        indent=2,
        ensure_ascii=False,
    )


def update_job(job_id: str, **fields: object) -> dict[str, object]:
    with _LOCK:
        job = _JOBS.get(job_id) or _read_json(_job_path(job_id))
        if not isinstance(job, dict) or not job.get("job_id"):
            raise KeyError(job_id)
        job.update(fields)
        job["updated_at"] = time.time()
        _JOBS[job_id] = job
        _persist_job(job)
        return deepcopy(job)


def finish_job(
    job_id: str, *, phase: str, error: Optional[str] = None, **fields: object
) -> dict[str, object]:
    fields.update(
        {
            "running": False,
            "phase": phase,
            "error": error,
            "finished_at": time.time(),
            "progress": 100 if phase == "done" else fields.get("progress", 100),
        }
    )
    job = update_job(job_id, **fields)
    key = (str(job.get("source_table_id")), str(job.get("resource_id")))
    with _LOCK:
        if _RUNNING_BY_RESOURCE.get(key) == job_id:
            _RUNNING_BY_RESOURCE.pop(key, None)
    return job


def is_running(source_table_id: str, resource_id: str) -> bool:
    with _LOCK:
        return (str(source_table_id), str(resource_id)) in _RUNNING_BY_RESOURCE


def get_job_status(identifier: str, source_table_id: str = "") -> dict[str, object]:
    """Return a job by id or the latest job for a resource id.

    A persisted job left as ``running`` by a previous backend process is
    exposed as ``partial`` so the UI can explicitly resume/reprocess it.
    """
    wanted = str(identifier or "").strip()
    with _LOCK:
        job = deepcopy(_JOBS.get(wanted)) if wanted in _JOBS else None
        if job is None and source_table_id:
            latest = _read_json(_latest_path(source_table_id, wanted))
            job_id = str(latest.get("job_id") or "") if is_record(latest) else ""
            job = (
                deepcopy(_JOBS[job_id])
                if job_id in _JOBS
                else _string_record(_read_json(_job_path(job_id)))
            )
        if job is None:
            # Compatibility lookup for the old status/{resource_id} endpoint.
            latest_dir = local_root() / "latest"
            if latest_dir.exists():
                for candidate in latest_dir.glob(f"*/{_safe_component(wanted)}.json"):
                    latest = _read_json(candidate)
                    job_id = str(latest.get("job_id") or "") if is_record(latest) else ""
                    candidate_job = _string_record(_read_json(_job_path(job_id)))
                    if candidate_job is not None and (
                        job is None
                        or float_value(candidate_job.get("updated_at") or 0)
                        > float_value(job.get("updated_at") or 0)
                    ):
                        job = candidate_job
        if not job:
            return {"resource_id": wanted, "running": False, "phase": "idle", "progress": 0}
        key = (str(job.get("source_table_id")), str(job.get("resource_id")))
        if job.get("running") and _RUNNING_BY_RESOURCE.get(key) != job.get("job_id"):
            job = {
                **job,
                "running": False,
                "phase": "partial",
                "error": job.get("error")
                or "The previous backend process stopped before the job finished.",
            }
        return deepcopy(job)


def save_checkpoint(job_id: str, name: str, payload: object) -> Path:
    path = local_root() / "checkpoints" / _safe_component(job_id) / f"{_safe_component(name)}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(path, payload, indent=2, ensure_ascii=False)
    return path


def load_checkpoint(job_id: str, name: str) -> object:
    return _read_json(
        local_root() / "checkpoints" / _safe_component(job_id) / f"{_safe_component(name)}.json"
    )


def save_snapshot(
    source_table_id: str,
    resource_id: str,
    origin: dict[str, object],
) -> dict[str, object]:
    """Persist normalized evidence and return its stable snapshot descriptor."""
    stable_payload = {
        "kind": origin.get("kind"),
        "label": origin.get("label"),
        "source_url": origin.get("source_url"),
        "content_hash": origin.get("content_hash"),
        "segments": origin.get("segments") or [],
    }
    raw = json.dumps(stable_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    snapshot_id = hashlib.sha256(raw).hexdigest()
    path = (
        synced_root()
        / "sources"
        / _safe_component(source_table_id)
        / _safe_component(resource_id)
        / f"{snapshot_id}.json"
    )
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        safe_write_json(
            path,
            {
                "snapshot_id": snapshot_id,
                "source_table_id": source_table_id,
                "resource_id": resource_id,
                "captured_at": time.time(),
                **stable_payload,
            },
            indent=2,
            ensure_ascii=False,
        )
    return {
        "snapshot_id": snapshot_id,
        "kind": origin.get("kind"),
        "label": origin.get("label"),
        "source_url": origin.get("source_url"),
        "content_hash": origin.get("content_hash"),
    }


def manifest_path(source_table_id: str, resource_id: str) -> Path:
    return (
        synced_root()
        / "manifests"
        / _safe_component(source_table_id)
        / f"{_safe_component(resource_id)}.json"
    )


def load_manifest(source_table_id: str, resource_id: str) -> dict[str, object]:
    data = _read_json(manifest_path(source_table_id, resource_id))
    return data if isinstance(data, dict) else {}


def processed_resources(source_table_ids: list[str]) -> dict[str, dict[str, object]]:
    """Return manifest-backed processed timestamps grouped by source table."""
    out: dict[str, dict[str, object]] = {}
    manifests_root = synced_root() / "manifests"
    for source_table_id in source_table_ids:
        table_items: dict[str, object] = {}
        table_root = manifests_root / _safe_component(source_table_id)
        for path in table_root.glob("*.json") if table_root.exists() else []:
            manifest = _read_json(path)
            resource_id = str(manifest.get("resource_id") or "") if is_record(manifest) else ""
            if resource_id:
                table_items[resource_id] = get_value(manifest, "updated_at")
        out[str(source_table_id)] = table_items
    return out


def resource_statuses(source_table_ids: list[str]) -> dict[str, dict[str, dict[str, object]]]:
    """Return the latest durable job summary for each configured resource."""
    out: dict[str, dict[str, dict[str, object]]] = {}
    latest_root = local_root() / "latest"
    for source_table_id in source_table_ids:
        table_items: dict[str, dict[str, object]] = {}
        table_root = latest_root / _safe_component(source_table_id)
        for path in table_root.glob("*.json") if table_root.exists() else []:
            latest = _read_json(path)
            job_id = str(latest.get("job_id") or "") if is_record(latest) else ""
            status = get_job_status(job_id) if job_id else {}
            resource_id = str(status.get("resource_id") or "")
            if resource_id:
                table_items[resource_id] = status
        out[str(source_table_id)] = table_items
    return out


def save_manifest(source_table_id: str, resource_id: str, manifest: dict[str, object]) -> None:
    path = manifest_path(source_table_id, resource_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(path, manifest, indent=2, ensure_ascii=False)


def load_evidence(
    resource_id: str, snapshot_id: str, segment_id: str
) -> Optional[dict[str, object]]:
    """Resolve a citation without trusting a client-supplied filesystem path."""
    wanted_resource = _safe_component(resource_id)
    wanted_snapshot = _safe_component(snapshot_id)
    base = synced_root() / "sources"
    if not base.exists():
        return None
    for path in base.glob(f"*/{wanted_resource}/{wanted_snapshot}.json"):
        payload = _read_json(path)
        if not isinstance(payload, dict):
            continue
        segment = next(
            (
                item
                for item in payload.get("segments") or []
                if isinstance(item, dict) and str(item.get("id") or "") == str(segment_id)
            ),
            None,
        )
        if segment:
            return {
                "snapshot_id": payload.get("snapshot_id"),
                "resource_id": payload.get("resource_id"),
                "kind": payload.get("kind"),
                "label": payload.get("label"),
                "source_url": payload.get("source_url"),
                "segment": segment,
            }
    return None


def _read_json(path: Path) -> object:
    if not path or not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
