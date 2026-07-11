"""Tolerant frontmatter parser for when `yaml.safe_load` fails.

SINGLE source of truth for rescuing malformed frontmatter. It used to live
duplicated as `_parse_frontmatter_fallback` in `vault_routes.py`, but
`graph_service.parse_frontmatter` did NOT have it: a page with slightly
malformed YAML (an unclosed quote, a tab, a reserved indicator…) would read
correctly in the Vault (via this rescue) but came out EMPTY in the graph (without
title, type, or color). Sharing it guarantees that both reads recover
the same top-level metadata.
"""
from __future__ import annotations

import re


def parse_frontmatter_fallback(yaml_content: str) -> dict:
    """Rescues the top-level scalar `key: value` pairs from a
    frontmatter that `yaml.safe_load` has rejected.

    Intentionally ignores nested blocks/objects/lists and only saves top-level
    scalars, so that listings can resolve id/title/
    table_id even if another key has corrupt YAML.
    
    """
    metadata: dict = {}
    for raw_line in yaml_content.splitlines():
        line = raw_line.rstrip()
        if not line:
            continue

        stripped = line.lstrip()
        if stripped.startswith("#"):
            continue

        # Ignore nested YAML blocks and list members to avoid corrupting the parsing.
        if line.startswith((" ", "\t", "- ")):
            continue

        if ":" not in line:
            continue

        key, value = line.split(":", 1)
        key = key.strip()
        if not key:
            continue

        parsed_value = value.strip()

        if len(parsed_value) >= 2 and (
            (parsed_value[0] == '"' and parsed_value[-1] == '"')
            or (parsed_value[0] == "'" and parsed_value[-1] == "'")
        ):
            parsed_value = parsed_value[1:-1]

        lowered = parsed_value.lower()
        if lowered == "true":
            metadata[key] = True
        elif lowered == "false":
            metadata[key] = False
        elif re.fullmatch(r"-?\d+", parsed_value):
            metadata[key] = int(parsed_value)
        else:
            metadata[key] = parsed_value

    return metadata
