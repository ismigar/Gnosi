"""Federated academic search, repository configuration, and OAI indexing."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import sqlite3
import threading
import uuid
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

from fastapi import BackgroundTasks, HTTPException

from backend.config.app_config import load_params
from backend.config.logger_config import get_logger
from backend.security.keychain_manager import get_keychain
from backend.services import academic_connectors, durable_job_queue
from backend.services.context_vars import get_primary_vault_path
from backend.services.literature_models import canonical_work, deduplicate_works, deterministic_key, normalize_title
from backend.utils.safe_io import safe_write_json


log = get_logger(__name__)
_CONFIG_LOCK = threading.RLock()
_SEARCH_LOCK = threading.RLock()
_INDEX_LOCK = threading.RLock()
_IMPORT_LOCK = threading.RLock()
_SEARCH_TASKS: dict[str, asyncio.Task[Any]] = {}
_SYNC_THREADS: dict[str, threading.Thread] = {}
_REVIEW_THREADS: dict[str, threading.Thread] = {}
MAX_SEARCH_RESULTS = 1_000
MAX_EVENTS = 2_000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _scope(vault_path: Path | str) -> str:
    return hashlib.sha256(str(Path(vault_path).expanduser().resolve()).encode("utf-8")).hexdigest()[:24]


def _primary_vault(vault_path: Path | str | None = None) -> Path:
    return Path(get_primary_vault_path() or vault_path or load_params(strict_env=False).paths["VAULT"])


def literature_dir(vault_path: Path | str | None = None) -> Path:
    root = _primary_vault(vault_path) / ".gnosi" / "literature"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _config_path(vault_path: Path | str | None = None) -> Path:
    return literature_dir(vault_path) / "repositories.json"


def _search_path(vault_path: Path | str, search_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", str(search_id)):
        raise HTTPException(status_code=400, detail="Invalid literature search identifier.")
    directory = literature_dir(vault_path) / "searches"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{search_id}.json"


def index_path(vault_path: Path | str) -> Path:
    root = Path(load_params(strict_env=False).paths["LOCAL_DATA"]) / "literature" / _scope(_primary_vault(vault_path))
    root.mkdir(parents=True, exist_ok=True)
    return root / "academic_index.sqlite3"


def _connect_index(vault_path: Path | str) -> sqlite3.Connection:
    connection = sqlite3.connect(index_path(vault_path), timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=30000")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS oai_records (
            source_id TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            duplicate_key TEXT,
            title TEXT NOT NULL,
            normalized_title TEXT NOT NULL,
            year INTEGER,
            work_json TEXT NOT NULL,
            datestamp TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(source_id, provider_id)
        );
        CREATE INDEX IF NOT EXISTS idx_oai_records_key ON oai_records(duplicate_key);
        CREATE VIRTUAL TABLE IF NOT EXISTS oai_records_fts USING fts5(
            source_id UNINDEXED,
            provider_id UNINDEXED,
            title,
            abstract,
            authors,
            tokenize='unicode61 remove_diacritics 2'
        );
        CREATE TABLE IF NOT EXISTS oai_sync_state (
            source_id TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            job_id TEXT,
            resumption_token TEXT,
            last_successful_datestamp TEXT,
            received_count INTEGER NOT NULL DEFAULT 0,
            indexed_count INTEGER NOT NULL DEFAULT 0,
            deleted_count INTEGER NOT NULL DEFAULT 0,
            complete_list_size INTEGER,
            cursor_value INTEGER,
            cancel_requested INTEGER NOT NULL DEFAULT 0,
            error TEXT,
            started_at TEXT,
            updated_at TEXT NOT NULL,
            completed_at TEXT
        );
        """
    )
    return connection


SOURCE_CATALOG: tuple[dict[str, Any], ...] = (
    {"id": "crossref", "name": "Crossref", "kind": "api", "group": "open", "default_enabled": True, "automated": True, "implemented": True, "docs_url": "https://www.crossref.org/documentation/retrieve-metadata/rest-api/"},
    {"id": "datacite", "name": "DataCite", "kind": "api", "group": "open", "default_enabled": True, "automated": True, "implemented": True, "docs_url": "https://support.datacite.org/docs/api"},
    {"id": "arxiv", "name": "arXiv", "kind": "api", "group": "open", "default_enabled": True, "automated": True, "implemented": True, "docs_url": "https://info.arxiv.org/help/api/"},
    {"id": "europe-pmc", "name": "Europe PMC", "kind": "api", "group": "open", "default_enabled": True, "automated": True, "implemented": True, "docs_url": "https://europepmc.org/RestfulWebService"},
    {"id": "eric", "name": "ERIC", "kind": "api", "group": "open", "default_enabled": True, "automated": True, "implemented": True, "docs_url": "https://eric.ed.gov/?api"},
    {"id": "openaire", "name": "OpenAIRE", "kind": "api", "group": "open", "default_enabled": True, "automated": True, "implemented": True, "docs_url": "https://graph.openaire.eu/develop/api.html"},
    {"id": "hal", "name": "HAL", "kind": "api", "group": "open", "default_enabled": True, "automated": True, "implemented": True, "docs_url": "https://api.archives-ouvertes.fr/docs/search/"},
    {"id": "core", "name": "CORE", "kind": "api", "group": "open", "default_enabled": True, "automated": True, "implemented": True, "optional_credential_key": "core_api_key", "docs_url": "https://core.ac.uk/services/api"},
    {"id": "open-library", "name": "Open Library", "kind": "api", "group": "open", "default_enabled": True, "automated": True, "implemented": True, "docs_url": "https://openlibrary.org/dev/docs/api/search"},
    {"id": "scielo-articles", "name": "SciELO Articles", "kind": "api", "group": "open", "default_enabled": True, "automated": True, "implemented": True, "docs_url": "https://docs.scielo.org/"},
    {"id": "doaj-articles", "name": "DOAJ Articles", "kind": "api", "group": "open", "default_enabled": True, "automated": True, "implemented": True, "docs_url": "https://doaj.org/api/v3/docs"},
    {"id": "pubmed", "name": "PubMed", "kind": "api", "group": "contact", "default_enabled": True, "automated": True, "implemented": True, "requires_contact": True, "docs_url": "https://www.ncbi.nlm.nih.gov/books/NBK25497/"},
    {"id": "unpaywall", "name": "Unpaywall", "kind": "enrichment", "group": "contact", "default_enabled": True, "automated": True, "implemented": True, "requires_contact": True, "docs_url": "https://unpaywall.org/products/api"},
    {"id": "dialnet-articles", "name": "Dialnet Articles", "kind": "oai", "group": "local-index", "default_enabled": True, "automated": True, "implemented": True, "base_url": "https://dialnet.unirioja.es/oai/OAIHandler", "metadata_prefix": "oai_dc", "docs_url": "https://soporte.dialnet.unirioja.es/portal/es/kb/articles/instrucciones-de-acceso-por-oai-pmh"},
    {"id": "dialnet-theses", "name": "Dialnet Theses", "kind": "oai", "group": "local-index", "default_enabled": True, "automated": True, "implemented": True, "base_url": "https://dialnet.unirioja.es/oaites/OAIHandler", "metadata_prefix": "oai_dc", "docs_url": "https://soporte.dialnet.unirioja.es/portal/es/kb/articles/instrucciones-de-acceso-por-oai-pmh"},
    {"id": "doab", "name": "DOAB", "kind": "oai", "group": "local-index", "default_enabled": True, "automated": True, "implemented": True, "base_url": "https://directory.doabooks.org/oai/request", "metadata_prefix": "oai_dc", "docs_url": "https://www.doabooks.org/en/doab/full-faq"},
    {"id": "scielo-books", "name": "SciELO Books", "kind": "oai", "group": "local-index", "default_enabled": True, "automated": True, "implemented": True, "base_url": "https://oai.books.scielo.org/oai-pmh", "metadata_prefix": "oai_dc", "docs_url": "https://books.scielo.org/en/availability-and-interoperability/"},
    {"id": "openalex", "name": "OpenAlex", "kind": "api", "group": "credential", "default_enabled": False, "automated": True, "implemented": True, "credential_key": "openalex_api_key", "docs_url": "https://developers.openalex.org/api-reference/authentication"},
    {"id": "semantic-scholar", "name": "Semantic Scholar", "kind": "api", "group": "credential", "default_enabled": False, "automated": True, "implemented": True, "credential_key": "semantic_scholar_api_key", "docs_url": "https://api.semanticscholar.org/api-docs/"},
    {"id": "springer-nature", "name": "Springer Nature", "kind": "api", "group": "credential", "default_enabled": False, "automated": True, "implemented": False, "credential_key": "springer_nature_api_key", "docs_url": "https://dev.springernature.com/"},
    {"id": "scopus", "name": "Scopus", "kind": "api", "group": "subscription", "default_enabled": False, "automated": True, "implemented": False, "credential_key": "scopus_api_key", "docs_url": "https://dev.elsevier.com/sc_apis.html"},
    {"id": "web-of-science", "name": "Web of Science", "kind": "api", "group": "subscription", "default_enabled": False, "automated": True, "implemented": False, "credential_key": "web_of_science_api_key", "docs_url": "https://developer.clarivate.com/apis/wos"},
    {"id": "dimensions", "name": "Dimensions", "kind": "api", "group": "subscription", "default_enabled": False, "automated": True, "implemented": False, "credential_key": "dimensions_api_key", "docs_url": "https://docs.dimensions.ai/dsl/api.html"},
    {"id": "google-scholar", "name": "Google Scholar", "kind": "external", "group": "external", "default_enabled": False, "automated": False, "implemented": False, "search_url": "https://scholar.google.com/scholar?q={query}", "docs_url": "https://scholar.google.com/intl/en/scholar/help.html"},
    {"id": "academia", "name": "Academia.edu", "kind": "external", "group": "external", "default_enabled": False, "automated": False, "implemented": False, "search_url": "https://www.academia.edu/search?q={query}", "docs_url": "https://www.academia.edu/"},
    {"id": "sjr", "name": "SJR", "kind": "metric", "group": "metrics", "default_enabled": False, "automated": False, "implemented": False, "docs_url": "https://www.scimagojr.com/"},
)


