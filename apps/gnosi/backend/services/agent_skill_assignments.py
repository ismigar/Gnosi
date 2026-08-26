"""Revision-aware agent skill assignments and legacy migration."""

from __future__ import annotations

import copy
import hashlib
import json
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

import yaml

from backend.models.agent_skills import SkillKind
from backend.services.agent_skill_catalog import SkillCatalog
from backend.utils.safe_io import file_etag, safe_write_text


LEGACY_SKILL_ID = "core.legacy-default-v1"
AI_SCHEMA_VERSION = 2


class AgentAssignmentError(ValueError):
    """Base error for agent skill assignment operations."""


class AgentNotFoundError(AgentAssignmentError):
    """Raised when an agent profile does not exist."""


class AgentAssignmentConflictError(AgentAssignmentError):
    """Raised when assignments are stale, invalid, or unavailable."""

    def __init__(self, message: str, *, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.details = details or {}


def migrate_legacy_agent_skills(params: Dict[str, Any]) -> bool:
    """Materialize legacy assignments without overwriting explicit empties.

    The operation mutates ``params`` and is idempotent. Only the absence of the
    ``skill_ids`` key means "legacy"; ``skill_ids: []`` means deliberately no
    skills and remains untouched.
    """

    if not isinstance(params, dict):
        raise TypeError("params must be a dictionary")
    ai = params.setdefault("ai", {})
    if not isinstance(ai, dict):
        raise ValueError("ai configuration must be an object")
    changed = False
    agents = ai.get("agents")
    if agents is None:
        agents = []
    if not isinstance(agents, list):
        raise ValueError("ai.agents must be a list")
    for agent in agents:
        if not isinstance(agent, dict):
            continue
        if "skill_ids" not in agent:
            agent["skill_ids"] = [LEGACY_SKILL_ID]
            changed = True
    current_schema = ai.get("schema_version")
    if not isinstance(current_schema, int) or current_schema < AI_SCHEMA_VERSION:
        ai["schema_version"] = AI_SCHEMA_VERSION
        changed = True
    return changed


def _stable_revision(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class AgentSkillAssignmentStore:
    """Update one params.yaml without replacing unrelated configuration."""

    _locks: Dict[str, threading.RLock] = {}
    _locks_guard = threading.Lock()

    def __init__(
        self,
        params_path: Path,
        params: Optional[Mapping[str, Any]] = None,
    ) -> None:
        self.params_path = Path(params_path)
        self.params: Dict[str, Any] = copy.deepcopy(dict(params or {}))
        self._disk_etag = file_etag(self.params_path)
        lock_key = str(self.params_path.absolute())
        with self._locks_guard:
            self._lock = self._locks.setdefault(lock_key, threading.RLock())

    @classmethod
    def load(
        cls,
        params_path: Path,
        *,
        fallback_params: Optional[Mapping[str, Any]] = None,
    ) -> "AgentSkillAssignmentStore":
        path = Path(params_path)
        params: Dict[str, Any] = {}
        if path.exists():
            try:
                raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            except (OSError, yaml.YAMLError) as exc:
                raise AgentAssignmentError(
                    f"could not read AI configuration: {exc}"
                ) from exc
            if not isinstance(raw, dict):
                raise AgentAssignmentError("params.yaml must contain an object")
            params = raw
        elif fallback_params is not None:
            params = copy.deepcopy(dict(fallback_params))
        return cls(path, params)

    def _agents(self) -> List[Dict[str, Any]]:
        ai = self.params.setdefault("ai", {})
        if not isinstance(ai, dict):
            raise AgentAssignmentError("ai configuration must be an object")
        agents = ai.setdefault("agents", [])
        if not isinstance(agents, list):
            raise AgentAssignmentError("ai.agents must be a list")
        return [agent for agent in agents if isinstance(agent, dict)]

    def _refresh_if_changed(self) -> None:
        """Rebase a stale request snapshot before mutating shared params.yaml."""

        current_etag = file_etag(self.params_path)
        if current_etag == self._disk_etag or current_etag is None:
            return
        try:
            raw = yaml.safe_load(
                self.params_path.read_text(encoding="utf-8")
            ) or {}
        except (OSError, yaml.YAMLError) as exc:
            raise AgentAssignmentError(
                f"could not refresh AI configuration: {exc}"
            ) from exc
        if not isinstance(raw, dict):
            raise AgentAssignmentError("params.yaml must contain an object")
        self.params = raw
        self._disk_etag = current_etag

    def _find_agent(self, agent_id: str) -> Dict[str, Any]:
        normalized = str(agent_id or "").strip()
        for agent in self._agents():
            if str(agent.get("id") or "").strip() == normalized:
                return agent
        raise AgentNotFoundError(f"agent not found: {normalized}")

    def save(self) -> None:
        yaml_text = yaml.safe_dump(
            self.params,
            allow_unicode=True,
            default_flow_style=False,
            sort_keys=False,
        )
        safe_write_text(self.params_path, yaml_text)
        self._disk_etag = file_etag(self.params_path)

    def ensure_migrated(self) -> bool:
        with self._lock:
            self._refresh_if_changed()
            changed = migrate_legacy_agent_skills(self.params)
            if changed:
                self.save()
            return changed

    def agent_revision(self, agent_id: str) -> str:
        with self._lock:
            self._refresh_if_changed()
            return _stable_revision(self._find_agent(agent_id))

    def get_agent(self, agent_id: str) -> Dict[str, Any]:
        """Return a detached agent profile for API serialization."""

        with self._lock:
            self._refresh_if_changed()
            return copy.deepcopy(self._find_agent(agent_id))

    def list_agents_for_skill(self, skill_id: str) -> List[str]:
        normalized = str(skill_id or "").strip().lower()
        with self._lock:
            self._refresh_if_changed()
            return [
                str(agent.get("id"))
                for agent in self._agents()
                if normalized
                in {
                    str(value or "").strip().lower()
                    for value in (agent.get("skill_ids") or [])
                }
            ]

    def assign(
        self,
        agent_id: str,
        skill_ids: Iterable[str],
        *,
        catalog: SkillCatalog,
        vault_path: Optional[Path] = None,
        expected_revision: Optional[str] = None,
    ) -> Tuple[Dict[str, Any], str]:
        normalized_ids: List[str] = []
        seen = set()
        for value in skill_ids:
            skill_id = str(value or "").strip().lower()
            if not skill_id:
                raise AgentAssignmentConflictError("skill IDs cannot be empty")
            if skill_id in seen:
                raise AgentAssignmentConflictError(
                    f"duplicate skill assignment: {skill_id}"
                )
            seen.add(skill_id)
            normalized_ids.append(skill_id)

        with self._lock:
            self._refresh_if_changed()
            agent = self._find_agent(agent_id)
            current_revision = _stable_revision(agent)
            if expected_revision and expected_revision != current_revision:
                raise AgentAssignmentConflictError(
                    "agent changed since it was loaded",
                    details={"current_revision": current_revision},
                )

            entries = {
                entry.descriptor.id: entry
                for entry in catalog.list_entries(vault_path)
            }
            missing = [
                skill_id for skill_id in normalized_ids if skill_id not in entries
            ]
            incompatible = [
                skill_id
                for skill_id in normalized_ids
                if skill_id in entries
                and entries[skill_id].descriptor.kind != SkillKind.AGENT
            ]
            unavailable = [
                skill_id
                for skill_id in normalized_ids
                if skill_id in entries and not entries[skill_id].available
            ]
            required = {
                str(value or "").strip().lower()
                for value in (agent.get("required_skill_ids") or [])
                if str(value or "").strip()
            }
            omitted_required = sorted(required.difference(normalized_ids))
            if missing or incompatible or unavailable or omitted_required:
                raise AgentAssignmentConflictError(
                    "one or more skill assignments are invalid",
                    details={
                        "missing_skill_ids": missing,
                        "incompatible_skill_ids": incompatible,
                        "unavailable_skill_ids": unavailable,
                        "required_skill_ids": omitted_required,
                    },
                )

            agent["skill_ids"] = normalized_ids
            ai = self.params.setdefault("ai", {})
            ai["schema_version"] = AI_SCHEMA_VERSION
            self.save()
            return copy.deepcopy(agent), _stable_revision(agent)

    def unassign_skill(self, skill_id: str) -> List[str]:
        """Remove a skill from every agent and persist once."""

        normalized = str(skill_id or "").strip().lower()
        affected: List[str] = []
        with self._lock:
            self._refresh_if_changed()
            for agent in self._agents():
                current = [
                    str(value or "").strip().lower()
                    for value in (agent.get("skill_ids") or [])
                    if str(value or "").strip()
                ]
                if normalized not in current:
                    continue
                required = {
                    str(value or "").strip().lower()
                    for value in (agent.get("required_skill_ids") or [])
                }
                if normalized in required:
                    raise AgentAssignmentConflictError(
                        "required plugin skills cannot be unassigned",
                        details={
                            "agent_id": str(agent.get("id") or ""),
                            "required_skill_ids": [normalized],
                        },
                    )
                agent["skill_ids"] = [
                    value for value in current if value != normalized
                ]
                affected.append(str(agent.get("id") or ""))
            if affected:
                self.save()
        return affected
