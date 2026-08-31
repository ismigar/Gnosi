"""Ports and shared value types for database rule evaluation."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, TypeAlias

from backend.domains.vault.registry.state import RegistryData

Metadata: TypeAlias = RegistryData
Definition: TypeAlias = RegistryData
# Scoped evaluators receive the original metadata, including opaque keys.
# Only the separately constructed function registry requires string names.
EvaluatorNames: TypeAlias = RegistryData
FunctionMap: TypeAlias = dict[str, Callable[..., object]]


class Evaluator(Protocol):
    names: EvaluatorNames
    functions: FunctionMap

    def eval(self, expression: str) -> object: ...


class PathResolverPort(Protocol):
    def find_path(self, record_id: str, vault_path: Path) -> Path | None: ...

    def list_all_files(self, vault_path: Path) -> list[Path]: ...


@dataclass(frozen=True)
class RuleEngineDependencies:
    """Late-bound collaborators retained by the historical service facade."""

    new_evaluator: Callable[[], Evaluator]
    scoped_evaluator: Callable[[EvaluatorNames, FunctionMap], Evaluator]
    path_resolver: Callable[[], PathResolverPort]
    relation_keys_from_table: Callable[[Metadata | None], set[str]]
    strip_relation_wikilinks: Callable[[Metadata, set[str] | None], Metadata]
    logger: logging.Logger


__all__ = [
    "Definition",
    "Evaluator",
    "EvaluatorNames",
    "FunctionMap",
    "Metadata",
    "PathResolverPort",
    "RuleEngineDependencies",
]