CREDENTIAL_ENV = {
    "core_api_key": "CORE_API_KEY",
    "openalex_api_key": "OPENALEX_API_KEY",
    "semantic_scholar_api_key": "SEMANTIC_SCHOLAR_API_KEY",
    "springer_nature_api_key": "SPRINGER_NATURE_API_KEY",
    "scopus_api_key": "SCOPUS_API_KEY",
    "web_of_science_api_key": "WEB_OF_SCIENCE_API_KEY",
    "dimensions_api_key": "DIMENSIONS_API_KEY",
}


def default_config() -> dict[str, Any]:
    return {"version": 1, "contact_email": "", "ai_agent_id": "", "source_defaults": {}, "hidden_sources": [], "custom_repositories": [], "updated_at": _now()}


def load_config(vault_path: Path | str | None = None) -> dict[str, Any]:
    with _CONFIG_LOCK:
        path = _config_path(vault_path)
        try:
            data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        except (OSError, json.JSONDecodeError):
            data = {}
        config = {**default_config(), **(data if isinstance(data, dict) else {})}
        if not isinstance(config.get("source_defaults"), dict):
            config["source_defaults"] = {}
        if not isinstance(config.get("hidden_sources"), list):
            config["hidden_sources"] = []
        if not isinstance(config.get("custom_repositories"), list):
            config["custom_repositories"] = []
        return config


def save_config(vault_path: Path | str, patch: dict[str, Any]) -> dict[str, Any]:
    """Persist only validated public settings, never credential values."""
    allowed = {"contact_email", "ai_agent_id", "source_defaults", "hidden_sources"}
    with _CONFIG_LOCK:
        config = load_config(vault_path)
        for key in allowed:
            if key in patch:
                config[key] = deepcopy(patch[key])
        config["contact_email"] = str(config.get("contact_email") or "").strip()[:320]
        config["ai_agent_id"] = str(config.get("ai_agent_id") or "").strip()[:160]
        config["source_defaults"] = {str(key)[:100]: bool(value) for key, value in (config.get("source_defaults") or {}).items()}
        known = {item["id"] for item in SOURCE_CATALOG}
        config["hidden_sources"] = [str(item) for item in config.get("hidden_sources") or [] if str(item) in known]
        config["updated_at"] = _now()
        safe_write_json(_config_path(vault_path), config, indent=2, ensure_ascii=False)
        return config


def _credential_value(key: str) -> str:
    env_name = CREDENTIAL_ENV.get(key, "")
    if env_name and os.environ.get(env_name):
        return str(os.environ[env_name])
    try:
        return get_keychain().get_credential(key) or ""
    except Exception:  # noqa: BLE001
        return ""


def _sync_summary(vault_path: Path | str, source_id: str) -> dict[str, Any]:
    with _connect_index(vault_path) as connection:
        row = connection.execute("SELECT * FROM oai_sync_state WHERE source_id=?", (source_id,)).fetchone()
        count = connection.execute("SELECT COUNT(*) FROM oai_records WHERE source_id=?", (source_id,)).fetchone()[0]
    data = dict(row) if row else {"state": "never", "last_successful_datestamp": None, "error": None}
    data["index_size"] = count
    data["cancel_requested"] = bool(data.get("cancel_requested"))
    return data


