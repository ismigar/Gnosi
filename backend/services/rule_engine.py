"""Compatibility facade for typed database formulas, rollups and automations."""

from __future__ import annotations

import datetime as _datetime
import json as json
import logging
import math as math
import re as re
import threading as threading
from collections import deque as deque
from datetime import datetime as datetime
from pathlib import Path
from typing import Any as Any
from typing import Dict as Dict
from typing import List as List
from typing import Optional as Optional
from typing import Set as Set
from typing import Tuple as Tuple
from typing import cast

import yaml as yaml
from simpleeval import (  # type: ignore[import-untyped]  # Historical public seam.
    NameNotDefined as NameNotDefined,
)
from simpleeval import SimpleEval as SimpleEval

from backend.domains.vault.tables.rules.definitions import (
    canonical_for_compare as _canonical_for_compare,
)
from backend.domains.vault.tables.rules.engine import RuleEngine as _DomainRuleEngine
from backend.domains.vault.tables.rules.types import (
    Evaluator,
    FunctionMap,
    Metadata,
    PathResolverPort,
    RuleEngineDependencies,
)
from backend.services.path_resolver import path_resolver as path_resolver
from backend.services.relation_links import relation_keys_from_table as relation_keys_from_table
from backend.services.relation_links import strip_relation_wikilinks as strip_relation_wikilinks

log = logging.getLogger(__name__)


def _new_evaluator() -> Evaluator:
    return cast(Evaluator, SimpleEval())


def _scoped_evaluator(names: Metadata, functions: FunctionMap) -> Evaluator:
    return cast(Evaluator, SimpleEval(names=names, functions=functions))


def _current_path_resolver() -> PathResolverPort:
    return cast(PathResolverPort, path_resolver)


def _relation_keys(table: Metadata | None) -> set[str]:
    return set(relation_keys_from_table(table))


def _strip_relations(metadata: Metadata, relation_keys: set[str] | None) -> Metadata:
    stripped = strip_relation_wikilinks(metadata, relation_keys)
    return cast(Metadata, stripped) if isinstance(stripped, dict) else metadata


def _dependencies() -> RuleEngineDependencies:
    return RuleEngineDependencies(
        new_evaluator=_new_evaluator,
        scoped_evaluator=_scoped_evaluator,
        path_resolver=_current_path_resolver,
        relation_keys_from_table=_relation_keys,
        strip_relation_wikilinks=_strip_relations,
        logger=log,
    )


class RuleEngine(_DomainRuleEngine):
    """Historical constructor over the canonical typed domain engine."""

    def __init__(self, vault_path: Path) -> None:
        super().__init__(vault_path, _dependencies())
