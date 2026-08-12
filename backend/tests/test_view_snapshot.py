"""Snapshot of view results in the markdown body — round-trip and resolution.

Mirrors test_relation_wikilinks.py for the body: inject (domain → wikilinks),
strip (wikilinks → clean body), idempotency, and filter/order fidelity relative to
the frontend (DbViewEmbed).
"""
from datetime import date

from backend.services.view_snapshot import (
    _parse_numeric_value,
    apply_filter,
    apply_filter_node,
    compact_view_fences,
    inject_view_snapshots,
    multi_key_sort,
    rematerialize_md,
    resolve_row_ids,
    restore_view_fences,
    sort_key,
    strip_view_snapshots,
)

PAGE = "host-page-id"
VID = "view-123"
A, B, C = "id-a", "id-b", "id-c"
TITLES = {A: "Alpha", B: "Bèta", C: "Çedilla"}


def _id_to_title(rid):
    return TITLES.get(rid)


def _fence(view_id=VID):
    return (
        "```gnosi-view\n"
        "{\n"
        f'  "view_id": "{view_id}",\n'
        '  "heading": "",\n'
        '  "heading_level": 1\n'
        "}\n"
        "```\n"
    )


# --- sort_key ---------------------------------------------------------------
def test_sort_key_strips_leading_punct():
    assert sort_key("¿Què és?") == "Què és?"
    assert sort_key("  - hola") == "hola"
    assert sort_key("Normal") == "Normal"
    assert sort_key(None) == ""
    assert sort_key(2024) == "2024"


# --- apply_filter (port of DbViewEmbed.applyFilter) -------------------------
def test_filter_this_equals_on_relation_list():
    f = {"field": "Àrea", "operator": "equals", "value": "this"}
    assert apply_filter({"Àrea": [PAGE, "other"]}, PAGE, f) is True
    assert apply_filter({"Àrea": ["other"]}, PAGE, f) is False


def test_filter_is_empty_and_not_empty():
    assert apply_filter({"x": []}, PAGE, {"field": "x", "operator": "is_empty"}) is True
    assert apply_filter({"x": [1]}, PAGE, {"field": "x", "operator": "is_empty"}) is False
    assert apply_filter({"x": [1]}, PAGE, {"field": "x", "operator": "is_not_empty"}) is True


def test_filter_contains_and_numeric():
    assert apply_filter({"t": "hola mon"}, PAGE, {"field": "t", "operator": "contains", "value": "mon"}) is True
    assert apply_filter({"n": "5"}, PAGE, {"field": "n", "operator": "greater_than", "value": "3"}) is True
    assert apply_filter({"n": "2"}, PAGE, {"field": "n", "operator": "greater_than", "value": "3"}) is False


def test_filter_text_supports_percent_wildcards_and_explicit_regex():
    meta = {"t": "Ismael García Fernández"}
    assert apply_filter(meta, PAGE, {"field": "t", "operator": "contains", "value": "Ismael%Fernandez"}) is True
    assert apply_filter(meta, PAGE, {"field": "t", "operator": "equals", "value": "%Garcia%"}) is True
    assert apply_filter(meta, PAGE, {"field": "t", "operator": "contains", "value": r"/^ismael\s+garc.*fernandez$/i"}) is True
    assert apply_filter(meta, PAGE, {"field": "t", "operator": "contains", "value": "Joan%"}) is False


def test_structured_authorship_matches_components_on_the_same_author():
    meta = {
        "Autoría": [
            {"nom": "Ismael", "cognom1": "García", "cognom2": "Fernández"},
            {"nom": "Maria", "cognom1": "Serra", "cognom2": "Pons"},
        ]
    }
    assert apply_filter(meta, PAGE, {
        "field": "Autoría",
        "operator": "contains",
        "value": {"nom": "Ism%", "cognom1": "García", "cognom2": ""},
    }) is True
    assert apply_filter(meta, PAGE, {
        "field": "Autoría",
        "operator": "equals",
        "value": {"nom": "", "cognom1": "García", "cognom2": "Fernández"},
    }) is True
    assert apply_filter(meta, PAGE, {
        "field": "Autoría",
        "operator": "contains",
        "value": {"nom": "Ismael", "cognom1": "Serra", "cognom2": ""},
    }) is False