def catalog(vault_path: Path | str) -> list[dict[str, Any]]:
    config = load_config(vault_path)
    defaults = config.get("source_defaults") or {}
    hidden = set(config.get("hidden_sources") or [])
    contact_email = str(config.get("contact_email") or "")
    rows: list[dict[str, Any]] = []
    for raw in SOURCE_CATALOG:
        item = deepcopy(raw)
        item["enabled"] = bool(defaults.get(item["id"], item.get("default_enabled", False)))
        item["hidden"] = item["id"] in hidden
        credential_key = str(item.get("credential_key") or "")
        configured = bool(_credential_value(credential_key)) if credential_key else True
        optional_credential_key = str(item.get("optional_credential_key") or "")
        item["optional_credential_configured"] = bool(_credential_value(optional_credential_key)) if optional_credential_key else False
        if item.get("requires_contact"):
            configured = bool(contact_email)
        item["credential_status"] = "configured" if configured else "missing"
        item["available"] = bool(item.get("automated") and item.get("implemented") and configured)
        if item.get("kind") == "oai":
            item["sync"] = _sync_summary(vault_path, item["id"])
            item["available"] = item["sync"]["index_size"] > 0
        rows.append(item)
    for custom in config.get("custom_repositories") or []:
        item = deepcopy(custom)
        item.update({"group": "custom", "default_enabled": bool(defaults.get(item["id"], item.get("default_enabled", True))), "enabled": bool(defaults.get(item["id"], item.get("default_enabled", True))), "hidden": False, "automated": True, "implemented": True, "credential_status": "configured", "available": True})
        if item.get("kind") == "oai":
            item["sync"] = _sync_summary(vault_path, item["id"])
            item["available"] = item["sync"]["index_size"] > 0
        rows.append(item)
    for item in _plugin_repositories(vault_path):
        item["enabled"] = bool(defaults.get(item["id"], item.get("default_enabled", False)))
        rows.append(item)
    return rows


