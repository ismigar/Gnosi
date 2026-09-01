"""Compatibility facade for the graph domain."""

import subprocess
import time

from backend.domains.graph.scanning import (
    COLOR_PALETTE,
    IGNORED_DIRS,
    _DIR_WARMUP_REQUESTED,
    _DIR_WARMUP_THROTTLE_S,
    _KIND_PATTERNS,
    _STATUS_IDEA_RE,
    _cluster_label,
    _node_cluster,
    _request_dir_warmup,
    _resolve_active_vault_path,
    _string_to_color,
    get_markdown_files_efficient,
    log,
    parse_frontmatter,
    parse_section_links,
)
from backend.domains.graph.service import GraphService

__all__ = [
    "COLOR_PALETTE",
    "GraphService",
    "IGNORED_DIRS",
    "_DIR_WARMUP_REQUESTED",
    "_DIR_WARMUP_THROTTLE_S",
    "_KIND_PATTERNS",
    "_STATUS_IDEA_RE",
    "_cluster_label",
    "_node_cluster",
    "_request_dir_warmup",
    "_resolve_active_vault_path",
    "_string_to_color",
    "get_markdown_files_efficient",
    "log",
    "parse_frontmatter",
    "parse_section_links",
    "subprocess",
    "time",
]
