"""Academic repository catalog and configuration."""

from __future__ import annotations

import json
import os
import re
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend.config.app_config import load_params
from backend.domains.literature.state import _CONFIG_LOCK, _INDEX_LOCK
from backend.domains.literature.storage import (
    _config_path,
    _connect_index,
    _now,
)
from backend.security.keychain_manager import get_keychain
from backend.services import academic_connectors
from backend.services.literature_models import canonical_work
from backend.utils.safe_io import safe_write_json

SOURCE_CATALOG: tuple[dict[str, Any], ...] = (
    {
        "id": "crossref",
        "name": "Crossref",
        "kind": "api",
        "group": "open",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "docs_url": "https://www.crossref.org/documentation/retrieve-metadata/rest-api/",
    },
    {
        "id": "datacite",
        "name": "DataCite",
        "kind": "api",
        "group": "open",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "docs_url": "https://support.datacite.org/docs/api",
    },
    {
        "id": "arxiv",
        "name": "arXiv",
        "kind": "api",
        "group": "open",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "docs_url": "https://info.arxiv.org/help/api/",
    },
    {
        "id": "europe-pmc",
        "name": "Europe PMC",
        "kind": "api",
        "group": "open",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "docs_url": "https://europepmc.org/RestfulWebService",
    },
    {
        "id": "eric",
        "name": "ERIC",
        "kind": "api",
        "group": "open",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "docs_url": "https://eric.ed.gov/?api",
    },
    {
        "id": "openaire",
        "name": "OpenAIRE",
        "kind": "api",
        "group": "open",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "docs_url": "https://graph.openaire.eu/develop/api.html",
    },
    {
        "id": "hal",
        "name": "HAL",
        "kind": "api",
        "group": "open",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "docs_url": "https://api.archives-ouvertes.fr/docs/search/",
    },
    {
        "id": "core",
        "name": "CORE",
        "kind": "api",
        "group": "open",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "optional_credential_key": "core_api_key",
        "docs_url": "https://core.ac.uk/services/api",
    },
    {
        "id": "open-library",
        "name": "Open Library",
        "kind": "api",
        "group": "open",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "docs_url": "https://openlibrary.org/dev/docs/api/search",
    },
    {
        "id": "scielo-articles",
        "name": "SciELO Articles",
        "kind": "api",
        "group": "open",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "docs_url": "https://docs.scielo.org/",
    },
    {
        "id": "doaj-articles",
        "name": "DOAJ Articles",
        "kind": "api",
        "group": "open",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "docs_url": "https://doaj.org/api/v3/docs",
    },
    {
        "id": "pubmed",
        "name": "PubMed",
        "kind": "api",
        "group": "contact",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "requires_contact": True,
        "docs_url": "https://www.ncbi.nlm.nih.gov/books/NBK25497/",
    },
    {
        "id": "unpaywall",
        "name": "Unpaywall",
        "kind": "enrichment",
        "group": "contact",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "requires_contact": True,
        "docs_url": "https://unpaywall.org/products/api",
    },
    {
        "id": "dialnet-articles",
        "name": "Dialnet Articles",
        "kind": "oai",
        "group": "local-index",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "base_url": "https://dialnet.unirioja.es/oai/OAIHandler",
        "metadata_prefix": "oai_dc",
        "docs_url": "https://soporte.dialnet.unirioja.es/portal/es/kb/articles/instrucciones-de-acceso-por-oai-pmh",
    },
    {
        "id": "dialnet-theses",
        "name": "Dialnet Theses",
        "kind": "oai",
        "group": "local-index",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "base_url": "https://dialnet.unirioja.es/oaites/OAIHandler",
        "metadata_prefix": "oai_dc",
        "docs_url": "https://soporte.dialnet.unirioja.es/portal/es/kb/articles/instrucciones-de-acceso-por-oai-pmh",
    },
    {
        "id": "doab",
        "name": "DOAB",
        "kind": "oai",
        "group": "local-index",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "base_url": "https://directory.doabooks.org/oai/request",
        "metadata_prefix": "oai_dc",
        "docs_url": "https://www.doabooks.org/en/doab/full-faq",
    },
    {
        "id": "scielo-books",
        "name": "SciELO Books",
        "kind": "oai",
        "group": "local-index",
        "default_enabled": True,
        "automated": True,
        "implemented": True,
        "base_url": "https://oai.books.scielo.org/oai-pmh",
        "metadata_prefix": "oai_dc",
        "docs_url": "https://books.scielo.org/en/availability-and-interoperability/",
    },
    {
        "id": "openalex",
        "name": "OpenAlex",
        "kind": "api",
        "group": "credential",
        "default_enabled": False,
        "automated": True,
        "implemented": True,
        "credential_key": "openalex_api_key",
        "docs_url": "https://developers.openalex.org/api-reference/authentication",
    },
    {
        "id": "semantic-scholar",
        "name": "Semantic Scholar",
        "kind": "api",
        "group": "credential",
        "default_enabled": False,
        "automated": True,
        "implemented": True,
        "credential_key": "semantic_scholar_api_key",
        "docs_url": "https://api.semanticscholar.org/api-docs/",
    },
    {
        "id": "springer-nature",
        "name": "Springer Nature",
        "kind": "api",
        "group": "credential",
        "default_enabled": False,
        "automated": True,
        "implemented": True,
        "credential_key": "springer_nature_api_key",
        "docs_url": "https://dev.springernature.com/",
    },
    {
        "id": "scopus",
        "name": "Scopus",
        "kind": "api",
        "group": "subscription",
        "default_enabled": False,
        "automated": True,
        "implemented": True,
        "credential_key": "scopus_api_key",
        "docs_url": "https://dev.elsevier.com/sc_apis.html",
    },
    {
        "id": "web-of-science",
        "name": "Web of Science",
        "kind": "api",
        "group": "subscription",
        "default_enabled": False,
        "automated": True,
        "implemented": True,
        "credential_key": "web_of_science_api_key",
        "docs_url": "https://developer.clarivate.com/apis/wos",
    },
    {
        "id": "dimensions",
        "name": "Dimensions",
        "kind": "api",
        "group": "subscription",
        "default_enabled": False,
        "automated": True,
        "implemented": True,
        "credential_key": "dimensions_api_key",
        "docs_url": "https://docs.dimensions.ai/dsl/",
    },
    {
        "id": "google-scholar",
        "name": "Google Scholar",
        "kind": "external",
        "group": "external",
        "default_enabled": False,
        "automated": False,
        "implemented": False,
        "search_url": "https://scholar.google.com/scholar?q={query}",
        "docs_url": "https://scholar.google.com/intl/en/scholar/help.html",
    },
    {
        "id": "academia",
        "name": "Academia.edu",
        "kind": "external",
        "group": "external",
        "default_enabled": False,
        "automated": False,
        "implemented": False,
        "search_url": "https://www.academia.edu/search?q={query}",
        "docs_url": "https://www.academia.edu/",
    },
    {
        "id": "sjr",
        "name": "SJR",
        "kind": "metric",
        "group": "metrics",
        "default_enabled": False,
        "automated": False,
        "implemented": False,
        "docs_url": "https://www.scimagojr.com/",
    },
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
    return {
        "version": 1,
        "contact_email": "",
        "ai_agent_id": "",
        "source_defaults": {},
        "hidden_sources": [],
        "custom_repositories": [],
        "updated_at": _now(),
    }


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
        config["source_defaults"] = {
            str(key)[:100]: bool(value)
            for key, value in (config.get("source_defaults") or {}).items()
        }
        known = {item["id"] for item in SOURCE_CATALOG}
        config["hidden_sources"] = [
            str(item) for item in config.get("hidden_sources") or [] if str(item) in known
        ]
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
        row = connection.execute(
            "SELECT * FROM oai_sync_state WHERE source_id=?", (source_id,)
        ).fetchone()
        count = connection.execute(
            "SELECT COUNT(*) FROM oai_records WHERE source_id=?", (source_id,)
        ).fetchone()[0]
    data = (
        dict(row) if row else {"state": "never", "last_successful_datestamp": None, "error": None}
    )
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
        item["optional_credential_configured"] = (
            bool(_credential_value(optional_credential_key)) if optional_credential_key else False
        )
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
        item.update(
            {
                "group": "custom",
                "default_enabled": bool(
                    defaults.get(item["id"], item.get("default_enabled", True))
                ),
                "enabled": bool(defaults.get(item["id"], item.get("default_enabled", True))),
                "hidden": False,
                "automated": True,
                "implemented": True,
                "credential_status": "configured",
                "available": True,
            }
        )
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
        raw_granted = state.get("granted")
        granted: dict[str, Any] = dict(raw_granted) if isinstance(raw_granted, dict) else {}
        repositories: list[dict[str, Any]] = []
        for discovered in plugin_system.discover_plugins(config_dir):
            manifest = discovered.get("manifest") if isinstance(discovered, dict) else None
            if (
                not manifest
                or manifest["id"] in disabled
                or "network" not in (granted.get(manifest["id"]) or [])
            ):
                continue
            for relative in (manifest.get("contributes") or {}).get("academicRepositories") or []:
                path = plugin_system.plugin_dir(config_dir, manifest["id"]) / relative
                try:
                    descriptor = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                if not isinstance(descriptor, dict):
                    continue
                local_id = re.sub(
                    r"[^a-z0-9_-]+", "-", str(descriptor.get("id") or path.stem).lower()
                ).strip("-")[:60]
                if not local_id:
                    continue
                repositories.append(
                    {
                        "id": f"plugin-{manifest['id']}-{local_id}",
                        "name": str(descriptor.get("name") or local_id)[:160],
                        "kind": "plugin",
                        "group": "plugin",
                        "default_enabled": False,
                        "enabled": False,
                        "automated": True,
                        "implemented": True,
                        "available": True,
                        "hidden": False,
                        "credential_status": "configured",
                        "plugin_id": manifest["id"],
                        "descriptor": {
                            key: descriptor.get(key)
                            for key in ("description", "docs_url", "coverage")
                        },
                    }
                )
        return repositories
    except Exception:  # noqa: BLE001
        return []


def _search_plugin_adapter(
    vault_path: Path | str, source: dict[str, Any], query: str, filters: dict[str, Any], limit: int
) -> list[dict[str, Any]]:
    """Run one complex repository adapter inside the existing data sandbox."""
    from backend.services import plugin_sandbox, plugin_system

    config_dir, state = _plugins_context(vault_path)
    plugin_id = str(source.get("plugin_id") or "")
    manifest = plugin_system.read_manifest(config_dir, plugin_id)
    granted = (state.get("granted") or {}).get(plugin_id) or []
    result = plugin_sandbox.run_event(
        config_dir,
        manifest,
        granted,
        "literature.search",
        {"repository_id": source["id"], "query": query, "filters": filters, "limit": limit},
        timeout_s=30,
    )
    if not result.get("ok"):
        raise academic_connectors.ConnectorError(
            str(result.get("error") or "The plugin repository adapter failed.")
        )
    payload = result.get("result")
    values = payload.get("works") if isinstance(payload, dict) else payload
    if not isinstance(values, list):
        raise academic_connectors.ConnectorError(
            "The plugin repository adapter returned an invalid work list."
        )
    works: list[dict[str, Any]] = []
    for value in values[:limit]:
        if not isinstance(value, dict):
            continue
        works.append(
            canonical_work(
                source["id"],
                value.get("provider_id") or value.get("id"),
                **{
                    key: value.get(key)
                    for key in (
                        "title",
                        "authors",
                        "dates",
                        "year",
                        "abstract",
                        "type",
                        "publication",
                        "language",
                        "identifiers",
                        "open_access",
                        "locations",
                        "metrics",
                    )
                    if key in value
                },
            )
        )
    return works


def public_configuration(vault_path: Path | str) -> dict[str, Any]:
    config = load_config(vault_path)
    raw_params = load_params(strict_env=False).params
    params: dict[str, Any] = dict(raw_params) if isinstance(raw_params, dict) else {}
    raw_ai_config = params.get("ai", {})
    ai_config: dict[str, Any] = dict(raw_ai_config) if isinstance(raw_ai_config, dict) else {}
    agents = [
        {
            "id": str(agent.get("id") or ""),
            "name": str(agent.get("name") or agent.get("id") or ""),
            "provider": str(agent.get("provider") or ""),
            "model": str(agent.get("model") or ""),
        }
        for agent in (ai_config.get("agents") or [])
        if isinstance(agent, dict) and agent.get("id") and agent.get("enabled", True)
    ]
    selected_agent_id = str(config.get("ai_agent_id") or ai_config.get("active_agent_id") or "")
    return {
        "contact_email": config.get("contact_email") or "",
        "ai_agent_id": selected_agent_id,
        "ai_agents": agents,
        "source_defaults": config.get("source_defaults") or {},
        "hidden_sources": config.get("hidden_sources") or [],
        "sources": catalog(vault_path),
    }


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
    definition: dict[str, Any] = {
        "id": repository_id or f"custom-{uuid.uuid4().hex[:16]}",
        "name": name,
        "kind": kind,
        "base_url": base_url,
        "default_enabled": bool(payload.get("default_enabled", True)),
        "created_at": str(payload.get("created_at") or _now()),
        "updated_at": _now(),
    }
    if kind == "oai":
        definition.update(
            {
                "metadata_prefix": str(payload.get("metadata_prefix") or "oai_dc").strip()[:100],
                "set": str(payload.get("set") or "").strip()[:500],
                "sync_mode": str(payload.get("sync_mode") or "incremental")
                if str(payload.get("sync_mode") or "incremental") in {"full", "incremental"}
                else "incremental",
                "tombstones": bool(payload.get("tombstones", True)),
            }
        )
    else:
        raw_mapping = payload.get("mapping")
        mapping: dict[str, Any] = dict(raw_mapping) if isinstance(raw_mapping, dict) else {}
        raw_static_filters = payload.get("static_filters")
        static_filters: dict[str, Any] = (
            dict(raw_static_filters) if isinstance(raw_static_filters, dict) else {}
        )
        if not mapping.get("title"):
            raise HTTPException(status_code=400, detail="REST mapping requires a title field path.")
        definition.update(
            {
                "query_parameter": str(payload.get("query_parameter") or "q")[:100],
                "limit_parameter": str(payload.get("limit_parameter") or "limit")[:100],
                "results_path": str(payload.get("results_path") or "results")[:300],
                "pagination": str(payload.get("pagination") or "none")
                if str(payload.get("pagination") or "none")
                in {"none", "page", "offset", "cursor", "link"}
                else "none",
                "page_parameter": str(payload.get("page_parameter") or "page")[:100],
                "offset_parameter": str(payload.get("offset_parameter") or "offset")[:100],
                "cursor_parameter": str(payload.get("cursor_parameter") or "cursor")[:100],
                "next_cursor_path": str(payload.get("next_cursor_path") or "next_cursor")[:300],
                "static_filters": {
                    str(key)[:100]: str(value)[:1_000] for key, value in static_filters.items()
                },
                "mapping": {str(key)[:100]: str(value)[:300] for key, value in mapping.items()},
            }
        )
    return definition


def save_repository(
    vault_path: Path | str, payload: dict[str, Any], repository_id: str = ""
) -> dict[str, Any]:
    with _CONFIG_LOCK:
        config = load_config(vault_path)
        existing = next(
            (item for item in config["custom_repositories"] if item.get("id") == repository_id),
            None,
        )
        if repository_id and existing is None:
            raise HTTPException(status_code=404, detail="Custom repository not found.")
        definition = _validate_repository({**(existing or {}), **payload}, repository_id)
        config["custom_repositories"] = [
            item for item in config["custom_repositories"] if item.get("id") != definition["id"]
        ] + [definition]
        config["updated_at"] = _now()
        safe_write_json(_config_path(vault_path), config, indent=2, ensure_ascii=False)
        return definition


def delete_repository(
    vault_path: Path | str, repository_id: str, *, delete_index: bool = False
) -> dict[str, Any]:
    with _CONFIG_LOCK:
        config = load_config(vault_path)
        existing = next(
            (item for item in config["custom_repositories"] if item.get("id") == repository_id),
            None,
        )
        if existing is None:
            raise HTTPException(status_code=404, detail="Custom repository not found.")
        config["custom_repositories"] = [
            item for item in config["custom_repositories"] if item.get("id") != repository_id
        ]
        config["source_defaults"].pop(repository_id, None)
        config["updated_at"] = _now()
        safe_write_json(_config_path(vault_path), config, indent=2, ensure_ascii=False)
    removed = 0
    if delete_index:
        with _INDEX_LOCK, _connect_index(vault_path) as connection:
            removed = connection.execute(
                "SELECT COUNT(*) FROM oai_records WHERE source_id=?", (repository_id,)
            ).fetchone()[0]
            rowids = [
                row[0]
                for row in connection.execute(
                    "SELECT rowid FROM oai_records WHERE source_id=?", (repository_id,)
                ).fetchall()
            ]
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
    return {
        "ok": True,
        "latency_ms": int((datetime.now(timezone.utc) - started).total_seconds() * 1_000),
        "count": count,
        "sample": sample,
    }