def _plugins_context(vault_path: Path | str) -> tuple[Path, dict[str, Any]]:
    """Load sandbox plugin state without importing the monolithic API routes."""
    config_dir = Path(vault_path) / ".gnosi"
    try:
        state = json.loads((config_dir / "plugins.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        state = {}
    if not isinstance(state, dict):
        state = {}
    state.setdefault("disabled", [])
    state.setdefault("granted", {})
    return config_dir, state


def _plugin_repositories(vault_path: Path | str) -> list[dict[str, Any]]:
    """Discover enabled, network-approved sandbox repository adapters."""
    try:
        from backend.services import plugin_system

        config_dir, state = _plugins_context(vault_path)
        disabled = {str(item) for item in state.get("disabled") or []}
        granted = state.get("granted") if isinstance(state.get("granted"), dict) else {}
        repositories: list[dict[str, Any]] = []
        for discovered in plugin_system.discover_plugins(config_dir):
            manifest = discovered.get("manifest") if isinstance(discovered, dict) else None
            if not manifest or manifest["id"] in disabled or "network" not in (granted.get(manifest["id"]) or []):
                continue
            for relative in (manifest.get("contributes") or {}).get("academicRepositories") or []:
                path = plugin_system.plugin_dir(config_dir, manifest["id"]) / relative
                try:
                    descriptor = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                if not isinstance(descriptor, dict):
                    continue
                local_id = re.sub(r"[^a-z0-9_-]+", "-", str(descriptor.get("id") or path.stem).lower()).strip("-")[:60]
                if not local_id:
                    continue
                repositories.append({
                    "id": f"plugin-{manifest['id']}-{local_id}",
                    "name": str(descriptor.get("name") or local_id)[:160],
                    "kind": "plugin", "group": "plugin", "default_enabled": False,
                    "enabled": False,
                    "automated": True, "implemented": True, "available": True, "hidden": False,
                    "credential_status": "configured", "plugin_id": manifest["id"],
                    "descriptor": {key: descriptor.get(key) for key in ("description", "docs_url", "coverage")},
                })
        return repositories
    except Exception:  # noqa: BLE001
        return []


def _search_plugin_adapter(vault_path: Path | str, source: dict[str, Any], query: str, filters: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    """Run one complex repository adapter inside the existing data sandbox."""
    from backend.services import plugin_sandbox, plugin_system

    config_dir, state = _plugins_context(vault_path)
    plugin_id = str(source.get("plugin_id") or "")
    manifest = plugin_system.read_manifest(config_dir, plugin_id)
    granted = ((state.get("granted") or {}).get(plugin_id) or [])
    result = plugin_sandbox.run_event(
        config_dir,
        manifest,
        granted,
        "literature.search",
        {"repository_id": source["id"], "query": query, "filters": filters, "limit": limit},
        timeout_s=30,
    )
    if not result.get("ok"):
        raise academic_connectors.ConnectorError(str(result.get("error") or "The plugin repository adapter failed."))
    payload = result.get("result")
    values = payload.get("works") if isinstance(payload, dict) else payload
    if not isinstance(values, list):
        raise academic_connectors.ConnectorError("The plugin repository adapter returned an invalid work list.")
    works: list[dict[str, Any]] = []
    for value in values[:limit]:
        if not isinstance(value, dict):
            continue
        works.append(canonical_work(
            source["id"], value.get("provider_id") or value.get("id"),
            **{key: value.get(key) for key in (
                "title", "authors", "dates", "year", "abstract", "type", "publication",
                "language", "identifiers", "open_access", "locations", "metrics",
            ) if key in value},
        ))
    return works


def public_configuration(vault_path: Path | str) -> dict[str, Any]:
    config = load_config(vault_path)
    ai_config = load_params(strict_env=False).get("ai", {}) or {}
    agents = [
        {"id": str(agent.get("id") or ""), "name": str(agent.get("name") or agent.get("id") or ""), "provider": str(agent.get("provider") or ""), "model": str(agent.get("model") or "")}
        for agent in (ai_config.get("agents") or [])
        if isinstance(agent, dict) and agent.get("id") and agent.get("enabled", True)
    ]
    selected_agent_id = str(config.get("ai_agent_id") or ai_config.get("active_agent_id") or "")
    return {"contact_email": config.get("contact_email") or "", "ai_agent_id": selected_agent_id, "ai_agents": agents, "source_defaults": config.get("source_defaults") or {}, "hidden_sources": config.get("hidden_sources") or [], "sources": catalog(vault_path)}


def _validate_repository(payload: dict[str, Any], repository_id: str = "") -> dict[str, Any]:
    kind = str(payload.get("kind") or "").strip().lower()
    if kind not in {"oai", "rest"}:
        raise HTTPException(status_code=400, detail="Repository kind must be oai or rest.")
    name = " ".join(str(payload.get("name") or "").split()).strip()[:160]
    if not name:
        raise HTTPException(status_code=400, detail="Repository name is required.")
    try:
        base_url = academic_connectors.validate_public_https_url(str(payload.get("base_url") or ""))
    except academic_connectors.ConnectorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    definition: dict[str, Any] = {"id": repository_id or f"custom-{uuid.uuid4().hex[:16]}", "name": name, "kind": kind, "base_url": base_url, "default_enabled": bool(payload.get("default_enabled", True)), "created_at": str(payload.get("created_at") or _now()), "updated_at": _now()}
    if kind == "oai":
        definition.update({"metadata_prefix": str(payload.get("metadata_prefix") or "oai_dc").strip()[:100], "set": str(payload.get("set") or "").strip()[:500], "sync_mode": str(payload.get("sync_mode") or "incremental") if str(payload.get("sync_mode") or "incremental") in {"full", "incremental"} else "incremental", "tombstones": bool(payload.get("tombstones", True))})
    else:
        mapping = payload.get("mapping") if isinstance(payload.get("mapping"), dict) else {}
        if not mapping.get("title"):
            raise HTTPException(status_code=400, detail="REST mapping requires a title field path.")
        definition.update({"query_parameter": str(payload.get("query_parameter") or "q")[:100], "limit_parameter": str(payload.get("limit_parameter") or "limit")[:100], "results_path": str(payload.get("results_path") or "results")[:300], "pagination": str(payload.get("pagination") or "none") if str(payload.get("pagination") or "none") in {"none", "page", "offset", "cursor", "link"} else "none", "page_parameter": str(payload.get("page_parameter") or "page")[:100], "offset_parameter": str(payload.get("offset_parameter") or "offset")[:100], "cursor_parameter": str(payload.get("cursor_parameter") or "cursor")[:100], "next_cursor_path": str(payload.get("next_cursor_path") or "next_cursor")[:300], "static_filters": {str(key)[:100]: str(value)[:1_000] for key, value in (payload.get("static_filters") or {}).items()}, "mapping": {str(key)[:100]: str(value)[:300] for key, value in mapping.items()}})
    return definition


def save_repository(vault_path: Path | str, payload: dict[str, Any], repository_id: str = "") -> dict[str, Any]:
    with _CONFIG_LOCK:
        config = load_config(vault_path)
        existing = next((item for item in config["custom_repositories"] if item.get("id") == repository_id), None)
        if repository_id and existing is None:
            raise HTTPException(status_code=404, detail="Custom repository not found.")
        definition = _validate_repository({**(existing or {}), **payload}, repository_id)
        config["custom_repositories"] = [item for item in config["custom_repositories"] if item.get("id") != definition["id"]] + [definition]
        config["updated_at"] = _now()
        safe_write_json(_config_path(vault_path), config, indent=2, ensure_ascii=False)
        return definition


def delete_repository(vault_path: Path | str, repository_id: str, *, delete_index: bool = False) -> dict[str, Any]:
    with _CONFIG_LOCK:
        config = load_config(vault_path)
        existing = next((item for item in config["custom_repositories"] if item.get("id") == repository_id), None)
        if existing is None:
            raise HTTPException(status_code=404, detail="Custom repository not found.")
        config["custom_repositories"] = [item for item in config["custom_repositories"] if item.get("id") != repository_id]
        config["source_defaults"].pop(repository_id, None)
        config["updated_at"] = _now()
        safe_write_json(_config_path(vault_path), config, indent=2, ensure_ascii=False)
    removed = 0
    if delete_index:
        with _INDEX_LOCK, _connect_index(vault_path) as connection:
            removed = connection.execute("SELECT COUNT(*) FROM oai_records WHERE source_id=?", (repository_id,)).fetchone()[0]
            rowids = [row[0] for row in connection.execute("SELECT rowid FROM oai_records WHERE source_id=?", (repository_id,)).fetchall()]
            for rowid in rowids:
                connection.execute("DELETE FROM oai_records_fts WHERE rowid=?", (rowid,))
            connection.execute("DELETE FROM oai_records WHERE source_id=?", (repository_id,))
            connection.execute("DELETE FROM oai_sync_state WHERE source_id=?", (repository_id,))
            connection.commit()
    return {"deleted": True, "repository_id": repository_id, "index_records_deleted": removed}


async def test_repository(payload: dict[str, Any], query: str = "test") -> dict[str, Any]:
    definition = _validate_repository(payload)
    started = datetime.now(timezone.utc)
    if definition["kind"] == "oai":
        page = await academic_connectors.fetch_oai_page(definition)
        count = len(page["works"])
        sample = page["works"][:3]
    else:
        sample = await academic_connectors.search_generic_json(definition, query or "test", {}, 3)
        count = len(sample)
    return {"ok": True, "latency_ms": int((datetime.now(timezone.utc) - started).total_seconds() * 1_000), "count": count, "sample": sample}


def _read_search(vault_path: Path | str, search_id: str) -> dict[str, Any]:
    path = _search_path(vault_path, search_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Literature search not found.")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="Literature search history is unavailable.") from exc
    return data


def _write_search(vault_path: Path | str, search: dict[str, Any]) -> None:
    with _SEARCH_LOCK:
        safe_write_json(_search_path(vault_path, search["id"]), search, indent=2, ensure_ascii=False)


def _event(search: dict[str, Any], event_type: str, **payload: Any) -> None:
    events = search.setdefault("events", [])
    seq = int(events[-1]["seq"] if events else 0) + 1
    events.append({"seq": seq, "type": event_type, "at": _now(), **payload})
    if len(events) > MAX_EVENTS:
        del events[: len(events) - MAX_EVENTS]


def search_oai_index(vault_path: Path | str, source_id: str, query: str, filters: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    expression = _oai_fts_expression(query)
    if not expression:
        return []
    params: list[Any] = [source_id, expression]
    where = "r.source_id=? AND oai_records_fts MATCH ?"
    if filters.get("date_from"):
        where += " AND r.year>=?"
        params.append(int(str(filters["date_from"])[:4]))
    if filters.get("date_to"):
        where += " AND r.year<=?"
        params.append(int(str(filters["date_to"])[:4]))
    requested_limit = max(1, min(int(limit), 100))
    has_language_filter = bool(filters.get("languages") or filters.get("language"))
    params.append(min(100, requested_limit * 4) if has_language_filter else requested_limit)
    with _connect_index(vault_path) as connection:
        rows = connection.execute(
            f"""SELECT r.work_json FROM oai_records r
            JOIN oai_records_fts f ON f.rowid=r.rowid
            WHERE {where} ORDER BY bm25(oai_records_fts) LIMIT ?""",
            params,
        ).fetchall()
    return academic_connectors.filter_works([json.loads(row["work_json"]) for row in rows], filters)[:requested_limit]


def _oai_fts_expression(query: str) -> str:
    tokens = [token for token in re.findall(r"[\w-]+", normalize_title(query)) if len(token) > 1][:12]
    return " AND ".join(f'"{token.replace(chr(34), "")}"' for token in tokens)


def _source_query_audit(
    source: dict[str, Any],
    search: dict[str, Any],
    requests: list[dict[str, Any]],
    effective_query: str | None = None,
) -> dict[str, Any]:
    """Describe the effective query without persisting secrets."""
    provider_query = effective_query or search["query"]
    return {
        "source_id": source["id"],
        "source_name": source.get("name") or source["id"],
        "original_query": search["query"],
        "effective_query": provider_query,
        "filters": deepcopy(search.get("filters") or {}),
        "connector_version": 1,
        "provider_syntax": (
            _oai_fts_expression(provider_query)
            if source.get("kind") == "oai"
            else provider_query
        ),
        "requests": deepcopy(requests),
    }


def start_search(vault_path: Path | str, *, query: str, filters: dict[str, Any], source_ids: Iterable[str] | None = None, source_queries: dict[str, str] | None = None, ai_audits: list[dict[str, Any]] | None = None, limit_per_source: int = 25, owner_user_id: str = "") -> dict[str, Any]:
    text = " ".join(str(query or "").split()).strip()[:2_000]
    if not text:
        raise HTTPException(status_code=400, detail="Search query is required.")
    available = {item["id"]: item for item in catalog(vault_path)}
    selected = list(dict.fromkeys(str(item) for item in (source_ids or []) if str(item) in available))
    if not selected:
        selected = [item["id"] for item in available.values() if item.get("enabled") and item.get("automated") and item.get("kind") != "enrichment"]
    if not selected:
        raise HTTPException(status_code=400, detail="Select at least one automated academic source.")
    translated_queries = {
        source_id: " ".join(str((source_queries or {}).get(source_id) or "").split()).strip()[:2_000]
        for source_id in selected
        if str((source_queries or {}).get(source_id) or "").strip()
    }
    search_id = uuid.uuid4().hex
    config = load_config(vault_path)
    snapshot_fields = (
        "id", "name", "kind", "group", "base_url", "metadata_prefix", "set",
        "sync_mode", "tombstones", "query_parameter", "limit_parameter",
        "results_path", "pagination", "page_parameter", "offset_parameter",
        "cursor_parameter", "next_cursor_path", "static_filters", "mapping",
        "docs_url", "search_url",
    )
    source_snapshots = [{key: deepcopy(item.get(key)) for key in snapshot_fields if item.get(key) not in (None, "")} for item in available.values() if item["id"] in selected]
    safe_ai_audits = [deepcopy(item) for item in (ai_audits or [])[:50] if isinstance(item, dict)]
    search = {"id": search_id, "query": text, "source_queries": translated_queries, "filters": filters if isinstance(filters, dict) else {}, "source_ids": selected, "source_snapshots": source_snapshots, "owner_user_id": owner_user_id, "state": "queued", "cancel_requested": False, "source_status": {source_id: {"state": "queued", "count": 0, "error": None} for source_id in selected}, "exact_queries": {}, "ai_audits": safe_ai_audits, "counts": {"raw_occurrences": 0, "unique_works": 0, "duplicates_removed": 0, "possible_duplicate_pairs": 0, "returned_works": 0, "truncated_works": 0}, "results": [], "errors": [], "events": [], "created_at": _now(), "updated_at": _now(), "completed_at": None, "limit_per_source": max(1, min(int(limit_per_source), 100)), "contact_email_configured": bool(config.get("contact_email"))}
    _event(search, "search.created", source_ids=selected)
    _write_search(vault_path, search)
    task = asyncio.create_task(_execute_search(Path(vault_path), search_id), name=f"literature-search-{search_id[:8]}")
    _SEARCH_TASKS[search_id] = task
    task.add_done_callback(lambda _: _SEARCH_TASKS.pop(search_id, None))
    return _public_search(search, include_results=False)


async def _execute_source(vault_path: Path, search_id: str, source_id: str, source: dict[str, Any], definition: dict[str, Any] | None, contact_email: str) -> None:
    with _SEARCH_LOCK:
        search = _read_search(vault_path, search_id)
        if search.get("cancel_requested"):
            return
        search["source_status"][source_id] = {"state": "running", "count": 0, "error": None, "started_at": _now()}
        _event(search, "source.started", source_id=source_id)
        _write_search(vault_path, search)
    audit_token, request_audit = academic_connectors.begin_request_audit()
    effective_query = str((search.get("source_queries") or {}).get(source_id) or search["query"])
    try:
        try:
            if not source.get("available"):
                raise academic_connectors.ConnectorError("This academic source is not configured or its connector is unavailable.")
            if source.get("kind") == "oai":
                works = await asyncio.to_thread(search_oai_index, vault_path, source_id, effective_query, search["filters"], search["limit_per_source"])
                request_audit.append({"method": "LOCAL_FTS", "expression": _oai_fts_expression(effective_query), "filters": deepcopy(search["filters"]), "connector_audit_version": 1})
            elif source.get("kind") == "plugin":
                works = await asyncio.to_thread(_search_plugin_adapter, vault_path, source, effective_query, search["filters"], search["limit_per_source"])
                request_audit.append({"method": "PLUGIN_SANDBOX", "event": "literature.search", "connector_audit_version": 1})
            else:
                credential = contact_email if source.get("requires_contact") else _credential_value(str(source.get("credential_key") or source.get("optional_credential_key") or ""))
                works = await academic_connectors.search_source(source_id, effective_query, search["filters"], search["limit_per_source"], credential=credential, definition=definition)
        finally:
            academic_connectors.end_request_audit(audit_token)
        with _SEARCH_LOCK:
            search = _read_search(vault_path, search_id)
            if search.get("cancel_requested"):
                return
            counts = search.setdefault("counts", {})
            raw_occurrences = int(counts.get("raw_occurrences") or 0) + len(works)
            deduplicated = deduplicate_works((search.get("results") or []) + works)
            returned = deduplicated[:MAX_SEARCH_RESULTS]
            possible_pairs = sum(len(work.get("possible_duplicates") or []) for work in deduplicated) // 2
            search["results"] = returned
            search.setdefault("exact_queries", {})[source_id] = _source_query_audit(source, search, request_audit, effective_query)
            search["counts"] = {
                "raw_occurrences": raw_occurrences,
                "unique_works": len(deduplicated),
                "duplicates_removed": max(0, raw_occurrences - len(deduplicated)),
                "possible_duplicate_pairs": possible_pairs,
                "returned_works": len(returned),
                "truncated_works": max(0, len(deduplicated) - len(returned)),
            }
            search["source_status"][source_id] = {"state": "completed", "count": len(works), "error": None, "completed_at": _now()}
            _event(search, "source.completed", source_id=source_id, count=len(works), total_results=len(search["results"]), duplicates_removed=search["counts"]["duplicates_removed"])
            search["updated_at"] = _now()
            _write_search(vault_path, search)
        return
    except academic_connectors.ConnectorError as exc:
        with _SEARCH_LOCK:
            search = _read_search(vault_path, search_id)
            search.setdefault("exact_queries", {})[source_id] = _source_query_audit(source, search, request_audit, effective_query)
            error = {"source_id": source_id, "message": str(exc), "retry_after": exc.retry_after}
            search["errors"].append(error)
            search["source_status"][source_id] = {"state": "failed", "count": 0, "error": str(exc), "retry_after": exc.retry_after, "completed_at": _now()}
            _event(search, "source.failed", **error)
            search["updated_at"] = _now()
            _write_search(vault_path, search)
        return
    except Exception as exc:  # noqa: BLE001
        log.exception("Academic source %s failed", source_id)
        with _SEARCH_LOCK:
            search = _read_search(vault_path, search_id)
            search.setdefault("exact_queries", {})[source_id] = _source_query_audit(source, search, request_audit, effective_query)
            message = "The academic source returned an unexpected response."
            search["errors"].append({"source_id": source_id, "message": message})
            search["source_status"][source_id] = {"state": "failed", "count": 0, "error": message, "completed_at": _now()}
            _event(search, "source.failed", source_id=source_id, message=message)
            search["updated_at"] = _now()
            _write_search(vault_path, search)


async def _execute_search(vault_path: Path, search_id: str) -> None:
    search = _read_search(vault_path, search_id)
    search["state"] = "running"
    search["updated_at"] = _now()
    _event(search, "search.started")
    _write_search(vault_path, search)
    config = load_config(vault_path)
    definitions = {item["id"]: item for item in catalog(vault_path)}
    custom = {item["id"]: item for item in config.get("custom_repositories") or []}
    tasks = [asyncio.create_task(_execute_source(vault_path, search_id, source_id, definitions[source_id], custom.get(source_id), str(config.get("contact_email") or ""))) for source_id in search["source_ids"] if source_id != "unpaywall"]
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    search = _read_search(vault_path, search_id)
    if search.get("cancel_requested"):
        search["state"] = "cancelled"
        _event(search, "search.cancelled")
    else:
        if "unpaywall" in search["source_ids"] and config.get("contact_email"):
            source = definitions["unpaywall"]
            audit_token, request_audit = academic_connectors.begin_request_audit()
            enriched = []
            enriched_count = 0
            try:
                for work in search.get("results") or []:
                    try:
                        updated = await academic_connectors.enrich_unpaywall(work, str(config["contact_email"]))
                        enriched.append(updated)
                        if updated != work:
                            enriched_count += 1
                    except academic_connectors.ConnectorError as exc:
                        enriched.append(work)
                        search["errors"].append({"source_id": "unpaywall", "message": str(exc)})
            finally:
                academic_connectors.end_request_audit(audit_token)
            search["results"] = enriched
            search.setdefault("exact_queries", {})["unpaywall"] = _source_query_audit(source, search, request_audit)
            search["source_status"]["unpaywall"] = {"state": "completed", "count": enriched_count, "error": None, "completed_at": _now()}
            _event(search, "source.completed", source_id="unpaywall", count=enriched_count, total_results=len(enriched))
        elif "unpaywall" in search["source_ids"]:
            search["source_status"]["unpaywall"] = {"state": "failed", "count": 0, "error": "A contact email is required.", "completed_at": _now()}
        search["state"] = "completed"
        _event(search, "search.completed", total_results=len(search.get("results") or []), failed_sources=len(search.get("errors") or []))
    search["updated_at"] = _now()
    search["completed_at"] = _now()
    _write_search(vault_path, search)


def _public_search(search: dict[str, Any], *, include_results: bool = True, offset: int = 0, limit: int = 50) -> dict[str, Any]:
    payload = {key: deepcopy(value) for key, value in search.items() if key not in {"events", "results"}}
    results = search.get("results") or []
    payload["result_count"] = len(results)
    if include_results:
        payload["results"] = results[max(0, offset): max(0, offset) + max(1, min(limit, 200))]
        payload["offset"] = max(0, offset)
        payload["limit"] = max(1, min(limit, 200))
    return payload


def get_search(vault_path: Path | str, search_id: str, *, offset: int = 0, limit: int = 50) -> dict[str, Any]:
    return _public_search(_read_search(vault_path, search_id), offset=offset, limit=limit)


def get_search_result(vault_path: Path | str, search_id: str, result_id: str) -> dict[str, Any]:
    result = next((item for item in _read_search(vault_path, search_id).get("results") or [] if str(item.get("id")) == result_id), None)
    if result is None:
        raise HTTPException(status_code=404, detail="Academic search result not found.")
    return deepcopy(result)


def search_events(vault_path: Path | str, search_id: str, after: int = 0) -> dict[str, Any]:
    search = _read_search(vault_path, search_id)
    return {"events": [item for item in search.get("events") or [] if int(item.get("seq") or 0) > max(0, after)], "state": search.get("state"), "last_seq": int((search.get("events") or [{}])[-1].get("seq") or 0)}


def cancel_search(vault_path: Path | str, search_id: str) -> dict[str, Any]:
    search = _read_search(vault_path, search_id)
    if search.get("state") in {"completed", "cancelled", "failed"}:
        return _public_search(search, include_results=False)
    search["cancel_requested"] = True
    search["updated_at"] = _now()
    _event(search, "search.cancel.requested")
    _write_search(vault_path, search)
    return _public_search(search, include_results=False)


def append_search_ai_audit(vault_path: Path | str, search_id: str, operation: str, audit: dict[str, Any]) -> dict[str, Any]:
    """Append one server-produced AI audit to a persisted search history item."""
    with _SEARCH_LOCK:
        search = _read_search(vault_path, search_id)
        entry = {"operation": str(operation)[:100], **deepcopy(audit if isinstance(audit, dict) else {})}
        search.setdefault("ai_audits", []).append(entry)
        search["ai_audits"] = search["ai_audits"][-50:]
        search["updated_at"] = _now()
        _write_search(vault_path, search)
    return entry


def list_searches(vault_path: Path | str, limit: int = 50) -> list[dict[str, Any]]:
    directory = literature_dir(vault_path) / "searches"
    rows: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)[: max(1, min(limit, 200))] if directory.exists() else []:
        try:
            rows.append(_public_search(json.loads(path.read_text(encoding="utf-8")), include_results=False))
        except (OSError, json.JSONDecodeError):
            continue
    return rows


async def discover_citation_neighbors(
    vault_path: Path | str,
    seeds: list[dict[str, Any]],
    *,
    direction: str = "both",
    limit_per_seed: int = 25,
) -> dict[str, Any]:
    """Retrieve deterministic backward or forward citation links from an authorized API."""
    selected = [seed for seed in seeds if isinstance(seed, dict)][:20]
    if not selected:
        raise HTTPException(status_code=400, detail="Select at least one seed work.")
    if direction not in {"backward", "forward", "both"}:
        raise HTTPException(status_code=400, detail="Citation direction must be backward, forward, or both.")
    semantic_key = _credential_value("semantic_scholar_api_key")
    openalex_key = _credential_value("openalex_api_key")
    if not semantic_key and not openalex_key:
        raise HTTPException(status_code=409, detail="Configure a Semantic Scholar or OpenAlex API key for citation expansion.")
    provider = "semantic-scholar" if semantic_key else "openalex"
    key = semantic_key or openalex_key
    directions = [direction] if direction != "both" else ["backward", "forward"]
    raw: list[dict[str, Any]] = []
    audit_token, requests = academic_connectors.begin_request_audit()
    try:
        for selected_direction in directions:
            if provider == "semantic-scholar":
                raw.extend(await academic_connectors.semantic_scholar_neighbors(selected, selected_direction, limit_per_seed, key))
            else:
                raw.extend(await academic_connectors.openalex_neighbors(selected, selected_direction, limit_per_seed, key))
    except academic_connectors.ConnectorError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        academic_connectors.end_request_audit(audit_token)
    seed_keys = {deterministic_key(seed) for seed in selected if deterministic_key(seed)}
    deduplicated = [work for work in deduplicate_works(raw) if deterministic_key(work) not in seed_keys]
    possible_pairs = sum(len(work.get("possible_duplicates") or []) for work in deduplicated) // 2
    return {
        "provider": provider,
        "direction": direction,
        "works": deduplicated,
        "counts": {
            "raw_occurrences": len(raw),
            "unique_works": len(deduplicated),
            "duplicates_removed": max(0, len(raw) - len(deduplicated)),
            "possible_duplicate_pairs": possible_pairs,
        },
        "exact_queries": {
            provider: {
                "source_id": provider,
                "original_query": "citation graph expansion",
                "filters": {"direction": direction, "limit_per_seed": max(1, min(int(limit_per_seed), 100))},
                "connector_version": 1,
                "provider_syntax": directions,
                "requests": requests,
            },
        },
    }


def _source_definition(vault_path: Path | str, source_id: str) -> dict[str, Any]:
    source = next((item for item in catalog(vault_path) if item["id"] == source_id), None)
    if source is None:
        raise HTTPException(status_code=404, detail="Academic source not found.")
    if source.get("kind") != "oai":
        raise HTTPException(status_code=400, detail="Only OAI repositories create local synchronization jobs.")
    return source


def enqueue_sync(vault_path: Path | str, source_id: str, *, full: bool = False) -> dict[str, Any]:
    source = _source_definition(vault_path, source_id)
    job_id = uuid.uuid4().hex
    with _INDEX_LOCK, _connect_index(vault_path) as connection:
        current = connection.execute("SELECT * FROM oai_sync_state WHERE source_id=?", (source_id,)).fetchone()
        if current and current["state"] in {"queued", "running"}:
            return dict(current)
        connection.execute(
            """INSERT INTO oai_sync_state(source_id,state,job_id,resumption_token,last_successful_datestamp,received_count,indexed_count,deleted_count,cancel_requested,error,started_at,updated_at,completed_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(source_id) DO UPDATE SET state=excluded.state,job_id=excluded.job_id,resumption_token=CASE WHEN ? THEN '' ELSE oai_sync_state.resumption_token END,received_count=0,indexed_count=0,deleted_count=0,cancel_requested=0,error=NULL,started_at=excluded.started_at,updated_at=excluded.updated_at,completed_at=NULL""",
            (source_id, "queued", job_id, "", None, 0, 0, 0, 0, None, _now(), _now(), None, 1 if full else 0),
        )
        connection.commit()
    durable_job_queue.enqueue("academic_repository_sync", {"vault_path": str(_primary_vault(vault_path)), "source_id": source_id, "job_id": job_id, "full": bool(full)}, idempotency_key=f"literature-sync:{_scope(vault_path)}:{source_id}:{job_id}", job_id=job_id, max_attempts=5)
    return sync_status(vault_path, source_id)


def sync_status(vault_path: Path | str, source_id: str) -> dict[str, Any]:
    return {"source_id": source_id, **_sync_summary(vault_path, source_id)}


def cancel_sync(vault_path: Path | str, source_id: str) -> dict[str, Any]:
    _source_definition(vault_path, source_id)
    with _INDEX_LOCK, _connect_index(vault_path) as connection:
        connection.execute("UPDATE oai_sync_state SET cancel_requested=1,updated_at=? WHERE source_id=? AND state IN ('queued','running')", (_now(), source_id))
        connection.commit()
    return sync_status(vault_path, source_id)


def _upsert_oai_page(connection: sqlite3.Connection, source_id: str, page: dict[str, Any]) -> tuple[int, int]:
    indexed = 0
    deleted = 0
    for provider_id in page.get("deleted") or []:
        row = connection.execute("SELECT rowid FROM oai_records WHERE source_id=? AND provider_id=?", (source_id, provider_id)).fetchone()
        if row:
            connection.execute("DELETE FROM oai_records_fts WHERE rowid=?", (row["rowid"],))
            connection.execute("DELETE FROM oai_records WHERE source_id=? AND provider_id=?", (source_id, provider_id))
            deleted += 1
    for work in page.get("works") or []:
        sources = work.get("sources") or []
        provider_id = str((sources[0] if sources else {}).get("provider_id") or work.get("id") or "")
        if not provider_id:
            continue
        current = connection.execute("SELECT rowid FROM oai_records WHERE source_id=? AND provider_id=?", (source_id, provider_id)).fetchone()
        if current:
            rowid = current["rowid"]
            connection.execute("DELETE FROM oai_records_fts WHERE rowid=?", (rowid,))
            connection.execute("UPDATE oai_records SET duplicate_key=?,title=?,normalized_title=?,year=?,work_json=?,updated_at=? WHERE rowid=?", (deterministic_key(work), work.get("title") or "", normalize_title(work.get("title")), work.get("year"), json.dumps(work, ensure_ascii=False, separators=(",", ":")), _now(), rowid))
        else:
            cursor = connection.execute("INSERT INTO oai_records(source_id,provider_id,duplicate_key,title,normalized_title,year,work_json,updated_at) VALUES(?,?,?,?,?,?,?,?)", (source_id, provider_id, deterministic_key(work), work.get("title") or "", normalize_title(work.get("title")), work.get("year"), json.dumps(work, ensure_ascii=False, separators=(",", ":")), _now()))
            rowid = cursor.lastrowid
        authors = "; ".join(str(author.get("literal") or f"{author.get('given','')} {author.get('family','')}").strip() for author in work.get("authors") or [] if isinstance(author, dict))
        connection.execute("INSERT INTO oai_records_fts(rowid,source_id,provider_id,title,abstract,authors) VALUES(?,?,?,?,?,?)", (rowid, source_id, provider_id, work.get("title") or "", work.get("abstract") or "", authors))
        indexed += 1
    return indexed, deleted


def _run_sync(vault_path: Path, source_id: str, job_id: str, full: bool) -> dict[str, Any]:
    source = _source_definition(vault_path, source_id)
    worker_id = f"literature:{os.getpid()}:{threading.get_ident()}"
    if not durable_job_queue.claim(job_id, worker_id=worker_id, lease_seconds=3_600):
        return sync_status(vault_path, source_id)
    try:
        with _INDEX_LOCK, _connect_index(vault_path) as connection:
            state = connection.execute("SELECT * FROM oai_sync_state WHERE source_id=?", (source_id,)).fetchone()
            token = "" if full else str((state or {}).get("resumption_token") or "") if isinstance(state, dict) else (str(state["resumption_token"] or "") if state else "")
            last_success = str(state["last_successful_datestamp"] or "") if state else ""
            connection.execute("UPDATE oai_sync_state SET state='running',updated_at=? WHERE source_id=?", (_now(), source_id))
            connection.commit()
        from_date = ""
        if not full and not token and last_success:
            try:
                from_date = (datetime.fromisoformat(last_success.replace("Z", "+00:00")) - timedelta(days=1)).date().isoformat()
            except ValueError:
                from_date = ""
        while True:
            with _connect_index(vault_path) as connection:
                state = connection.execute("SELECT cancel_requested,received_count,indexed_count,deleted_count FROM oai_sync_state WHERE source_id=?", (source_id,)).fetchone()
            if state and state["cancel_requested"]:
                with _connect_index(vault_path) as connection:
                    connection.execute("UPDATE oai_sync_state SET state='cancelled',completed_at=?,updated_at=? WHERE source_id=?", (_now(), _now(), source_id))
                    connection.commit()
                durable_job_queue.complete(job_id, worker_id, {"state": "cancelled"})
                return sync_status(vault_path, source_id)
            page = academic_connectors.run(academic_connectors.fetch_oai_page(source, resumption_token=token, from_date=from_date))
            with _INDEX_LOCK, _connect_index(vault_path) as connection:
                indexed, deleted = _upsert_oai_page(connection, source_id, page)
                received = int(state["received_count"] if state else 0) + len(page.get("works") or []) + len(page.get("deleted") or [])
                indexed_total = int(state["indexed_count"] if state else 0) + indexed
                deleted_total = int(state["deleted_count"] if state else 0) + deleted
                token = str(page.get("resumption_token") or "")
                connection.execute("UPDATE oai_sync_state SET resumption_token=?,received_count=?,indexed_count=?,deleted_count=?,complete_list_size=?,cursor_value=?,updated_at=? WHERE source_id=?", (token, received, indexed_total, deleted_total, page.get("complete_list_size"), page.get("cursor"), _now(), source_id))
                connection.commit()
            durable_job_queue.heartbeat(job_id, worker_id, lease_seconds=3_600)
            if not token:
                break
        with _connect_index(vault_path) as connection:
            connection.execute("UPDATE oai_sync_state SET state='completed',resumption_token='',last_successful_datestamp=?,completed_at=?,updated_at=? WHERE source_id=?", (_now(), _now(), _now(), source_id))
            connection.commit()
        durable_job_queue.complete(job_id, worker_id, {"state": "completed", "source_id": source_id})
        return sync_status(vault_path, source_id)
    except Exception as exc:  # noqa: BLE001
        log.exception("Academic OAI synchronization failed for %s", source_id)
        message = str(exc)[:2_000]
        with _connect_index(vault_path) as connection:
            connection.execute("UPDATE oai_sync_state SET state='failed',error=?,completed_at=?,updated_at=? WHERE source_id=?", (message, _now(), _now(), source_id))
            connection.commit()
        durable_job_queue.fail(job_id, worker_id, message)
        return sync_status(vault_path, source_id)


def launch_sync(vault_path: Path, source_id: str, job_id: str, *, full: bool = False) -> None:
    """Launch one process-local owner for a durable OAI synchronization lease."""
    current = _SYNC_THREADS.get(job_id)
    if current and current.is_alive():
        return
    thread = threading.Thread(target=_run_sync, args=(Path(vault_path), source_id, job_id, full), name=f"academic-sync-{source_id}-{job_id[:6]}", daemon=True)
    _SYNC_THREADS[job_id] = thread
    thread.start()


def enqueue_due_syncs(vault_path: Path | str | None = None) -> int:
    """Enqueue initialized OAI repositories not completed in the last 24 hours.

    The first harvest is intentionally explicit because repositories such as
    Dialnet contain hundreds of thousands of records. Once an administrator
    starts and completes that harvest, the daily scheduler owns incremental
    refreshes.
    """
    path = _primary_vault(vault_path)
    count = 0
    for source in catalog(path):
        if source.get("kind") != "oai" or not source.get("enabled"):
            continue
        completed = (source.get("sync") or {}).get("completed_at")
        if not completed:
            continue
        try:
            due = datetime.fromisoformat(str(completed).replace("Z", "+00:00")) < datetime.now(timezone.utc) - timedelta(hours=24)
        except ValueError:
            due = True
        if due:
            enqueue_sync(path, source["id"], full=False)
            count += 1
    return count


def enqueue_due_review_updates(vault_path: Path | str | None = None) -> int:
    """Queue enabled, due review strategies as durable background jobs."""
    from backend.services import literature_review_service

    path = _primary_vault(vault_path)
    now = datetime.now(timezone.utc)
    queued = 0
    for review in literature_review_service.list_reviews():
        schedule = (review.get("configuration") or {}).get("schedule") or {}
        strategy = schedule.get("strategy") if isinstance(schedule.get("strategy"), dict) else {}
        if not schedule.get("enabled") or not strategy.get("query"):
            continue
        next_run = str(schedule.get("next_run") or "")
        if next_run:
            try:
                if datetime.fromisoformat(next_run.replace("Z", "+00:00")) > now:
                    continue
            except ValueError:
                pass
        job_id = uuid.uuid4().hex
        durable_job_queue.enqueue(
            "academic_review_update",
            {"vault_path": str(path), "review_id": review["id"], "job_id": job_id, "strategy": strategy, "interval_days": max(1, min(int(schedule.get("interval_days") or 7), 365))},
            idempotency_key=f"literature-review-update:{_scope(path)}:{review['id']}:{now.date().isoformat()}",
            job_id=job_id,
            max_attempts=3,
        )
        queued += 1
    return queued


def _run_review_update(vault_path: Path, review_id: str, job_id: str, strategy: dict[str, Any], interval_days: int) -> dict[str, Any]:
    worker_id = f"literature-review:{os.getpid()}:{threading.get_ident()}"
    if not durable_job_queue.claim(job_id, worker_id=worker_id, lease_seconds=3_600):
        return {"state": "already_claimed"}

    async def execute() -> dict[str, Any]:
        from backend.services import literature_review_service
        from backend.services.workspace_service import WorkspaceContext

        created = start_search(
            vault_path,
            query=str(strategy.get("query") or ""),
            filters=strategy.get("filters") if isinstance(strategy.get("filters"), dict) else {},
            source_ids=strategy.get("source_ids") if isinstance(strategy.get("source_ids"), list) else None,
            source_queries=strategy.get("source_queries") if isinstance(strategy.get("source_queries"), dict) else None,
            limit_per_source=max(1, min(int(strategy.get("limit_per_source") or 25), 100)),
            owner_user_id="literature-scheduler",
        )
        task = _SEARCH_TASKS.get(created["id"])
        if task is not None:
            await task
        search = _read_search(vault_path, created["id"])
        context = WorkspaceContext("system", "literature-scheduler", "owner", vault_path, ["read", "write"])
        background_tasks = BackgroundTasks()
        activity = await literature_review_service.append_activity(
            review_id,
            "scheduled_search",
            {"strategy": strategy, "exact_queries": search.get("exact_queries") or {}, "source_snapshot": search.get("source_snapshots") or [], "errors": search.get("errors") or [], "counts": search.get("counts") or {"unique_works": len(search.get("results") or [])}, "notes": "Automated update; only newly deduplicated candidates are added."},
            background_tasks,
            context,
        )
        candidates = await literature_review_service.add_candidates(review_id, search.get("results") or [], background_tasks, context, activity.get("id") or "")
        completed = datetime.now(timezone.utc)
        updated_schedule = {"enabled": True, "interval_days": interval_days, "strategy": strategy, "last_run": completed.isoformat(), "next_run": (completed + timedelta(days=interval_days)).isoformat(), "last_search_id": created["id"], "last_new_count": candidates["added_count"]}
        await literature_review_service.update_configuration(review_id, {"schedule": updated_schedule}, background_tasks, context)
        return {"state": "completed", "search_id": created["id"], "new_candidates": candidates["added_count"], "existing_candidates": candidates["existing_count"]}

    try:
        result = academic_connectors.run(execute())
        durable_job_queue.complete(job_id, worker_id, result)
        return result
    except Exception as exc:  # noqa: BLE001
        log.exception("Scheduled literature review update failed for %s", review_id)
        durable_job_queue.fail(job_id, worker_id, str(exc)[:2_000])
        return {"state": "failed", "error": str(exc)[:2_000]}


def launch_review_update(vault_path: Path, review_id: str, job_id: str, strategy: dict[str, Any], interval_days: int = 7) -> None:
    """Launch one process-local owner for a durable scheduled review update."""
    current = _REVIEW_THREADS.get(job_id)
    if current and current.is_alive():
        return
    thread = threading.Thread(target=_run_review_update, args=(Path(vault_path), review_id, job_id, strategy, interval_days), name=f"literature-review-{review_id[:6]}-{job_id[:6]}", daemon=True)
    _REVIEW_THREADS[job_id] = thread
    thread.start()
