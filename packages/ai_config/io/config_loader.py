import os
import re
from typing import Any, Dict, Optional

from ..schema.runtime_schema import RuntimeConfigSchema

VARIABLE_PATTERN = re.compile(r'\$\{([A-Z0-9_]+)\}')


def _expand_string(value: str, variables: Dict[str, str]) -> str:
    def replace(match):
        key = match.group(1)
        return variables.get(key, match.group(0))

    return VARIABLE_PATTERN.sub(replace, value)


def _deep_expand(value: Any, variables: Dict[str, str]) -> Any:
    if isinstance(value, str):
        return _expand_string(value, variables)
    if isinstance(value, list):
        return [_deep_expand(v, variables) for v in value]
    if isinstance(value, dict):
        return {k: _deep_expand(v, variables) for k, v in value.items()}
    return value


def load_config(raw: dict, env: Optional[Dict[str, str]] = None, variables: Optional[Dict[str, str]] = None):
    base_vars = dict(os.environ)
    base_vars.update(env or {})
    if variables:
        base_vars.update(variables)
    expanded = _deep_expand(raw, base_vars)
    return RuntimeConfigSchema(**expanded)


def materialize_runtime_config(raw: dict, env: Optional[Dict[str, str]] = None, variables: Optional[Dict[str, str]] = None):
    return load_config(raw, env=env, variables=variables)
