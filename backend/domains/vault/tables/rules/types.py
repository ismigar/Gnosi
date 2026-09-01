"""Ports and shared value types for database rule evaluation."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, TypeAlias

Metadata: TypeAlias = dict[str, Any]
Definition: TypeAlias = dict[str, Any]
FunctionMap: TypeAlias = dict[str, Callable[..., Any]]


class Evaluator(Protocol):
    names: Metadata
    functions: FunctionMap

    def eval(self, expression: str) -> Any: ...


class PathResolverPort(Protocol):
    def find_path(self, record_id: str, vault_path: Path) -> Path | None: ...

    def list_all_files(self, vault_path: Path) -> list[Path]: ...


@dataclass(frozen=True)
class RuleEngineDependencies:
    """Late-bound collaborators retained by the historical service facade."""

    new_evaluator: Callable[[], Evaluator]
    scoped_evaluator: Callable[[Metadata, FunctionMap], Evaluator]
    path_resolver: Callable[[], PathResolverPort]
    relation_keys_from_table: Callable[[Metadata | None], set[str]]
    strip_relation_wikilinks: Callable[[Metadata, set[str] | None], Metadata]
    logger: logging.Logger


__all__ = [
    "Definition",
    "Evaluator",
    "FunctionMap",
    "Metadata",
    "PathResolverPort",
    "RuleEngineDependencies",
]
