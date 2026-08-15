"""`apply_filter` must tolerate a column RENAME.

When a column is renamed, the `by-table` metadata is canonicalized to the
NEW name (`Àrees`) but the views' saved filters may still carry an
OLD variant of the name (with a decorative prefix, different spacing or casing).
The filter must still match by resolving the field by its NORMALIZED name
(`_normalize_field_key`: lowercase, no leading decorative prefix), or ALL
the by-area views come back empty.

See docs/dev_memory/directives/vault_relation_inverse_sync.md
"""
from __future__ import annotations

from backend.services.view_snapshot import (
    _meta_value_for_field,
    _normalize_field_key,
    apply_filter,
)

HOST = "1d2268e5-2714-8000-a413-c23a457bc7de"


def test_normalize_strips_decorative_prefix():
    assert _normalize_field_key("» Àrees") == _normalize_field_key("Àrees") == "àrees"
    assert _normalize_field_key("»· Extractes") == "extractes"
    assert _normalize_field_key("Arxivat") == "arxivat"


def test_meta_value_exact_key_wins():
    assert _meta_value_for_field({"» Àrees": [1]}, "» Àrees") == [1]


def test_meta_value_falls_back_to_normalized():
    # canonicalized metadata (clean name), filter with an old variant of the name
    assert _meta_value_for_field({"Àrees": ["x"]}, "» Àrees") == ["x"]
    # i a la inversa
    assert _meta_value_for_field({"» Àrees": ["x"]}, "Àrees") == ["x"]


def test_filter_matches_after_rename():
    """The real case: a view filters by an old variant; metadata has `Àrees`."""
    meta = {"Àrees": [HOST, "other-area"]}
    f = {"field": "» Àrees", "operator": "equals", "value": "this"}
    assert apply_filter(meta, HOST, f) is True
    assert apply_filter(meta, "absent", f) is False


def test_filter_still_works_without_rename():
    meta = {"Àrees": [HOST]}
    f = {"field": "Àrees", "operator": "equals", "value": "this"}
    assert apply_filter(meta, HOST, f) is True


def test_filter_empty_when_no_inverse():
    meta = {"Àrees": ["other-area"]}
    f = {"field": "» Àrees", "operator": "equals", "value": "this"}
    assert apply_filter(meta, HOST, f) is False


def test_not_equals_after_rename():
    meta = {"Àrees": ["other-area"]}
    f = {"field": "» Àrees", "operator": "not_equals", "value": "this"}
    assert apply_filter(meta, HOST, f) is True  # HOST is not present → not_equals true