def test_filter_greater_less_than_or_equal():
    assert apply_filter({"n": "5"}, PAGE, {"field": "n", "operator": "greater_than_or_equal", "value": "5"}) is True
    assert apply_filter({"n": "6"}, PAGE, {"field": "n", "operator": "greater_than_or_equal", "value": "5"}) is True
    assert apply_filter({"n": "4"}, PAGE, {"field": "n", "operator": "greater_than_or_equal", "value": "5"}) is False

    assert apply_filter({"n": "5"}, PAGE, {"field": "n", "operator": "less_than_or_equal", "value": "5"}) is True
    assert apply_filter({"n": "4"}, PAGE, {"field": "n", "operator": "less_than_or_equal", "value": "5"}) is True
    assert apply_filter({"n": "6"}, PAGE, {"field": "n", "operator": "less_than_or_equal", "value": "5"}) is False


def test_structured_period_filter_can_target_start_or_end():
    meta = {
        "Window": {
            "version": 2,
            "start": "2026-07-27T09:00",
            "end": "2026-07-28T17:00",
            "durationDays": 2,
            "predecessorIds": ["task-a"],
        }
    }
    assert apply_filter(
        meta,
        PAGE,
        {
            "field": "Window",
            "operator": "equals",
            "periodPart": "start",
            "value": "2026-07-27T09:00",
        },
    )
    assert apply_filter(
        meta,
        PAGE,
        {
            "field": "Window",
            "operator": "equals",
            "periodPart": "end",
            "value": "2026-07-28T17:00",
        },
    )
    assert apply_filter(
        meta,
        PAGE,
        {"field": "Window", "operator": "equals", "value": "2026-07-27T09:00"},
    )


def test_multi_select_filter_matches_any_selected_option():
    meta = {"Tags": ["urgent", "home"]}
    assert apply_filter(meta, PAGE, {"field": "Tags", "operator": "equals", "value": ["work", "urgent"]}) is True
    assert apply_filter(meta, PAGE, {"field": "Tags", "operator": "not_equals", "value": ["work", "urgent"]}) is False
    assert apply_filter(meta, PAGE, {"field": "Tags", "operator": "not_equals", "value": ["work", "study"]}) is True


def test_period_filter_can_target_start_or_end_and_today():
    meta = {"Window": f"{date.today().isoformat()}/2026-12-31"}
    assert apply_filter(meta, PAGE, {"field": "Window", "operator": "equals", "periodPart": "start", "value": "today"}) is True
    assert apply_filter(meta, PAGE, {"field": "Window", "operator": "equals", "periodPart": "end", "value": "2026-12-31"}) is True
    assert apply_filter(meta, PAGE, {"field": "Window", "operator": "less_than", "periodPart": "end", "value": "2027-01-01"}) is True


def test_filter_no_field_is_passthrough():
    assert apply_filter({}, PAGE, {"operator": "equals", "value": "x"}) is True


# --- decimal with comma (parity with the frontend's parseNumericValue) --------------
def test_parse_numeric_value_comma_decimal():
    assert _parse_numeric_value("12,5") == 12.5
    assert _parse_numeric_value("-0,25") == -0.25
    assert _parse_numeric_value("12.5") == 12.5
    assert _parse_numeric_value("5") == 5.0
    # Ambiguous (thousands separator + comma): falls back to parseFloat, like on the frontend.
    assert _parse_numeric_value("1.234,56") == 1.234
    assert _parse_numeric_value("abc") is None


def test_filter_numeric_comma_decimal():
    # '12,5' > '12,4' — previously parseFloat stopped at the comma (12 > 12 → False).
    f = {"field": "n", "operator": "greater_than", "value": "12,4"}
    assert apply_filter({"n": "12,5"}, PAGE, f) is True
    assert apply_filter({"n": "12,3"}, PAGE, f) is False
    f2 = {"field": "n", "operator": "less_than", "value": "0,5"}
    assert apply_filter({"n": "0,25"}, PAGE, f2) is True
    assert apply_filter({"n": "0,75"}, PAGE, f2) is False


