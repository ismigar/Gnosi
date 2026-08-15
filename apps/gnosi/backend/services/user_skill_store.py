"""Portable per-vault storage for user-authored declarative skills."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import threading
import unicodedata
import uuid
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

import yaml

from backend.models.agent_skills import (
    CatalogOrigin,
    OriginType,
    SkillDescriptor,
)
from backend.utils.safe_io import safe_write_text


MAX_DESCRIPTOR_BYTES = 256_000
MAX_INSTRUCTIONS_BYTES = 500_000
USER_SKILL_ID_RE = re.compile(
    r"^user\.[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$"
)


class UserSkillStoreError(ValueError):
    """Base error for portable user skill storage."""


class UserSkillNotFoundError(UserSkillStoreError):
    """Raised when a requested user skill package does not exist."""


class UserSkillConflictError(UserSkillStoreError):
    """Raised for duplicate IDs or optimistic revision conflicts."""


def _slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")
    return slug[:64].rstrip("-") or "skill"


def _revision(descriptor: SkillDescriptor) -> str:
    payload = json.dumps(
        descriptor.model_dump(mode="json"),
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _normalize_user_id(skill_id: str) -> str:
    normalized = str(skill_id or "").strip().lower()
    if not USER_SKILL_ID_RE.fullmatch(normalized):
        raise UserSkillStoreError(
            "user skill IDs must use the user.<name> namespace"
        )
    return normalized


class UserSkillStore:
    """Read and atomically update `<vault>/.gnosi/agent/skills` packages."""

    _locks: Dict[str, threading.RLock] = {}
    _locks_guard = threading.Lock()

    def __init__(self, vault_path: Path) -> None:
        if vault_path is None:
            raise ValueError("vault_path is required")
        self.vault_path = Path(vault_path)
        self.root = self.vault_path / ".gnosi" / "agent" / "skills"
        lock_key = str(self.root.absolute())
        with self._locks_guard:
            self._lock = self._locks.setdefault(lock_key, threading.RLock())

    def _package_path(self, skill_id: str) -> Path:
        normalized = _normalize_user_id(skill_id)
        return self.root / normalized

    @staticmethod
    def _read_limited(path: Path, maximum: int) -> str:
        try:
            size = path.stat().st_size
        except OSError as exc:
            raise UserSkillStoreError(f"could not inspect {path.name}: {exc}") from exc
        if size > maximum:
            raise UserSkillStoreError(f"{path.name} exceeds the size limit")
        try:
            return path.read_text(encoding="utf-8")
        except OSError as exc:
            raise UserSkillStoreError(f"could not read {path.name}: {exc}") from exc

    def _load_package(self, package: Path) -> SkillDescriptor:
        if package.is_symlink():
            raise UserSkillStoreError("symlinked skill packages are not allowed")
        descriptor_path = package / "skill.yaml"
        instructions_path = package / "SKILL.md"
        if not descriptor_path.is_file() or descriptor_path.is_symlink():
            raise UserSkillStoreError("skill.yaml is required and cannot be a symlink")
        if not instructions_path.is_file() or instructions_path.is_symlink():
            raise UserSkillStoreError("SKILL.md is required and cannot be a symlink")
        raw_text = self._read_limited(descriptor_path, MAX_DESCRIPTOR_BYTES)
        try:
            raw = yaml.safe_load(raw_text) or {}
        except yaml.YAMLError as exc:
            raise UserSkillStoreError(f"invalid skill.yaml: {exc}") from exc
        if not isinstance(raw, dict):
            raise UserSkillStoreError("skill.yaml must contain an object")
        raw["instructions"] = self._read_limited(
            instructions_path, MAX_INSTRUCTIONS_BYTES
        )
        # Ownership is derived from the storage boundary. A copied package
        # cannot impersonate core or plugin content by editing its YAML.
        raw["origin"] = CatalogOrigin(
            type=OriginType.USER, id="vault"
        ).model_dump(mode="python")
        try:
            descriptor = SkillDescriptor.model_validate(raw)
        except Exception as exc:
            raise UserSkillStoreError(f"invalid descriptor: {exc}") from exc
        if descriptor.id != package.name:
            raise UserSkillStoreError(
                "skill ID must match its package directory name"
            )
        return descriptor

    def load(self, skill_id: str) -> SkillDescriptor:
        package = self._package_path(skill_id)
        with self._lock:
            if not package.is_dir():
                raise UserSkillNotFoundError(f"skill not found: {skill_id}")
            return self._load_package(package)

    def load_all(self) -> Tuple[List[SkillDescriptor], List[Dict[str, str]]]:
        """Return valid skills and visible per-package validation issues."""

        with self._lock:
            if not self.root.exists():
                return [], []
            if not self.root.is_dir() or self.root.is_symlink():
                return [], [
                    {
                        "package": str(self.root),
                        "error": "skill storage root must be a directory, not a symlink",
                    }
                ]
            skills: List[SkillDescriptor] = []
            issues: List[Dict[str, str]] = []
            try:
                packages = sorted(self.root.iterdir(), key=lambda path: path.name)
            except OSError as exc:
                return [], [{"package": str(self.root), "error": str(exc)}]
            for package in packages:
                if package.name.startswith(".") or not package.is_dir():
                    continue
                try:
                    _normalize_user_id(package.name)
                    skills.append(self._load_package(package))
                except Exception as exc:
                    issues.append({"package": package.name, "error": str(exc)})
            return skills, issues

    @staticmethod
    def validate(
        metadata: Mapping[str, Any],
        instructions: str,
        *,
        skill_id: Optional[str] = None,
    ) -> SkillDescriptor:
        raw = dict(metadata)
        if skill_id is not None:
            raw["id"] = _normalize_user_id(skill_id)
        raw["origin"] = CatalogOrigin(
            type=OriginType.USER, id="vault"
        ).model_dump(mode="python")
        raw["instructions"] = instructions or ""
        return SkillDescriptor.model_validate(raw)

    def _write(self, descriptor: SkillDescriptor) -> None:
        package = self._package_path(descriptor.id)
        if package.exists() and package.is_symlink():
            raise UserSkillStoreError("symlinked skill packages are not allowed")
        package.mkdir(parents=True, exist_ok=True)
        metadata = descriptor.model_dump(
            mode="json",
            exclude={"instructions"},
            exclude_none=True,
        )
        # SKILL.md is written first; skill.yaml is the package's validity
        # marker and is atomically replaced last.
        safe_write_text(package / "SKILL.md", descriptor.instructions)
        safe_write_text(
            package / "skill.yaml",
            yaml.safe_dump(
                metadata,
                allow_unicode=True,
                default_flow_style=False,
                sort_keys=False,
            ),
        )

    def create(
        self,
        metadata: Mapping[str, Any],
        instructions: str,
        *,
        requested_id: Optional[str] = None,
    ) -> SkillDescriptor:
        with self._lock:
            if requested_id:
                skill_id = _normalize_user_id(requested_id)
                if self._package_path(skill_id).exists():
                    raise UserSkillConflictError(
                        f"skill already exists: {skill_id}"
                    )
            else:
                base = _slugify(str(metadata.get("name") or "skill"))
                # A random suffix prevents cross-device collisions when two
                # synchronized vault copies create the same named skill.
                for _ in range(20):
                    candidate = f"user.{base}-{uuid.uuid4().hex[:8]}"
                    if not self._package_path(candidate).exists():
                        skill_id = candidate
                        break
                else:
                    raise UserSkillConflictError(
                        "could not allocate a collision-safe skill ID"
                    )
            descriptor = self.validate(
                metadata, instructions, skill_id=skill_id
            )
            self._write(descriptor)
            return descriptor

    def update(
        self,
        skill_id: str,
        metadata: Mapping[str, Any],
        instructions: str,
        *,
        expected_revision: Optional[str] = None,
    ) -> SkillDescriptor:
        normalized = _normalize_user_id(skill_id)
        with self._lock:
            current = self.load(normalized)
            if expected_revision and expected_revision != _revision(current):
                raise UserSkillConflictError(
                    "skill changed since it was loaded"
                )
            descriptor = self.validate(
                metadata, instructions, skill_id=normalized
            )
            self._write(descriptor)
            return descriptor

    def delete(self, skill_id: str) -> None:
        normalized = _normalize_user_id(skill_id)
        package = self._package_path(normalized)
        with self._lock:
            if not package.is_dir():
                raise UserSkillNotFoundError(f"skill not found: {normalized}")
            if package.is_symlink():
                raise UserSkillStoreError("symlinked skill packages are not allowed")
            shutil.rmtree(package)

    def stage_delete(self, skill_id: str) -> Path:
        """Atomically hide a package before a cross-file assignment update."""

        normalized = _normalize_user_id(skill_id)
        package = self._package_path(normalized)
        with self._lock:
            if not package.is_dir():
                raise UserSkillNotFoundError(f"skill not found: {normalized}")
            if package.is_symlink():
                raise UserSkillStoreError("symlinked skill packages are not allowed")
            self.root.mkdir(parents=True, exist_ok=True)
            staged = self.root / f".deleted-{uuid.uuid4().hex}"
            package.replace(staged)
            return staged

    def rollback_delete(self, staged: Path, skill_id: str) -> None:
        with self._lock:
            if Path(staged).exists():
                Path(staged).replace(self._package_path(skill_id))

    def finalize_delete(self, staged: Path) -> None:
        with self._lock:
            staged_path = Path(staged)
            if staged_path.exists():
                shutil.rmtree(staged_path)

    def revision(self, skill_id: str) -> str:
        return _revision(self.load(skill_id))
