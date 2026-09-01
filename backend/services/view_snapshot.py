"""Compatibility facade for persisted saved-view snapshots and row evaluation.

Canonical implementations live in ``backend.domains.vault.views``. This
module preserves the historical import path and the late-bound relation-link
decorator used by snapshot materialization.
"""

from __future__ import annotations

import json as json
import re as re
import unicodedata as unicodedata
from datetime import date as date
from functools import cmp_to_key as cmp_to_key
from typing import Any as Any
from typing import Callable as Callable
from typing import Dict as Dict
from typing import List as List
from typing import Optional as Optional
from typing import Sequence as Sequence

from backend.domains.vault.views.filters import COMMA_DECIMAL_RE as _COMMA_DECIMAL_RE
from backend.domains.vault.views.filters import FULL_NUMERIC_RE as _FULL_NUMERIC_RE
from backend.domains.vault.views.filters import ISO_DATE_RE as _ISO_DATE_RE
from backend.domains.vault.views.filters import JS_PARSEFLOAT_RE as _JS_PARSEFLOAT_RE
from backend.domains.vault.views.filters import REGEX_FLAGS_RE as _REGEX_FLAGS_RE
from backend.domains.vault.views.filters import REGEX_LITERAL_RE as _REGEX_LITERAL_RE
from backend.domains.vault.views.filters import TRUTHY as _TRUTHY
from backend.domains.vault.views.filters import apply_filter as apply_filter
from backend.domains.vault.views.filters import apply_filter_node as apply_filter_node
from backend.domains.vault.views.filters import as_bool as _as_bool
from backend.domains.vault.views.filters import is_filter_group as _is_filter_group
from backend.domains.vault.views.filters import is_structured_author as _is_structured_author
from backend.domains.vault.views.filters import (
    matches_structured_authorship as _matches_structured_authorship,
)
from backend.domains.vault.views.filters import matches_text_pattern as _matches_text_pattern
from backend.domains.vault.views.filters import meta_value_for_field as _meta_value_for_field
from backend.domains.vault.views.filters import normalize_field_key as _normalize_field_key
from backend.domains.vault.views.filters import normalize_search_text as _normalize_search_text
from backend.domains.vault.views.filters import parse_float_js as _parse_float_js
from backend.domains.vault.views.filters import parse_numeric_value as _parse_numeric_value
from backend.domains.vault.views.filters import period_boundary as _period_boundary
from backend.domains.vault.views.filters import text_values as _text_values
from backend.domains.vault.views.row_resolution import apply_joins as apply_joins
from backend.domains.vault.views.row_resolution import resolve_row_ids as resolve_row_ids
from backend.domains.vault.views.row_resolution import resolve_rows as resolve_rows
from backend.domains.vault.views.row_resolution import row_lookup_by_field as _row_lookup_by_field
from backend.domains.vault.views.runtime_types import (
    ResolveIds,
    ResolveTable,
    ResolveTitle,
    SnapshotConfig,
)
from backend.domains.vault.views.snapshot_markup import DEFAULT_MAX_ITEMS as DEFAULT_MAX_ITEMS
from backend.domains.vault.views.snapshot_markup import DEF_COMMENT_RE as _DEF_COMMENT_RE
from backend.domains.vault.views.snapshot_markup import FENCE_RE as _FENCE_RE
from backend.domains.vault.views.snapshot_markup import FRONTMATTER_RE as _FRONTMATTER_RE
from backend.domains.vault.views.snapshot_markup import RESULT_RENDER_RE as _RESULT_RENDER_RE
from backend.domains.vault.views.snapshot_markup import RESULT_TRUNC_RE as _RESULT_TRUNC_RE
from backend.domains.vault.views.snapshot_markup import SNAPSHOT_BLOCK_RE as _SNAPSHOT_BLOCK_RE
from backend.domains.vault.views.snapshot_markup import (
    SNAPSHOT_OPEN_PREFIX as SNAPSHOT_OPEN_PREFIX,
)
from backend.domains.vault.views.snapshot_markup import (
    SNAPSHOT_WIKILINK_RE as _SNAPSHOT_WIKILINK_RE,
)
from backend.domains.vault.views.snapshot_markup import build_list_block as _build_block
from backend.domains.vault.views.snapshot_markup import build_table_block as _build_table_block
from backend.domains.vault.views.snapshot_markup import (
    compact_view_fences as compact_view_fences,
)
from backend.domains.vault.views.snapshot_markup import (
    flatten_view_columns as flatten_view_columns,
)
from backend.domains.vault.views.snapshot_markup import markdown_cell as _md_cell
from backend.domains.vault.views.snapshot_markup import (
    render_view_snapshots as render_view_snapshots,
)
from backend.domains.vault.views.snapshot_markup import (
    restore_view_fences as restore_view_fences,
)
from backend.domains.vault.views.snapshot_markup import (
    strip_view_snapshots as strip_view_snapshots,
)
from backend.domains.vault.views.snapshot_materialization import (
    inject_view_snapshots as _inject_view_snapshots,
)
from backend.domains.vault.views.snapshot_materialization import (
    rematerialize_md as _rematerialize_md,
)
from backend.domains.vault.views.sorting import SORTKEY_LEAD_RE as _SORTKEY_LEAD_RE
from backend.domains.vault.views.sorting import collation_key as _collation_key
from backend.domains.vault.views.sorting import compare_field_values as _compare_field_values
from backend.domains.vault.views.sorting import js_string as _js_str
from backend.domains.vault.views.sorting import multi_key_sort as multi_key_sort
from backend.domains.vault.views.sorting import sort_key as sort_key
from backend.services.relation_links import _decorate_item as _decorate_item


def inject_view_snapshots(
    body: object,
    resolve_ids: ResolveIds,
    id_to_title: ResolveTitle | None = None,
    host_page_id: str | None = None,
    max_items: int = DEFAULT_MAX_ITEMS,
    config_for: SnapshotConfig | None = None,
    resolve_table: ResolveTable | None = None,
) -> object:
    """Preserve the historical facade and late-bound decoration seam."""
    return _inject_view_snapshots(
        body,
        resolve_ids,
        id_to_title=id_to_title,
        host_page_id=host_page_id,
        max_items=max_items,
        config_for=config_for,
        resolve_table=resolve_table,
        decorate_item=_decorate_item,
    )


def rematerialize_md(
    raw: object,
    host_page_id: str | None,
    resolve_ids: ResolveIds,
    id_to_title: ResolveTitle | None = None,
    config_for: SnapshotConfig | None = None,
    resolve_table: ResolveTable | None = None,
) -> object:
    """Refresh one full Markdown document through the canonical domain."""
    return _rematerialize_md(
        raw,
        host_page_id,
        resolve_ids,
        id_to_title=id_to_title,
        config_for=config_for,
        resolve_table=resolve_table,
        decorate_item=_decorate_item,
    )