def test_filter_numeric_target_vs_nonnumeric_value_parity():
    """Numeric target (bare year/number) against a NON-numeric value: ISO dates
    match by lexicographic order (chronological), but arbitrary text does NOT. Parity
    with the frontend's matchesFilters / DbViewEmbed.applyFilter (Option 3)."""
    gt2020 = {"field": "d", "operator": "greater_than", "value": "2020"}
    lt2020 = {"field": "d", "operator": "less_than", "value": "2020"}
    # ISO date with a bare year: chronological comparison.
    assert apply_filter({"d": "2024-01-15"}, PAGE, gt2020) is True
    assert apply_filter({"d": "2019-05-01"}, PAGE, gt2020) is False
    assert apply_filter({"d": "2019-05-01"}, PAGE, lt2020) is True
    assert apply_filter({"d": "2024-01-15"}, PAGE, lt2020) is False
    # Arbitrary text against a numeric threshold: does NOT match (previously "foo" > "5" → True).
    gt5 = {"field": "n", "operator": "greater_than", "value": "5"}
    lt5 = {"field": "n", "operator": "less_than", "value": "5"}
    assert apply_filter({"n": "foo"}, PAGE, gt5) is False
    assert apply_filter({"n": "foo"}, PAGE, lt5) is False
    # Mixed column (number + text): only the valid numeric cell counts.
    assert apply_filter({"n": ["foo", "9"]}, PAGE, gt5) is True
    assert apply_filter({"n": ["foo", "3"]}, PAGE, gt5) is False
    # Full-date target (NOT numeric): string comparison, as before.
    gtdate = {"field": "d", "operator": "greater_than", "value": "2020-06-01"}
    assert apply_filter({"d": "2020-06-02"}, PAGE, gtdate) is True
    assert apply_filter({"d": "2020-05-31"}, PAGE, gtdate) is False


# --- multi_key_sort ---------------------------------------------------------
def test_sort_by_field_desc_and_default_title():
    rows = [
        {"id": "1", "title": "B", "metadata": {"Any": "2020"}},
        {"id": "2", "title": "A", "metadata": {"Any": "2024"}},
    ]
    asc = [r["id"] for r in multi_key_sort(rows, [{"field": "Any", "direction": "asc"}])]
    assert asc == ["1", "2"]
    desc = [r["id"] for r in multi_key_sort(rows, [{"field": "Any", "direction": "desc"}])]
    assert desc == ["2", "1"]
    by_title = [r["id"] for r in multi_key_sort(rows, [])]
    assert by_title == ["2", "1"]  # A before B


def test_sort_keeps_empty_values_last_in_both_directions():
    rows = [
        {"id": "empty", "title": "Empty", "metadata": {"Any": ""}},
        {"id": "2025", "title": "2025", "metadata": {"Any": "2025"}},
        {"id": "2026", "title": "2026", "metadata": {"Any": "2026"}},
    ]

    asc = [r["id"] for r in multi_key_sort(rows, [{"field": "Any", "direction": "asc"}])]
    desc = [r["id"] for r in multi_key_sort(rows, [{"field": "Any", "direction": "desc"}])]

    assert asc == ["2025", "2026", "empty"]
    assert desc == ["2026", "2025", "empty"]


def test_sort_matches_notion_year_desc_then_date_asc():
    rows = [
        {"id": "empty", "title": "Empty", "metadata": {"Any": "", "Data": ""}},
        {"id": "oct", "title": "October", "metadata": {"Any": "2025", "Data": "2025-10-29"}},
        {"id": "feb", "title": "February", "metadata": {"Any": "2026", "Data": "2026-02-23"}},
        {"id": "may", "title": "May", "metadata": {"Any": "2025", "Data": "2025-05-16"}},
    ]

    ordered = [
        r["id"]
        for r in multi_key_sort(
            rows,
            [
                {"field": "Any", "direction": "desc"},
                {"field": "Data", "direction": "asc"},
            ],
        )
    ]

    assert ordered == ["feb", "may", "oct", "empty"]


