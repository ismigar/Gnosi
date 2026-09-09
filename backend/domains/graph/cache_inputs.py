"""Complete graph inputs used for bounded response-cache revalidation."""

from __future__ import annotations

import errno
import hashlib
import json
import logging
import os
import threading
from collections import OrderedDict
from collections.abc import Iterator
from contextlib import contextmanager
from copy import copy, deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.domains.graph.timing import graph_phase
from backend.utils.open_values import iterable_values

log = logging.getLogger(__name__)

_ManagedSignature = tuple[int, int, int, int, int, int, int | None]
_MANAGED_CACHE_LIMIT = 512
_MANAGED_CACHE_MAX_SOURCE_SIZE = 64 * 1024
_MANAGED_STATE_CACHE: OrderedDict[
    tuple[str, str], tuple[_ManagedSignature, dict[str, Any]],
] = OrderedDict()
_MANAGED_CACHE_LOCK = threading.Lock()


def log_graph_input_failure(source: str, error: Exception) -> None:
    """Describe availability failures without paths, IDs or exception messages."""
    log.warning("Graph input unavailable: source=%s type=%s errno=%s",
                source, type(error).__name__, getattr(error, "errno", None))


@contextmanager
def graph_input_source(source: str) -> Iterator[None]:
    with graph_phase(f"input_{source}"):
        try:
            yield
        except Exception as error:
            log_graph_input_failure(source, error)
            raise


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, default=str).encode("utf-8")).hexdigest()


def scope_graph_config(cfg: Any, vault_path: Path) -> Any:
    """Keep settings while resolving filesystem inputs for this request's vault."""
    scoped = copy(cfg)
    scoped.paths = {**cfg.paths, "VAULT": vault_path, "GNOSI_CONFIG": vault_path / ".gnosi"}
    if cfg.paths.get("VAULT") != vault_path:
        scoped.paths["REGISTRY"] = vault_path / "BD" / "vault_db_registry.json"
    return scoped


def _managed_signature(stat: os.stat_result) -> _ManagedSignature:
    return (stat.st_dev, stat.st_ino, stat.st_mode, stat.st_mtime_ns,
            stat.st_ctime_ns, stat.st_size, getattr(stat, "st_blocks", None))


def _read_managed_metadata(scope: str, entry: os.DirEntry[str]) -> tuple[_ManagedSignature, dict[str, Any]]:
    """Reuse only strict reads of the same file, including ctime and identity."""
    signature = _managed_signature(entry.stat())
    key = (scope, entry.name)
    with _MANAGED_CACHE_LOCK:
        cached = _MANAGED_STATE_CACHE.get(key)
        if cached is not None and cached[0] == signature:
            _MANAGED_STATE_CACHE.move_to_end(key)
        else:
            _MANAGED_STATE_CACHE.pop(key, None)
            cached = None
    if cached is not None:
        return signature, deepcopy(cached[1])
    path = Path(entry.path)
    raw = path.read_text(encoding="utf-8")
    payload = json.loads(raw)
    if not isinstance(payload, dict) or not isinstance(payload.get("metadata"), dict):
        raise ValueError("Managed graph page state is invalid")
    if _managed_signature(path.stat()) != signature:
        raise OSError(errno.EAGAIN, "Managed graph page changed during its read")
    metadata = payload["metadata"]
    # Oversized valid sidecars remain usable, but do not consume retained memory.
    if signature[5] <= _MANAGED_CACHE_MAX_SOURCE_SIZE:
        with _MANAGED_CACHE_LOCK:
            if key not in _MANAGED_STATE_CACHE and len(_MANAGED_STATE_CACHE) >= _MANAGED_CACHE_LIMIT:
                # A scan larger than the cache must not evict its own upcoming
                # hits. Other vaults can still replace the oldest foreign entry.
                victim = next((candidate for candidate in _MANAGED_STATE_CACHE
                               if candidate[0] != scope), None)
                if victim is not None:
                    _MANAGED_STATE_CACHE.pop(victim)
            if key in _MANAGED_STATE_CACHE or len(_MANAGED_STATE_CACHE) < _MANAGED_CACHE_LIMIT:
                _MANAGED_STATE_CACHE[key] = (signature, metadata)
                _MANAGED_STATE_CACHE.move_to_end(key)
    return signature, deepcopy(metadata)


def _prune_managed_snapshots(scope: str, present: set[str]) -> None:
    with _MANAGED_CACHE_LOCK:
        for key in list(_MANAGED_STATE_CACHE):
            if key[0] == scope and key[1] not in present:
                _MANAGED_STATE_CACHE.pop(key, None)


