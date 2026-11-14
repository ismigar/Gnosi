"""Isolate complete local previews from competing application Python threads.

Only preview construction is accepted. Confirmation/publication remain in their
existing authorization path. Owned descriptors, process groups and nonce-bound
preview directories make interruption cleanup independent of a blocked worker.
"""
from __future__ import annotations

from contextvars import ContextVar
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
from typing import TYPE_CHECKING
from uuid import uuid4

import psutil
from fastapi import HTTPException

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from backend.utils import bounded_file_io

if TYPE_CHECKING:
    from .models import SiteConfig, SitePreview
    from .record_publication import RecordPublicationReview
    from .storage import SiteStore

in_worker: ContextVar[bool] = ContextVar("website_preview_worker", default=False)
preview_identity: ContextVar[str | None] = ContextVar("website_preview_identity", default=None)
_LIMIT = 8 * 1024 * 1024
_DEADLINE = 330.0
_HEARTBEAT_TIMEOUT = 10.0


class _OwnedReader(bounded_file_io.Reader):
    """Read in this isolated process; a stuck read terminates its owned group."""

    def __init__(self) -> None:
        if os.getpgrp() != os.getpid():
            raise ValueError("A private preview process group is required")
        super().__init__()
        self.deadline = 0.0
        self.stopped = threading.Event()
        self.monitor = threading.Thread(target=self._watch_read, daemon=True)
        self.monitor.start()

    def _watch_read(self) -> None:
        while not self.stopped.wait(.02):
            deadline = self.deadline
            if deadline and time.monotonic() >= deadline:
                os.killpg(os.getpid(), signal.SIGKILL)

    def run(self, source: int, maximum: int, target: int | None = None, *, read_bytes: bool = True) -> tuple[bytes, str, int]:
        if not 0 <= maximum <= 1024 ** 3:
            raise ValueError("Invalid bounded read allowance")
        self.deadline = time.monotonic() + self.timeout
        try:
            descriptors = [source] if target is None else [source, target]
            data, digest, size = bounded_file_io._operation(descriptors, maximum, 1 if target is not None else (0 if read_bytes else 2))
            return data, digest.hex(), size
        except (OSError, ValueError) as error:
            raise bounded_file_io.ReadUnavailable("The cloud source is unavailable") from error
        finally:
            self.deadline = 0.0

    def close(self) -> None:
        self.stopped.set()
        self.monitor.join(timeout=1)


def _command(descriptors: tuple[int, ...]) -> list[str]:
    arguments = [*(str(value) for value in descriptors), str(os.getpid())]
    if getattr(sys, "frozen", False):
        return [sys.executable, "--website-preview-worker", *arguments]
    return [sys.executable, str(Path(__file__).resolve()), *arguments]


def _wait(channel: socket.socket, process: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + _DEADLINE
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("The local preview exceeded its construction deadline")
        channel.settimeout(min(_HEARTBEAT_TIMEOUT, remaining))
        data = channel.recv(64)
        if not data or any(value not in b"PD" for value in data):
            raise OSError("The owned preview worker exited unexpectedly")
        if b"D" in data:
            if process.wait(timeout=2) != 0:
                raise OSError("The owned preview worker failed")
            return


def _kill_group(process: subprocess.Popen[bytes]) -> None:
    # A failed group leader may already have exited while its children remain.
    # Every process started here owns a new session with PGID equal to its PID.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except PermissionError:
        # Darwin can report EPERM for an already-empty process group. Retain
        # the error if any live member still belongs to this owned group.
        if process.poll() is None:
            raise
        for member in psutil.process_iter(["uids", "status"]):
            try:
                if (getattr(member.info["uids"], "real", None) == os.getuid()
                        and member.info["status"] != psutil.STATUS_ZOMBIE
                        and os.getpgid(member.pid) == process.pid):
                    raise PermissionError("The owned preview process group could not be stopped")
            except ProcessLookupError:
                continue
            except psutil.NoSuchProcess:
                continue
    process.wait(timeout=2)


def _cleanup(store: SiteStore, site_id: str, identity: str) -> None:
    from . import runtime
    with store.database() as db:
        row = db.execute("SELECT consumed FROM previews WHERE id=? AND site_id=?", (identity, site_id)).fetchone()
        if row is not None and row["consumed"]:
            return
        runtime.stop_preview(store, site_id, identity)
        db.execute("DELETE FROM previews WHERE id=? AND site_id=? AND consumed=0", (identity, site_id))
    root = store.site_dir(site_id) / "previews" / identity
    for name in ("public", "work"):
        path = root/name
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)