def test_sort_comma_decimal_numeric_order():
    # '0,5' < '0,75' < '2,25' — previously all "0,xx" tied at 0 (parseFloat)
    # and the order was left at the mercy of the sort's stability.
    rows = [
        {"id": "1", "title": "x", "metadata": {"Preu": "2,25"}},
        {"id": "2", "title": "y", "metadata": {"Preu": "0,75"}},
        {"id": "3", "title": "z", "metadata": {"Preu": "0,5"}},
    ]
    asc = [r["id"] for r in multi_key_sort(rows, [{"field": "Preu", "direction": "asc"}])]
    assert asc == ["3", "2", "1"]


# --- apply_filter_node (nested AND/OR groups, Notion-style) -----------------
def test_filter_node_leaf_delegates_to_apply_filter():
    # A bare leaf rule behaves exactly like apply_filter.
    leaf = {"field": "Any", "operator": "equals", "value": "2020"}
    assert apply_filter_node({"Any": "2020"}, PAGE, leaf) is True
    assert apply_filter_node({"Any": "2021"}, PAGE, leaf) is False


def test_filter_node_empty_group_matches_all():
    assert apply_filter_node({"Any": "2020"}, PAGE, {"conjunction": "and", "rules": []}) is True
    assert apply_filter_node({}, PAGE, {"conjunction": "or", "rules": []}) is True


def test_filter_node_and_or_conjunctions():
    meta = {"Estat": "Fet", "Tipus": "Recordatori"}
    r_estat = {"field": "Estat", "operator": "equals", "value": "Fet"}
    r_tipus = {"field": "Tipus", "operator": "equals", "value": "Accionable"}
    # AND: both must hold → false because Tipus differs.
    assert apply_filter_node(meta, PAGE, {"conjunction": "and", "rules": [r_estat, r_tipus]}) is False
    # OR: at least one holds because the persisted status field matches. @language-example
    assert apply_filter_node(meta, PAGE, {"conjunction": "or", "rules": [r_estat, r_tipus]}) is True


def test_filter_node_nested_groups():
    # Nested filter using persisted field and option values. @language-example
    tree = {
        "conjunction": "and",
        "rules": [
            {"field": "Estat", "operator": "not_equals", "value": "Fet"},
            {
                "conjunction": "or",
                "rules": [
                    {"field": "Tipus", "operator": "is_empty"},
                    {"field": "Tipus", "operator": "equals", "value": "Safata d'entrada"},
                ],
            },
        ],
    }
    assert apply_filter_node({"Estat": "Pendent", "Tipus": []}, PAGE, tree) is True
    assert apply_filter_node({"Estat": "Pendent", "Tipus": "Safata d'entrada"}, PAGE, tree) is True
    assert apply_filter_node({"Estat": "Pendent", "Tipus": "Altre"}, PAGE, tree) is False
    assert apply_filter_node({"Estat": "Fet", "Tipus": []}, PAGE, tree) is False


def test_resolve_rows_prefers_filter_tree_over_flat():
    rows = [
        {"id": A, "title": "Alpha", "metadata": {"Estat": "Pendent"}},
        {"id": B, "title": "Bèta", "metadata": {"Estat": "Fet"}},
    ]
    view = {
        # Flat `filters` (legacy) must be IGNORED when a filterTree is present.
        "filters": [{"field": "Estat", "operator": "equals", "value": "Fet"}],
        "filterTree": {
            "conjunction": "or",
            "rules": [
                {"field": "Estat", "operator": "equals", "value": "Pendent"},
                {"field": "Estat", "operator": "equals", "value": "Fet"},
            ],
        },
    }
    assert set(resolve_row_ids(rows, view, PAGE)) == {A, B}


