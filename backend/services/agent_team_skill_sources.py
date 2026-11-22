"""Personal procedure sources shared only between discovery passes of one chat."""

from __future__ import annotations

import threading
from collections.abc import AsyncIterator, Callable
from contextvars import ContextVar
from pathlib import Path
from typing import Literal

from backend.models.agent_skills import SkillDescriptor
from backend.platform.files.snapshots import revision
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_execution_scope import current_scope
from backend.utils import metadata_io

DiscoveryPhase = Literal["capture", "planning"]
ReadText = Callable[[Path], str]
LoadPackage = Callable[[Path, ReadText], SkillDescriptor]
ReadPackage = Callable[[Path, LoadPackage], SkillDescriptor]
SourceStamp = tuple[Path, tuple[int, ...]]


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
        if sources and all(opened.get(path.name) == stamp for path, stamp in sources):
            size = sum(stamp[2] for _, stamp in sources)  # Byte sizes of the two granted files.
            with self._lock:
                if not self._closed and len(self._entries) < 128 and self._bytes + size <= 4 * 1024 * 1024:
                    self._entries[scope, package] = sources, descriptor.model_copy(deep=True)
                    self._bytes += size
        return descriptor

    def planning(self, scope: ExecutionScope, package: Path, load: LoadPackage) -> SkillDescriptor:
        vault = Path(scope.vault_path)
        with self._lock:
            entry = self._entries.get((scope, package))
        if entry and entry[0] == _sources(package, vault):
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


async def bind_chat_skill_sources() -> AsyncIterator[None]:
    sources = ChatSkillSources()
    token = chat_sources.set(sources)
    try:
        yield
    finally:
        sources.close()
        chat_sources.reset(token)