def run_isolated(store: SiteStore, site: SiteConfig, target_id: str, *,
                 record: RecordPublicationReview | None = None,
                 expected_revision: int | None = None) -> SitePreview:
    from .asset_files import _open_directory
    from .models import SitePreview
    identity = uuid4().hex
    root = store.site_dir(site.id) / "previews" / identity
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    context = store.context
    payload = {"operation": "record-preview" if record else "site-preview", "identity": identity,
        "private_root": str(store.private_root), "site": site.model_dump(mode="json"), "target_id": target_id,
        "expected_revision": expected_revision, "record": record.model_dump(mode="json") if record else None,
        "context": {"workspace_id": context.workspace_id, "user_id": context.user_id, "role": context.role,
                    "capabilities": context.capabilities, "vault_path": str(store.vault)}}
    raw = json.dumps(payload).encode()
    if len(raw) > _LIMIT:
        raise HTTPException(422, "The website preview configuration exceeds its bounded allowance")
    descriptor: int | None = None
    parent, child = socket.socketpair()
    process: subprocess.Popen[bytes] | None = None
    try:
        descriptor = _open_directory(store.vault)
        pinned = os.fstat(descriptor)
        with tempfile.TemporaryFile() as request, tempfile.TemporaryFile() as output:
            request.write(raw)
            request.flush()
            request.seek(0)
            descriptors = (child.fileno(), descriptor, request.fileno(), output.fileno())
            process = subprocess.Popen(_command(descriptors), pass_fds=descriptors, start_new_session=True,
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            child.close()
            _wait(parent, process)
            current = store.vault.stat(follow_symlinks=False)
            if (pinned.st_dev, pinned.st_ino) != (current.st_dev, current.st_ino):
                raise ValueError("The vault root changed during preview construction")
            size = os.fstat(output.fileno()).st_size
            if size > _LIMIT:
                raise ValueError("Invalid preview worker result")
            output.seek(0)
            result = json.loads(output.read(size + 1))
            if isinstance(result, dict) and isinstance(result.get("status"), int):
                raise HTTPException(result["status"], str(result.get("detail", "Local preview failed")))
            preview = SitePreview.model_validate(result)
            if (preview.id, preview.site_id, preview.target_id) != (identity, site.id, target_id):
                raise ValueError("The preview worker returned a different operation")
            return preview
    except BaseException:
        try:
            if process is not None:
                _kill_group(process)
        finally:
            _cleanup(store, site.id, identity)
        raise
    finally:
        parent.close()
        child.close()
        if descriptor is not None:
            os.close(descriptor)
        if process is not None:
            if process.poll() is None:
                _kill_group(process)
            else:
                process.wait(timeout=2)


def _perform(payload: dict[str, object], root_descriptor: int) -> SitePreview:
    from backend.services.context_vars import active_vault_path
    from backend.services.workspace_service import WorkspaceContext
    from . import asset_files, exporter, publication, record_publication, renderer
    from .models import SiteConfig
    from .storage import SiteStore
    from .note_parse_cache import parsed_metadata
    operation, identity, values = payload.get("operation"), payload.get("identity"), payload.get("context")
    if operation not in {"site-preview", "record-preview"} or not isinstance(identity, str) or not re.fullmatch(r"[a-f0-9]{32}", identity) or not isinstance(values, dict):
        raise ValueError("Invalid local preview operation")
    context = WorkspaceContext(str(values["workspace_id"]), str(values["user_id"]), str(values["role"]),
        Path(str(values["vault_path"])), capabilities=[str(value) for value in values["capabilities"]])
    pinned = os.fstat(root_descriptor)
    current = context.vault_path.stat(follow_symlinks=False)
    if not stat.S_ISDIR(pinned.st_mode) or (pinned.st_dev, pinned.st_ino) != (current.st_dev, current.st_ino):
        raise ValueError("The authorized vault root changed")
    store = SiteStore(context)
    if str(store.private_root) != payload.get("private_root") or store.vault != context.vault_path:
        raise ValueError("The preview workspace identity changed")
    site = SiteConfig.model_validate(payload["site"])
    work = store.site_dir(site.id)/"previews"/identity/"work"
    work.mkdir(mode=0o700, parents=True, exist_ok=True)
    active = active_vault_path.set(store.vault)
    worker = in_worker.set(True)
    identifier = preview_identity.set(identity)
    scratch = renderer.preview_work_root.set(work)
    roots = asset_files._read_roots.set([(store.vault, store.vault, root_descriptor)])
    reader = _OwnedReader()
    reader_token = bounded_file_io._current.set(reader)
    parse_session = parsed_metadata(store.private_root)
    parsed_token = exporter.parsed_note_cache.set(parse_session.__enter__())
    try:
        with asset_files.parent_descriptor_cache(), asset_files.read_session():
            if operation == "record-preview":
                request = record_publication.RecordPublicationReview.model_validate(payload["record"])
                if request.target_id != payload["target_id"]:
                    raise ValueError("The preview target changed")
                return record_publication.review(store, site, request)
            revision = payload.get("expected_revision")
            if revision is not None and not isinstance(revision, int):
                raise ValueError("Invalid preview revision")
            return publication.preview(store, site, str(payload["target_id"]), expected_revision=revision)
    finally:
        reader.close()
        parse_session.__exit__(None, None, None)
        exporter.parsed_note_cache.reset(parsed_token)
        bounded_file_io._current.reset(reader_token)
        asset_files._read_roots.reset(roots)
        renderer.preview_work_root.reset(scratch)
        preview_identity.reset(identifier)
        in_worker.reset(worker)
        active_vault_path.reset(active)


def worker_main(channel_descriptor: int, root_descriptor: int, request_descriptor: int,
                output_descriptor: int, owner: int) -> int:
    if os.getppid() != owner or os.getpgrp() != os.getpid():
        return 74
    stop = threading.Event()
    with socket.socket(fileno=channel_descriptor) as channel:
        def heartbeat() -> None:
            while not stop.wait(.2):
                try:
                    channel.sendall(b"P")
                except OSError:
                    return
        thread = threading.Thread(target=heartbeat, daemon=True)
        thread.start()
        def watch_owner() -> None:
            while os.getppid() == owner:
                time.sleep(.2)
            # Only this worker and its preview subprocesses belong to this group.
            os.killpg(os.getpid(), signal.SIGKILL)
        threading.Thread(target=watch_owner, daemon=True).start()
        try:
            for descriptor in (request_descriptor, output_descriptor):
                info = os.fstat(descriptor)
                if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
                    raise ValueError("Owned preview descriptors are required")
            raw = os.read(request_descriptor, _LIMIT + 1)
            if len(raw) > _LIMIT:
                raise ValueError("Invalid preview request size")
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError("Invalid preview request")
            result = _perform(payload, root_descriptor).model_dump(mode="json")
        except Exception as error:
            status = error.status_code if isinstance(error, HTTPException) else 503
            detail = error.detail if isinstance(error, HTTPException) else "The owned local preview could not be constructed"
            result = {"status": status, "detail": str(detail)}
        stop.set()
        thread.join(timeout=1)
        data = json.dumps(result).encode()
        if len(data) > _LIMIT:
            data = json.dumps({"status": 503, "detail": "The local preview result exceeds its bounded allowance"}).encode()
        view = memoryview(data)
        while view:
            view = view[os.write(output_descriptor, view):]
        channel.sendall(b"D")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
    from backend.domains.sites.preview_worker import worker_main as main
    raise SystemExit(main(*(int(value) for value in sys.argv[1:])))