# --- resolve_row_ids --------------------------------------------------------
def test_resolve_filters_this_and_sorts():
    rows = [
        {"id": A, "title": "Alpha", "metadata": {"Àrea": [PAGE], "Any": "2022"}},
        {"id": B, "title": "Bèta", "metadata": {"Àrea": [PAGE], "Any": "2020"}},
        {"id": C, "title": "Çedilla", "metadata": {"Àrea": ["x"], "Any": "2030"}},
    ]
    view = {
        "filters": [{"field": "Àrea", "operator": "equals", "value": "this"}],
        "sorts": [{"field": "Any", "direction": "asc"}],
    }
    assert resolve_row_ids(rows, view, PAGE) == [B, A]  # C filtered, order by Any asc


# --- strip / inject round-trip ---------------------------------------------
def _resolver(ids):
    return lambda view_id, host: ids if view_id == VID else []


def test_inject_adds_followable_wikilinks():
    body = f"# Formació\n\n{_fence()}\n# Següent\n"
    out = inject_view_snapshots(body, _resolver([A, B]), _id_to_title, PAGE)
    assert "<!-- gnosi-view:result view_id=view-123 -->" in out
    assert "- [[Alpha|id-a]]" in out
    assert "- [[Bèta|id-b]]" in out
    assert "<!-- /gnosi-view:result -->" in out
    # the trailing content is preserved
    assert "# Següent" in out


def test_strip_removes_block_and_leaves_rest():
    body = f"# Formació\n\n{_fence()}\n# Següent\n"
    injected = inject_view_snapshots(body, _resolver([A, B]), _id_to_title, PAGE)
    stripped = strip_view_snapshots(injected)
    assert "gnosi-view:result" not in stripped
    assert "[[Alpha" not in stripped
    assert "# Següent" in stripped
    assert "```gnosi-view" in stripped  # the fence is preserved


def test_strip_inverts_inject():
    body = f"# A\n\n{_fence()}\n# B\n"
    injected = inject_view_snapshots(body, _resolver([A, B, C]), _id_to_title, PAGE)
    assert strip_view_snapshots(injected) == body


def test_inject_is_idempotent():
    body = f"# A\n\n{_fence()}\n# B\n"
    once = inject_view_snapshots(body, _resolver([A, B]), _id_to_title, PAGE)
    twice = inject_view_snapshots(once, _resolver([A, B]), _id_to_title, PAGE)
    assert once == twice


def test_inject_refreshes_stale_snapshot():
    body = f"# A\n\n{_fence()}\n# B\n"
    first = inject_view_snapshots(body, _resolver([A]), _id_to_title, PAGE)
    assert "- [[Alpha|id-a]]" in first and "id-b" not in first
    # the rows change → re-injection starts from the clean body and reflects the new state
    second = inject_view_snapshots(first, _resolver([A, B]), _id_to_title, PAGE)
    assert "- [[Bèta|id-b]]" in second
    assert second.count("<!-- gnosi-view:result") == 1  # a single block, doesn't accumulate


def test_unknown_title_degrades_to_bare_id():
    body = _fence()
    out = inject_view_snapshots(body, _resolver(["id-sense-titol"]), lambda _: None, PAGE)
    assert "- id-sense-titol" in out  # bare id, never blocks


def test_empty_result_writes_no_block():
    body = f"# A\n\n{_fence()}\n# B\n"
    out = inject_view_snapshots(body, _resolver([]), _id_to_title, PAGE)
    assert "gnosi-view:result" not in out
    assert out == body


def test_multiple_fences_each_get_their_own_block():
    body = f"{_fence('v1')}\n{_fence('v2')}\n"
    resolver = lambda vid, host: [A] if vid == "v1" else [B]
    out = inject_view_snapshots(body, resolver, _id_to_title, PAGE)
    assert out.count("<!-- gnosi-view:result") == 2
    assert "[[Alpha|id-a]]" in out and "[[Bèta|id-b]]" in out


def test_no_fence_is_noop():
    body = "# Sense vista\n\nText normal.\n"
    assert inject_view_snapshots(body, _resolver([A]), _id_to_title, PAGE) == body
    assert strip_view_snapshots(body) == body


