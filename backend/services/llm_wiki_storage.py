"""Durable jobs, provenance manifests, and evidence snapshots for LLM Wiki."""
from __future__ import annotations

import hashlib
import json
import threading
import time
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any, Optional

from backend.utils.safe_io import safe_write_json

_LOCK = threading.RLock()
_JOBS: dict[str, dict[str, Any]] = {}
_RUNNING_BY_RESOURCE: dict[tuple[str, str], str] = {}


def _safe_component(value: Any) -> str:
    raw = str(value or "").strip()
    cleaned = "".join(ch for ch in raw if ch.isalnum() or ch in {"-", "_"})
    return cleaned[:120] or "unknown"


def _vault_key() -> str:
    from backend.api.vault_routes import get_p

    return hashlib.sha256(str(get_p("VAULT")).encode("utf-8")).hexdigest()[:16]


def local_root() -> Path:
    from backend.api.vault_routes import get_p

    root = get_p("LOCAL_DATA") / "llm_wiki" / _vault_key()
    root.mkdir(parents=True, exist_ok=True)
    return root


def synced_root() -> Path:
    from backend.api.vault_routes import get_p

    root = get_p("GNOSI_CONFIG") / "llm_wiki"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _job_path(job_id: str) -> Path:
    return local_root() / "jobs" / f"{_safe_component(job_id)}.json"


def _latest_path(source_table_id: str, resource_id: str) -> Path:
    return (
        local_root()
        / "latest"
        / _safe_component(source_table_id)
        / f"{_safe_component(resource_id)}.json"
    )


def create_job(source_table_id: str, resource_id: str) -> dict[str, Any]:
    """Create and persist a running job, enforcing one worker per resource."""
    key = (str(source_table_id), str(resource_id))
    with _LOCK:
        running_id = _RUNNING_BY_RESOURCE.get(key)
        if running_id:
            return deepcopy(_JOBS[running_id])
        now = time.time()
        job = {
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
        _JOBS[job["job_id"]] = job
        _RUNNING_BY_RESOURCE[key] = job["job_id"]
        _persist_job(job)
        return deepcopy(job)


def _persist_job(job: dict[str, Any]) -> None:
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


def update_job(job_id: str, **fields: Any) -> dict[str, Any]:
    with _LOCK:
        job = _JOBS.get(job_id) or _read_json(_job_path(job_id))
        if not isinstance(job, dict) or not job.get("job_id"):
            raise KeyError(job_id)
        job.update(fields)
        job["updated_at"] = time.time()
        _JOBS[job_id] = job
        _persist_job(job)
        return deepcopy(job)


def finish_job(job_id: str, *, phase: str, error: Optional[str] = None, **fields: Any) -> dict[str, Any]:
    fields.update({
        "running": False,
        "phase": phase,
        "error": error,
        "finished_at": time.time(),
        "progress": 100 if phase == "done" else fields.get("progress", 100),
    })
    job = update_job(job_id, **fields)
    key = (str(job.get("source_table_id")), str(job.get("resource_id")))
    with _LOCK:
        if _RUNNING_BY_RESOURCE.get(key) == job_id:
            _RUNNING_BY_RESOURCE.pop(key, None)
    return job


def is_running(source_table_id: str, resource_id: str) -> bool:
    with _LOCK:
        return (str(source_table_id), str(resource_id)) in _RUNNING_BY_RESOURCE


def get_job_status(identifier: str, source_table_id: str = "") -> dict[str, Any]:
    """Return a job by id or the latest job for a resource id.

    A persisted job left as ``running`` by a previous backend process is
    exposed as ``partial`` so the UI can explicitly resume/reprocess it.
    """
    wanted = str(identifier or "").strip()
    with _LOCK:
        job = deepcopy(_JOBS.get(wanted)) if wanted in _JOBS else None
        if job is None and source_table_id:
            latest = _read_json(_latest_path(source_table_id, wanted))
            job_id = str((latest or {}).get("job_id") or "")
            job = deepcopy(_JOBS.get(job_id)) if job_id in _JOBS else _read_json(_job_path(job_id))
        if job is None:
            # Compatibility lookup for the old status/{resource_id} endpoint.
            latest_dir = local_root() / "latest"
            if latest_dir.exists():
                for candidate in latest_dir.glob(f"*/{_safe_component(wanted)}.json"):
                    latest = _read_json(candidate)
                    job_id = str((latest or {}).get("job_id") or "")
                    candidate_job = _read_json(_job_path(job_id))
                    if candidate_job and (
                        job is None
                        or float(candidate_job.get("updated_at") or 0) > float(job.get("updated_at") or 0)
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
                "error": job.get("error") or "The previous backend process stopped before the job finished.",
            }
        return deepcopy(job)


def save_checkpoint(job_id: str, name: str, payload: Any) -> Path:
    path = local_root() / "checkpoints" / _safe_component(job_id) / f"{_safe_component(name)}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(path, payload, indent=2, ensure_ascii=False)
    return path


def load_checkpoint(job_id: str, name: str) -> Any:
    return _read_json(
        local_root() / "checkpoints" / _safe_component(job_id) / f"{_safe_component(name)}.json"
    )


def save_snapshot(
    source_table_id: str,
    resource_id: str,
    origin: dict[str, Any],
) -> dict[str, Any]:
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


def load_manifest(source_table_id: str, resource_id: str) -> dict[str, Any]:
    data = _read_json(manifest_path(source_table_id, resource_id))
    return data if isinstance(data, dict) else {}


def processed_resources(source_table_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Return manifest-backed processed timestamps grouped by source table."""
    out: dict[str, dict[str, Any]] = {}
    manifests_root = synced_root() / "manifests"
    for source_table_id in source_table_ids:
        table_items: dict[str, Any] = {}
        table_root = manifests_root / _safe_component(source_table_id)
        for path in table_root.glob("*.json") if table_root.exists() else []:
            manifest = _read_json(path)
            resource_id = str((manifest or {}).get("resource_id") or "")
            if resource_id:
                table_items[resource_id] = (manifest or {}).get("updated_at")
        out[str(source_table_id)] = table_items
    return out


def resource_statuses(source_table_ids: list[str]) -> dict[str, dict[str, dict[str, Any]]]:
    """Return the latest durable job summary for each configured resource."""
    out: dict[str, dict[str, dict[str, Any]]] = {}
    latest_root = local_root() / "latest"
    for source_table_id in source_table_ids:
        table_items: dict[str, dict[str, Any]] = {}
        table_root = latest_root / _safe_component(source_table_id)
        for path in table_root.glob("*.json") if table_root.exists() else []:
            latest = _read_json(path)
            job_id = str((latest or {}).get("job_id") or "")
            status = get_job_status(job_id) if job_id else {}
            resource_id = str(status.get("resource_id") or "")
            if resource_id:
                table_items[resource_id] = status
        out[str(source_table_id)] = table_items
    return out


def save_manifest(source_table_id: str, resource_id: str, manifest: dict[str, Any]) -> None:
    path = manifest_path(source_table_id, resource_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(path, manifest, indent=2, ensure_ascii=False)


def load_evidence(resource_id: str, snapshot_id: str, segment_id: str) -> Optional[dict[str, Any]]:
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


def _read_json(path: Path) -> Any:
    if not path or not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
