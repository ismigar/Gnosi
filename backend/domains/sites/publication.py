"""Persistent reviewed publication jobs, immutable builds and atomic activation."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import cast

from fastapi import HTTPException
from pydantic import JsonValue

from backend.services.plugin_access import plugins_enabled_now

from . import local_artifacts, runtime
from .exporter import build_bundle
from .models import SiteBundle, SiteChange, SiteConfig, SiteJob, SitePreview, SitePublishRequest, SiteRelease, SiteTarget, identifier, timestamp
from .storage import SiteStore, fingerprint, private_json


_threads: dict[str, threading.Thread] = {}
_thread_lock = threading.Lock()


def require_activation_access(store: SiteStore) -> None:
    """Recheck the approving account and connector immediately before an effect."""
    from .recovery import authorized_context
    if authorized_context(store.context.workspace_id, store.vault, store.context.user_id) is None:
        raise HTTPException(403, "The approving account no longer has publication access")
    if not plugins_enabled_now("web-publishing", vault_path=store.vault):
        raise HTTPException(409, "The website connector is disabled")


def changes(previous: dict[str, JsonValue] | None, bundle: SiteBundle) -> list[SiteChange]:
    prior_records = previous.get("records", []) if previous else []
    prior = {str(record["path"]): record for record in prior_records if isinstance(record, dict)} if isinstance(prior_records, list) else {}
    current = {record.path: record.model_dump(mode="json") for record in bundle.records}
    output = [SiteChange(kind="create" if path not in prior else "update", path=path, title=str(record["title"])) for path, record in current.items() if prior.get(path) != record]
    output.extend(SiteChange(kind="withdraw", path=path, title=str(record.get("title", path))) for path, record in prior.items() if path not in current)
    if not previous or previous.get("site") != bundle.site.model_dump(mode="json"):
        output.append(SiteChange(kind="configuration", path="/", title=bundle.site.name))
    return output


def preview(store: SiteStore, site: SiteConfig, target_id: str) -> SitePreview:
    target = next((t for t in site.targets if t.id == target_id), None)
    if not target or not target.enabled:
        raise HTTPException(409, "Enable and configure the website destination first")
    if target.environment == "production":
        raise HTTPException(409, "Production publication requires pilot validation")
    bundle = build_bundle(store, site, target_id)
    preview_id = identifier()
    expires = datetime.now(timezone.utc) + timedelta(minutes=15)
    previous = store.active_bundle(site.id, target_id)
    response = SitePreview(id=preview_id, site_id=site.id, target_id=target_id, fingerprint=bundle.fingerprint, expires_at=expires.isoformat(), changes=changes(previous, bundle))
    root = store.site_dir(site.id) / "previews" / preview_id
    output = root / "public"
    output.mkdir(parents=True, exist_ok=True)
    # Preview service state is separate from published subscriber and contact data.
    local_site = site.model_copy(deep=True)
    local_site.targets = [t.model_copy(update={"adapter": "local"}) if t.id == target_id else t for t in local_site.targets]
    url = runtime.start_server(store, local_site, target_id, output, preview_id=preview_id)
    rendered = cast(dict[str, JsonValue], bundle.model_dump(mode="json"))
    rendered["deployment_url"] = url
    runtime.render_bundle(rendered, output)
    response.preview_url = url + "/" + site.default_language
    payload = {"preview": response.model_dump(mode="json"), "bundle": bundle.model_dump(mode="json"), "parent_fingerprint": previous.get("fingerprint") if previous else None}
    with store.database() as db:
        db.execute("INSERT INTO previews(id,site_id,user_id,target_id,fingerprint,expires,payload) VALUES(?,?,?,?,?,?,?)", (preview_id, site.id, store.context.user_id, target_id, bundle.fingerprint, expires.timestamp(), json.dumps(payload)))
    return response


def _save_job(store: SiteStore, job: SiteJob) -> None:
    job.updated_at = timestamp()
    with store.database() as db:
        db.execute("INSERT INTO jobs(id,site_id,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", (job.id, job.site_id, job.model_dump_json()))


def _phase(store: SiteStore, job: SiteJob, phase: str) -> None:
    with store.database() as db:
        row = db.execute("SELECT payload FROM jobs WHERE id=? AND site_id=?", (job.id, job.site_id)).fetchone()
    if row and SiteJob.model_validate_json(row["payload"]).status == "cancelled":
        raise HTTPException(409, "Publication cancelled")
    job.phase = phase
    _save_job(store, job)


def enqueue(store: SiteStore, site: SiteConfig, request: SitePublishRequest) -> SiteJob:
    with store.database() as db:
        row = db.execute("SELECT * FROM previews WHERE id=? AND site_id=? AND user_id=?", (request.preview_id, site.id, store.context.user_id)).fetchone()
        if not row or row["expires"] < time.time() or row["consumed"]:
            raise HTTPException(409, "Review a new publication preview")
        pending: dict[str, JsonValue] = json.loads(row["payload"])
    bundle = SiteBundle.model_validate(pending["bundle"])
    current = build_bundle(store, site, row["target_id"])
    if current.fingerprint != bundle.fingerprint:
        raise HTTPException(409, "The selected content or configuration changed; review a new preview")
    previous = store.active_bundle(site.id, row["target_id"])
    if (previous.get("fingerprint") if previous else None) != pending.get("parent_fingerprint"):
        raise HTTPException(409, "The published website changed; review a new preview")
    scheduled: str | None = None
    if request.scheduled_at:
        try:
            when = datetime.fromisoformat(request.scheduled_at.replace("Z", "+00:00"))
            if when.tzinfo is None or when <= datetime.now(timezone.utc):
                raise ValueError("Invalid schedule")
            scheduled = when.isoformat()
        except ValueError:
            raise HTTPException(422, "Choose a future publication time with timezone") from None
    job = SiteJob(id=identifier(), site_id=site.id, target_id=row["target_id"], scheduled_at=scheduled)
    request_path = store.site_dir(site.id) / "jobs" / (job.id + ".json")
    private_json(store.private_root / "scope.json", {"schema_version": 1, "workspace_id": store.context.workspace_id, "vault_path": str(store.vault)})
    private_json(request_path, {"bundle": bundle.model_dump(mode="json"), "parent_fingerprint": pending.get("parent_fingerprint"), "user_id": store.context.user_id, "preview_id": request.preview_id})
    with store.database() as db:
        changed = db.execute("UPDATE previews SET consumed=1 WHERE id=? AND consumed=0", (request.preview_id,)).rowcount
        if changed != 1:
            raise HTTPException(409, "This publication preview was already used")
        if db.execute("SELECT 1 FROM locks WHERE site_id=?", (site.id,)).fetchone():
            raise HTTPException(409, "Another website publication is already running")
        db.execute("INSERT INTO jobs VALUES (?,?,?)", (job.id, site.id, job.model_dump_json()))
    dispatch(store, job)
    return job


def _approving_store(store: SiteStore, request: dict[str, JsonValue]) -> SiteStore:
    from .recovery import authorized_context
    authorized = authorized_context(store.context.workspace_id, store.vault, str(request["user_id"]))
    if authorized is None:
        raise HTTPException(403, "The approving account no longer has publication access")
    if store.context.user_id != authorized.user_id or store.context.role != authorized.role:
        return SiteStore(authorized)
    return store


def _wait_for_schedule(store: SiteStore, job: SiteJob) -> bool:
    if not job.scheduled_at:
        return True
    delay = datetime.fromisoformat(job.scheduled_at).timestamp() - time.time()
    while delay > 0:
        time.sleep(min(delay, 1))
        with store.database() as db:
            row = db.execute("SELECT payload FROM jobs WHERE id=?", (job.id,)).fetchone()
        if not row or SiteJob.model_validate_json(row["payload"]).status == "cancelled":
            return False
        delay = datetime.fromisoformat(job.scheduled_at).timestamp() - time.time()
    return True


def _claim_job(store: SiteStore, job: SiteJob) -> bool:
    with store.database() as db:
        state = db.execute("SELECT payload FROM jobs WHERE id=? AND site_id=?", (job.id, job.site_id)).fetchone()
        if not state or SiteJob.model_validate_json(state["payload"]).status != "queued":
            return False
        if db.execute("SELECT 1 FROM locks WHERE site_id=?", (job.site_id,)).fetchone():
            raise HTTPException(409, "Another website publication is already running")
        db.execute("INSERT INTO locks VALUES (?,?)", (job.site_id, job.id))
        job.status = "running"
        db.execute("UPDATE jobs SET payload=? WHERE id=?", (job.model_dump_json(), job.id))
    return True


def _reviewed_work(store: SiteStore, job: SiteJob, request: dict[str, JsonValue]) -> tuple[SiteConfig, SiteTarget, SiteBundle]:
    _phase(store, job, "prepare")
    reviewed = SiteBundle.model_validate(request["bundle"])
    site = store.load(job.site_id)
    target = next(t for t in site.targets if t.id == job.target_id)
    if target.environment == "production" or not target.enabled:
        raise HTTPException(409, "The publication destination is not enabled for tests")
    if build_bundle(store, site, job.target_id).fingerprint != reviewed.fingerprint:
        raise HTTPException(409, "The reviewed content changed before publication")
    previous = store.active_bundle(site.id, job.target_id)
    if (previous.get("fingerprint") if previous else None) != request.get("parent_fingerprint"):
        raise HTTPException(409, "The active website changed before publication")
    return site, target, reviewed


def _build_release(store: SiteStore, job: SiteJob, site: SiteConfig, target: SiteTarget, reviewed: SiteBundle) -> tuple[str, Path, str]:
    release_id = identifier()
    output = local_artifacts.prepare(store, site.id, release_id)
    _phase(store, job, "build")
    rendered = cast(dict[str, JsonValue], reviewed.model_dump(mode="json"))
    deployment_url = "http://127.0.0.1:" + str(runtime.connection(store, site.id, target.id).local_port) if target.adapter == "local" else target.base_url
    rendered["deployment_url"] = deployment_url
    runtime.render_bundle(rendered, output)
    _phase(store, job, "verify")
    local_artifacts.seal(store, site.id, release_id)
    return release_id, output, deployment_url


def _release_receipt(store: SiteStore, job: SiteJob, site: SiteConfig, target: SiteTarget, reviewed: SiteBundle, release_id: str) -> tuple[SiteRelease, str | None]:
    release = SiteRelease(id=release_id, site_id=site.id, target_id=target.id, created_at=timestamp(), fingerprint=reviewed.fingerprint, current=False, url=target.base_url)
    with store.database() as db:
        row = db.execute("SELECT release_id FROM active WHERE site_id=? AND target_id=?", (site.id, target.id)).fetchone()
        db.execute("INSERT INTO releases VALUES (?,?,?,?,?)", (release.id, site.id, target.id, release.model_dump_json(), reviewed.model_dump_json()))
    job.release_id = release.id
    _save_job(store, job)
    return release, str(row["release_id"]) if row else None


def _activate_release(store: SiteStore, job: SiteJob, site: SiteConfig, target: SiteTarget, release: SiteRelease, output: Path, parent_id: str | None, deployment_url: str) -> str:
    guard = lambda: require_activation_access(store)
    if target.adapter == "local":
        local_artifacts.activate(store, site.id, target.id, release.id, parent_id, guard)
        return deployment_url
    url = runtime.upload_release(store, site, target, release.id, output, parent_id, activation_guard=guard)
    from .private_service import service_root
    worker_state = service_root(store, site.id, target.id) / "worker-start.json"
    if worker_state.is_file() and json.loads(worker_state.read_text()).get("error"):
        job.error = "worker_start_pending"
    return url


def _complete_release(store: SiteStore, job: SiteJob, site: SiteConfig, target: SiteTarget, release: SiteRelease, reviewed: SiteBundle, url: str) -> None:
    release.current = True
    release.url = url
    with store.database() as db:
        db.execute("UPDATE releases SET payload=? WHERE id=? AND site_id=?", (release.model_dump_json(), release.id, site.id))
        db.execute("INSERT INTO active VALUES (?,?,?) ON CONFLICT(site_id,target_id) DO UPDATE SET release_id=excluded.release_id", (site.id, target.id, release.id))
    # A service failure cannot undo an already activated static website.
    try:
        from .private_service import invoke
        invoke(store, site, "forms_sync", {"forms": cast(JsonValue, [form.model_dump(mode="json") for form in reviewed.site.forms])}, target.id, internal=True)
    except HTTPException:
        job.error = job.error or "forms_service_sync_pending"
    job.status = "completed"
    job.phase = "completed"
    _save_job(store, job)


def _fail_job(store: SiteStore, job: SiteJob) -> None:
    with store.database() as db:
        last = db.execute("SELECT payload FROM jobs WHERE id=? AND site_id=?", (job.id, job.site_id)).fetchone()
    cancelled = last and SiteJob.model_validate_json(last["payload"]).status == "cancelled"
    job.status = "cancelled" if cancelled else "failed"
    job.error = None if cancelled else "publication_failed_review_status"
    job.phase = "cancelled" if cancelled else "failed"
    _save_job(store, job)


def _run(store: SiteStore, job: SiteJob) -> None:
    claimed = False
    try:
        request = cast(dict[str, JsonValue], json.loads((store.site_dir(job.site_id) / "jobs" / (job.id + ".json")).read_text()))
        store = _approving_store(store, request)
        if not _wait_for_schedule(store, job):
            return
        require_activation_access(store)
        if not _claim_job(store, job):
            return
        claimed = True
        private_json(store.site_dir(job.site_id) / "jobs" / (job.id + ".runner.json"), {"pid": os.getpid()})
        site, target, reviewed = _reviewed_work(store, job, request)
        release_id, output, deployment_url = _build_release(store, job, site, target, reviewed)
        _phase(store, job, "activate")
        require_activation_access(store)
        release, parent_id = _release_receipt(store, job, site, target, reviewed, release_id)
        url = _activate_release(store, job, site, target, release, output, parent_id, deployment_url)
        _complete_release(store, job, site, target, release, reviewed, url)
    except Exception:
        _fail_job(store, job)
    finally:
        if claimed:
            with store.database() as db:
                db.execute("DELETE FROM locks WHERE site_id=? AND job_id=?", (job.site_id, job.id))
        with _thread_lock:
            _threads.pop(str(store.private_root) + job.id, None)


def dispatch(store: SiteStore, job: SiteJob) -> None:
    key = str(store.private_root) + job.id
    with _thread_lock:
        if key in _threads:
            return
        thread = threading.Thread(target=_run, args=(store, job), daemon=True, name="website-" + job.id)
        _threads[key] = thread
        thread.start()


def jobs(store: SiteStore, site_id: str) -> list[SiteJob]:
    result = [SiteJob.model_validate(row) for row in store.json_rows("jobs", site_id)]
    for job in result:
        key = str(store.private_root) + job.id
        if job.status == "queued":
            dispatch(store, job)
        elif job.status == "running" and key not in _threads:
            runner_path = store.site_dir(site_id) / "jobs" / (job.id + ".runner.json")
            try:
                owner = json.loads(runner_path.read_text())
                os.kill(int(owner["pid"]), 0)
                continue
            except (OSError, ValueError, KeyError):
                pass
            # Unknown activation results require a human/status reconciliation, never replay.
            job.status = "interrupted"
            job.error = "publication_interrupted_check_active_release"
            _save_job(store, job)
            with store.database() as db:
                db.execute("DELETE FROM locks WHERE site_id=? AND job_id=?", (site_id, job.id))
        if job.status in {"failed", "interrupted"} and job.release_id:
            site = store.load(site_id)
            target = next((target for target in site.targets if target.id == job.target_id), None)
            try:
                if target and runtime.active_release(store, site, target) == job.release_id:
                    with store.database() as db:
                        receipt = db.execute("SELECT 1 FROM releases WHERE id=? AND site_id=?", (job.release_id, site_id)).fetchone()
                        if not receipt:
                            raise HTTPException(409, "The active release has no publication receipt")
                        db.execute("INSERT INTO active VALUES (?,?,?) ON CONFLICT(site_id,target_id) DO UPDATE SET release_id=excluded.release_id", (site_id, job.target_id, job.release_id))
                    job.status = "completed"
                    job.phase = "completed"
                    job.error = None
                    _save_job(store, job)
            except (HTTPException, OSError, ValueError):
                pass
    return result


def releases(store: SiteStore, site_id: str) -> list[SiteRelease]:
    result = [SiteRelease.model_validate(row) for row in store.json_rows("releases", site_id)]
    with store.database() as db:
        active = {str(row["release_id"]) for row in db.execute("SELECT release_id FROM active WHERE site_id=?", (site_id,)).fetchall()}
    for release in result:
        release.current = release.id in active
    return result


def cancel(store: SiteStore, site_id: str, job_id: str) -> SiteJob:
    with store.database() as db:
        row = db.execute("SELECT payload FROM jobs WHERE id=? AND site_id=?", (job_id, site_id)).fetchone()
        if not row:
            raise HTTPException(404, "Publication task not found")
        job = SiteJob.model_validate_json(row["payload"])
        if job.status not in {"queued", "running", "interrupted"} or job.phase in {"activate", "completed"}:
            raise HTTPException(409, "This publication task cannot be cancelled")
        job.status = "cancelled"
        db.execute("UPDATE jobs SET payload=? WHERE id=?", (job.model_dump_json(), job.id))
    return job


def rollback(store: SiteStore, site: SiteConfig, release_id: str) -> SiteRelease:
    with store.database() as db:
        row = db.execute("SELECT payload,bundle FROM releases WHERE id=? AND site_id=?", (release_id, site.id)).fetchone()
        if not row:
            raise HTTPException(404, "Website version not found")
        if db.execute("SELECT 1 FROM locks WHERE site_id=?", (site.id,)).fetchone():
            raise HTTPException(409, "Another publication is running")
        db.execute("INSERT INTO locks VALUES (?,?)", (site.id, "rollback"))
    try:
        release = SiteRelease.model_validate_json(row["payload"])
        target = next(t for t in site.targets if t.id == release.target_id)
        if target.environment == "production":
            raise HTTPException(409, "Production restoration requires pilot validation")
        with store.database() as db:
            current = db.execute("SELECT release_id FROM active WHERE site_id=? AND target_id=?", (site.id, target.id)).fetchone()
        parent_id = str(current["release_id"]) if current else None
        if target.adapter in {"ssh", "legacy-pangea"}:
            runtime.restore_remote_release(store, site, target, release.id, parent_id, activation_guard=lambda: require_activation_access(store))
        else:
            local_artifacts.activate(store, site.id, target.id, release.id, parent_id, lambda: require_activation_access(store))
        with store.database() as db:
            db.execute("INSERT INTO active VALUES (?,?,?) ON CONFLICT(site_id,target_id) DO UPDATE SET release_id=excluded.release_id", (site.id, target.id, release.id))
        restored = SiteBundle.model_validate_json(row["bundle"])
        from .private_service import invoke
        invoke(store, site, "forms_sync", {"forms": cast(JsonValue, [form.model_dump(mode="json") for form in restored.site.forms])}, target.id, internal=True)
        release.current = True
        return release
    finally:
        with store.database() as db:
            db.execute("DELETE FROM locks WHERE site_id=? AND job_id='rollback'", (site.id,))