def test_truncation_marker_when_over_cap():
    body = _fence()
    ids = [f"id-{i}" for i in range(5)]
    out = inject_view_snapshots(body, _resolver(ids), lambda r: f"T{r}", PAGE, max_items=2)
    assert out.count("- [[") == 2
    assert "<!-- gnosi-view:result-truncated 3 -->" in out
    # and the strip also cleans up the truncated block
    assert "gnosi-view:result" not in strip_view_snapshots(out)


# --- config_for: activation and per-view limit --------------------------------
def test_config_disabled_writes_no_block():
    body = f"# A\n\n{_fence()}\n# B\n"
    out = inject_view_snapshots(
        body, _resolver([A, B]), _id_to_title, PAGE,
        config_for=lambda vid: {"enabled": False, "limit": 500},
    )
    assert "gnosi-view:result" not in out
    assert out == body


def test_config_disabled_skips_resolution():
    called = {"n": 0}

    def resolver(vid, host):
        called["n"] += 1
        return [A]

    inject_view_snapshots(
        _fence(), resolver, _id_to_title, PAGE,
        config_for=lambda vid: {"enabled": False},
    )
    assert called["n"] == 0  # disabled view → not even resolved


def test_config_per_view_limit_overrides_default():
    body = _fence()
    ids = [f"id-{i}" for i in range(6)]
    out = inject_view_snapshots(
        body, _resolver(ids), lambda r: f"T{r}", PAGE, max_items=500,
        config_for=lambda vid: {"enabled": True, "limit": 3},
    )
    assert out.count("- [[") == 3
    assert "<!-- gnosi-view:result-truncated 3 -->" in out


def test_config_limit_zero_means_unlimited():
    body = _fence()
    ids = [f"id-{i}" for i in range(4)]
    out = inject_view_snapshots(
        body, _resolver(ids), lambda r: f"T{r}", PAGE, max_items=2,
        config_for=lambda vid: {"enabled": True, "limit": 0},
    )
    assert out.count("- [[") == 4  # limit 0 → no truncation despite max_items=2
    assert "truncated" not in out


# --- Definition: fence ↔ comment (compact / restore) -----------------------
def test_compact_fence_to_hidden_comment():
    body = f"# Formació\n\n{_fence()}\n# Resta\n"
    out = compact_view_fences(body)
    assert "```gnosi-view" not in out  # the visible code block disappears
    assert '<!-- gnosi-view:def {"view_id":"view-123"' in out
    assert "# Resta" in out


def test_restore_comment_to_fence():
    compacted = compact_view_fences(_fence())
    restored = restore_view_fences(compacted)
    assert "```gnosi-view" in restored
    assert "gnosi-view:def" not in restored
    assert '"view_id": "view-123"' in restored  # JSON re-indentat (2 espais)


def test_compact_restore_roundtrip_is_identity():
    body = f"# A\n\n{_fence()}\n# B\n"
    assert restore_view_fences(compact_view_fences(body)) == body


def test_compact_leaves_invalid_json_fence_intact():
    body = "```gnosi-view\n{not valid json,,}\n```\n"
    assert compact_view_fences(body) == body  # the definition doesn't break


def test_disk_form_def_comment_then_result_after_inject_and_compact():
    # Simulates the real save: inject (finds the fence) → compact (fence→comment).
    body = f"# Formació\n\n{_fence()}\n# Resta\n"
    injected = inject_view_snapshots(body, _resolver([A, B]), _id_to_title, PAGE)
    disk = compact_view_fences(injected)
    assert "```gnosi-view" not in disk            # hidden definition
    assert "gnosi-view:def" in disk               # … as a comment
    assert "- [[Alpha|id-a]]" in disk             # resultats visibles (navegables)
    # And reading undoes it all: comment→fence + strips results → original body.
    read_back = strip_view_snapshots(restore_view_fences(disk))
    assert read_back == body


# --- Markdown table for table/list views ---------------------------------
def _table_resolver(headers, rows):
    return lambda view_id, host: {"headers": headers, "rows": rows} if view_id == VID else None