@graph_input_source("sidecars")
def capture_managed_state(cfg: Any) -> tuple[str, dict[str, dict[str, Any]]]:
    """Read managed state strictly so a fallback cannot certify incomplete data."""
    config_dir = cfg.paths.get("GNOSI_CONFIG")
    if not isinstance(config_dir, Path):
        raise ValueError("Managed-page configuration path is unavailable")
    scope = str(config_dir)
    states = []
    present: set[str] = set()
    metadata_by_id: dict[str, dict[str, Any]] = {}
    try:
        entries = os.scandir(config_dir / "llm_wiki" / "pages")
    except FileNotFoundError:
        _prune_managed_snapshots(scope, present)
        return _digest((str(config_dir), cfg.get("app", {}), cfg.colors, [])), metadata_by_id
    with entries:
        for entry in entries:
            if not entry.name.endswith(".json"):
                continue
            signature, metadata = _read_managed_metadata(scope, entry)
            present.add(entry.name)
            metadata_by_id[Path(entry.name).stem] = metadata
            # Preserve the semantic marker format; the stricter file identity
            # is for read reuse and does not require another node-cache migration.
            states.append((entry.name, signature[3], signature[4], signature[5],
                           signature[1], metadata))
    _prune_managed_snapshots(scope, present)
    revision = _digest((str(config_dir), cfg.get("app", {}), cfg.colors, sorted(states)))
    return revision, metadata_by_id


def semantic_revision(cfg: Any) -> str:
    return capture_managed_state(cfg)[0]


@graph_input_source("contacts")
def read_contact_nodes(cfg: Any) -> list[dict[str, Any]]:
    """Read exactly the contact columns represented in the graph."""
    from backend.data.management_db import get_mgmt_session
    from backend.models.contact import Contact

    node_colors = cfg.colors.get("node_types", {})
    color_cfg = node_colors.get("contact", node_colors.get("default", {}))
    nodes = []
    with get_mgmt_session() as db:
        contacts = db.query(
            Contact.id, Contact.name, Contact.email, Contact.company, Contact.job_title, Contact.source,
        ).all()
        for contact in contacts:
            label = contact.name or contact.email or str(contact.id)
            nodes.append({
                "id": f"contact_{contact.id}", "label": label, "kind": "contact",
                "color": color_cfg.get("bg", "#10b981"), "size": 8,
                "metadata": {
                    "id": str(contact.id), "title": label, "email": contact.email,
                    "company": contact.company, "job_title": contact.job_title,
                    "source": str(contact.source), "account_id": None,
                },
                "path": f"Contacts/{label}.md",
            })
    return nodes


@graph_input_source("suggestions")
def read_suggestion_edges(cfg: Any) -> list[dict[str, Any]]:
    """Read the canonical queue with explicit errors for unreliable snapshots."""
    config_dir = cfg.paths.get("GNOSI_CONFIG")
    if not isinstance(config_dir, Path):
        raise ValueError("Graph proposal configuration path is unavailable")
    try:
        data = json.loads((config_dir / "llm_wiki_suggestions.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    if not isinstance(data, dict) or not isinstance(data.get("suggestions"), list):
        raise ValueError("Graph proposal queue is invalid")
    edges = []
    for suggestion in data["suggestions"]:
        if not isinstance(suggestion, dict) or not suggestion.get("id"):
            continue
        members = [str(member) for member in iterable_values(suggestion.get("member_ids") or []) if member]
        if len(members) < 2:
            continue
        for target in members[1:]:
            edges.append({
                "source": members[0], "target": target, "kind": "suggestion",
                "reason": str(suggestion.get("question") or suggestion.get("title") or ""),
                "suggestion_id": str(suggestion.get("id") or ""),
            })
    return edges


@dataclass(frozen=True)
class GraphInputs:
    cfg: Any
    files: list[tuple[Path, float]]
    registry: dict[str, Any]
    contacts: list[dict[str, Any]]
    suggestions: list[dict[str, Any]]
    semantic: str
    revision: str
    managed_states: dict[str, dict[str, Any]] | None = None


def capture_graph_inputs(
    cfg: Any, files: list[tuple[Path, float]], registry: dict[str, Any],
) -> GraphInputs:
    semantic, managed_states = capture_managed_state(cfg)
    contacts = read_contact_nodes(cfg)
    suggestions = read_suggestion_edges(cfg)
    revision = _digest(([(str(path), mtime) for path, mtime in files], registry, contacts, suggestions, semantic))
    return GraphInputs(cfg, files, registry, contacts, suggestions, semantic, revision, managed_states)
