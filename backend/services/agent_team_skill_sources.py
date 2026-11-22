"""Personal procedure sources shared only between discovery passes of one chat."""

from __future__ import annotations

import asyncio
import threading
from collections.abc import AsyncIterator, Callable, Iterable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Literal

from backend.models.agent_skills import SkillDescriptor
from backend.platform.files import snapshots
from backend.platform.files.snapshots import revision
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_execution_scope import current_scope
from backend.utils import metadata_io

DiscoveryPhase = Literal["capture", "planning"]
ReadText = Callable[[Path], str]
LoadPackage = Callable[[Path, ReadText], SkillDescriptor]
ReadPackage = Callable[[Path, LoadPackage], SkillDescriptor]
SourceStamp = metadata_io.AllocatedFileStamp
Grants = dict[tuple[ExecutionScope, Path], tuple[int, ...]]
_planning_grants: ContextVar[Grants | None] = ContextVar("planning_skill_grants", default=None)


def _sources(package: Path, vault: Path) -> tuple[SourceStamp, ...]:
    try:
        stamps = []
        for name in ("skill.yaml", "SKILL.md"):
            stamp = metadata_io.allocated_vault_file_stamp(package / name, root=vault)
            if stamp is None:
                return ()
            stamps.append(stamp)
    except (OSError, metadata_io.MetadataUnavailable):
        return ()
    return tuple(stamps)


class ChatSkillSources:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._closed = False
        self._entries: dict[tuple[ExecutionScope, Path], tuple[tuple[SourceStamp, ...], SkillDescriptor]] = {}
        self._bytes = 0

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self._entries.clear()

    def capture(self, scope: ExecutionScope, package: Path, load: LoadPackage) -> SkillDescriptor:
        vault = Path(scope.vault_path)
        opened: dict[str, tuple[int, ...]] = {}

        def read(path: Path) -> str:
            text, info = metadata_io.read_vault_text_with_stat(path, root=vault)
            opened[path.name] = (*revision(info), getattr(info, "st_flags", 0))
            return text

        descriptor = load(package, read)
        sources = _sources(package, vault)
        if sources and all(opened.get(source.path.name) == source.revision for source in sources):
            size = sum(source.revision[2] for source in sources)  # Byte sizes of the two granted files.
            with self._lock:
                if not self._closed and len(self._entries) < 128 and self._bytes + size <= 4 * 1024 * 1024:
                    self._entries[scope, package] = sources, descriptor.model_copy(deep=True)
                    self._bytes += size
        return descriptor

    def native_grants(self, scope: ExecutionScope, assigned: Iterable[str]) -> Grants:
        # Include only assigned packages already seen during admission. Newly
        # discovered ancestors still go through the individual source reader.
        if scope != current_scope():
            return {}
        allowed = {identifier.strip().lower() for identifier in assigned if isinstance(identifier, str)}
        with self._lock:
            paths = tuple(
                source.path
                for (owner, package), (sources, _) in self._entries.items()
                if owner == scope and package.name in allowed
                for source in sources if source.native
            )
        if not paths:
            return {}
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            proofs = snapshots.reads.verify_skill_sources(paths)
            return {(scope, path): (*revision(info), getattr(info, "st_flags", 0)) for path, info in proofs.items()}
        return {}

    def planning(self, scope: ExecutionScope, package: Path, load: LoadPackage) -> SkillDescriptor:
        vault = Path(scope.vault_path)
        with self._lock:
            entry = self._entries.get((scope, package))
        grants = _planning_grants.get() or {}
        authorized = entry and all(
            not source.native or grants.get((scope, source.path)) == source.revision for source in entry[0]
        )
        if entry and authorized and entry[0] == _sources(package, vault):
            return entry[1].model_copy(deep=True)
        return load(package, lambda path: metadata_io.read_vault_text(path, root=vault))

    def reader(self, vault: Path, phase: DiscoveryPhase) -> ReadPackage | None:
        scope = current_scope()
        if vault.resolve() != Path(scope.vault_path):
            return None
        method = self.capture if phase == "capture" else self.planning

        def read(package: Path, load: LoadPackage) -> SkillDescriptor:
            current = current_scope()
            root = Path(current.vault_path)
            if vault.resolve() != root:
                raise PermissionError("agent_execution_scope_or_skill_mismatch")
            return method(current, root / package.relative_to(vault), load)

        return read


chat_sources: ContextVar[ChatSkillSources | None] = ContextVar("chat_skill_sources", default=None)


@contextmanager
def planning_skill_grants(scope: ExecutionScope, assigned: Iterable[str]) -> Iterator[None]:
    sources = chat_sources.get()
    grants = sources.native_grants(scope, assigned) if sources is not None else {}
    token = _planning_grants.set(grants)
    try:
        yield
    finally:
        _planning_grants.reset(token)


async def bind_chat_skill_sources() -> AsyncIterator[None]:
    sources = ChatSkillSources()
    token = chat_sources.set(sources)
    try:
        yield
    finally:
        sources.close()
        chat_sources.reset(token)