def test_table_snapshot_renders_markdown_table():
    body = _fence()
    headers = ["Títol", "Any", "Centre"]
    rows = [["[[Curs A|id-a]]", "2022", "Escola X"], ["[[Curs B|id-b]]", "-", ""]]
    out = inject_view_snapshots(
        body, _resolver([A, B]), _id_to_title, PAGE,
        resolve_table=_table_resolver(headers, rows),
    )
    assert "| Títol | Any | Centre |" in out
    assert "| --- | --- | --- |" in out
    # the `|` in an aliased wikilink is escaped so it doesn't break the cell
    assert "| [[Curs A\\|id-a]] | 2022 | Escola X |" in out
    assert "- [[" not in out  # table, not list


def test_table_falls_back_to_list_for_non_table_views():
    body = _fence()
    out = inject_view_snapshots(
        body, _resolver([A, B]), _id_to_title, PAGE,
        resolve_table=lambda v, h: None,  # not table/list
    )
    assert "- [[Alpha|id-a]]" in out
    assert "| --- |" not in out


def test_table_respects_limit_with_truncation():
    body = _fence()
    rows = [[f"[[R{i}|id-{i}]]", str(i)] for i in range(5)]
    out = inject_view_snapshots(
        body, _resolver(["x"]), _id_to_title, PAGE, max_items=2,
        resolve_table=_table_resolver(["Títol", "N"], rows),
    )
    # 1 header + 1 separator + 2 data rows
    assert out.count("\n|") == 4
    assert "<!-- gnosi-view:result-truncated 3 -->" in out


def test_table_block_is_stripped_on_read():
    body = _fence()
    out = inject_view_snapshots(
        body, _resolver([A]), _id_to_title, PAGE,
        resolve_table=_table_resolver(["Títol", "N"], [["[[A|id-a]]", "1"]]),
    )
    assert strip_view_snapshots(out) == body  # the table is also stripped when reading


# --- rematerialize_md: materialization-task unit ----------------
_DOC = (
    "---\nid: p1\ntitle: Àrea X\n---\n\n"
    "# Formació\n\n"
    "```gnosi-view\n{\"view_id\":\"view-123\"}\n```\n\n"
    "# Resta\n"
)


def test_rematerialize_materializes_then_is_idempotent():
    tbl = _table_resolver(["Títol", "N"], [["[[A|id-a]]", "1"], ["[[B|id-b]]", "2"]])
    once = rematerialize_md(_DOC, "p1", _resolver([A, B]), _id_to_title, None, tbl)
    # frontmatter intact; hidden definition; table with data
    assert once.startswith("---\nid: p1\ntitle: Àrea X\n---\n")
    assert "gnosi-view:def" in once and "```gnosi-view" not in once
    assert "| Títol | N |" in once
    assert "# Formació" in once and "# Resta" in once
    # re-materializing with the SAME data → identical (would not write)
    twice = rematerialize_md(once, "p1", _resolver([A, B]), _id_to_title, None, tbl)
    assert twice == once


def test_rematerialize_changes_when_data_changes():
    tbl1 = _table_resolver(["Títol", "N"], [["[[A|id-a]]", "1"]])
    tbl2 = _table_resolver(["Títol", "N"], [["[[A|id-a]]", "1"], ["[[B|id-b]]", "2"]])
    once = rematerialize_md(_DOC, "p1", _resolver([A]), _id_to_title, None, tbl1)
    updated = rematerialize_md(once, "p1", _resolver([A, B]), _id_to_title, None, tbl2)
    assert updated != once
    assert "id-b" in updated  # `|` va escapat a la cel·la: [[B\|id-b]]


def test_rematerialize_noop_without_view():
    raw = "---\nid: p1\n---\n\n# Sense vista\n\nText.\n"
    assert rematerialize_md(raw, "p1", _resolver([A]), _id_to_title) == raw


def test_rematerialize_handles_no_frontmatter():
    raw = "# Sols cos\n\n" + _fence()
    out = rematerialize_md(raw, None, _resolver([A]), _id_to_title)
    assert "gnosi-view:def" in out
    assert out.startswith("# Sols cos")
