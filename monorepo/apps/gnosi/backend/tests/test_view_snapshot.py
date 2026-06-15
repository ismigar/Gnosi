"""Snapshot de resultats de vista al cos markdown — round-trip i resolució.

Mirall de test_relation_wikilinks.py per al cos: inject (domini → wikilinks),
strip (wikilinks → cos net), idempotència i fidelitat del filtre/ordre respecte
el frontend (DbViewEmbed).
"""
from backend.services.view_snapshot import (
    apply_filter,
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


# --- apply_filter (port de DbViewEmbed.applyFilter) -------------------------
def test_filter_this_equals_on_relation_list():
    f = {"field": "📀 Àrea", "operator": "equals", "value": "this"}
    assert apply_filter({"📀 Àrea": [PAGE, "other"]}, PAGE, f) is True
    assert apply_filter({"📀 Àrea": ["other"]}, PAGE, f) is False


def test_filter_is_empty_and_not_empty():
    assert apply_filter({"x": []}, PAGE, {"field": "x", "operator": "is_empty"}) is True
    assert apply_filter({"x": [1]}, PAGE, {"field": "x", "operator": "is_empty"}) is False
    assert apply_filter({"x": [1]}, PAGE, {"field": "x", "operator": "is_not_empty"}) is True


def test_filter_contains_and_numeric():
    assert apply_filter({"t": "hola mon"}, PAGE, {"field": "t", "operator": "contains", "value": "mon"}) is True
    assert apply_filter({"n": "5"}, PAGE, {"field": "n", "operator": "greater_than", "value": "3"}) is True
    assert apply_filter({"n": "2"}, PAGE, {"field": "n", "operator": "greater_than", "value": "3"}) is False


def test_filter_no_field_is_passthrough():
    assert apply_filter({}, PAGE, {"operator": "equals", "value": "x"}) is True


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
    assert by_title == ["2", "1"]  # A abans de B


# --- resolve_row_ids --------------------------------------------------------
def test_resolve_filters_this_and_sorts():
    rows = [
        {"id": A, "title": "Alpha", "metadata": {"📀 Àrea": [PAGE], "Any": "2022"}},
        {"id": B, "title": "Bèta", "metadata": {"📀 Àrea": [PAGE], "Any": "2020"}},
        {"id": C, "title": "Çedilla", "metadata": {"📀 Àrea": ["x"], "Any": "2030"}},
    ]
    view = {
        "filters": [{"field": "📀 Àrea", "operator": "equals", "value": "this"}],
        "sorts": [{"field": "Any", "direction": "asc"}],
    }
    assert resolve_row_ids(rows, view, PAGE) == [B, A]  # C filtrat, ordre per Any asc


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
    # el contingut posterior es conserva
    assert "# Següent" in out


def test_strip_removes_block_and_leaves_rest():
    body = f"# Formació\n\n{_fence()}\n# Següent\n"
    injected = inject_view_snapshots(body, _resolver([A, B]), _id_to_title, PAGE)
    stripped = strip_view_snapshots(injected)
    assert "gnosi-view:result" not in stripped
    assert "[[Alpha" not in stripped
    assert "# Següent" in stripped
    assert "```gnosi-view" in stripped  # el fence es conserva


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
    # les files canvien → re-injecció parteix del cos net i reflecteix l'estat nou
    second = inject_view_snapshots(first, _resolver([A, B]), _id_to_title, PAGE)
    assert "- [[Bèta|id-b]]" in second
    assert second.count("<!-- gnosi-view:result") == 1  # un sol bloc, no acumula


def test_unknown_title_degrades_to_bare_id():
    body = _fence()
    out = inject_view_snapshots(body, _resolver(["id-sense-titol"]), lambda _: None, PAGE)
    assert "- id-sense-titol" in out  # id nu, mai bloqueja


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
    # i el strip també neteja el bloc truncat
    assert "gnosi-view:result" not in strip_view_snapshots(out)


# --- config_for: activació i límit per vista --------------------------------
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
    assert called["n"] == 0  # vista desactivada → ni es resol


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
    assert out.count("- [[") == 4  # límit 0 → sense truncament malgrat max_items=2
    assert "truncated" not in out


# --- Definició: fence ↔ comentari (compact / restore) -----------------------
def test_compact_fence_to_hidden_comment():
    body = f"# Formació\n\n{_fence()}\n# Resta\n"
    out = compact_view_fences(body)
    assert "```gnosi-view" not in out  # el bloc de codi visible desapareix
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
    assert compact_view_fences(body) == body  # no es trenca la definició


def test_disk_form_def_comment_then_result_after_inject_and_compact():
    # Simula el desat real: inject (troba el fence) → compact (fence→comentari).
    body = f"# Formació\n\n{_fence()}\n# Resta\n"
    injected = inject_view_snapshots(body, _resolver([A, B]), _id_to_title, PAGE)
    disk = compact_view_fences(injected)
    assert "```gnosi-view" not in disk            # definició amagada
    assert "gnosi-view:def" in disk               # … com a comentari
    assert "- [[Alpha|id-a]]" in disk             # resultats visibles (navegables)
    # I la lectura ho desfà tot: comentari→fence + treu resultats → cos original.
    read_back = strip_view_snapshots(restore_view_fences(disk))
    assert read_back == body


# --- Taula markdown per a vistes table/list ---------------------------------
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
    # el `|` del wikilink amb àlies s'escapa per no trencar la cel·la
    assert "| [[Curs A\\|id-a]] | 2022 | Escola X |" in out
    assert "- [[" not in out  # taula, no llista


def test_table_falls_back_to_list_for_non_table_views():
    body = _fence()
    out = inject_view_snapshots(
        body, _resolver([A, B]), _id_to_title, PAGE,
        resolve_table=lambda v, h: None,  # no és table/list
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
    # 1 capçalera + 1 separador + 2 files de dades
    assert out.count("\n|") == 4
    assert "<!-- gnosi-view:result-truncated 3 -->" in out


def test_table_block_is_stripped_on_read():
    body = _fence()
    out = inject_view_snapshots(
        body, _resolver([A]), _id_to_title, PAGE,
        resolve_table=_table_resolver(["Títol", "N"], [["[[A|id-a]]", "1"]]),
    )
    assert strip_view_snapshots(out) == body  # la taula també es treu en llegir


# --- rematerialize_md: unitat de la tasca de materialització ----------------
_DOC = (
    "---\nid: p1\ntitle: Àrea X\n---\n\n"
    "# Formació\n\n"
    "```gnosi-view\n{\"view_id\":\"view-123\"}\n```\n\n"
    "# Resta\n"
)


def test_rematerialize_materializes_then_is_idempotent():
    tbl = _table_resolver(["Títol", "N"], [["[[A|id-a]]", "1"], ["[[B|id-b]]", "2"]])
    once = rematerialize_md(_DOC, "p1", _resolver([A, B]), _id_to_title, None, tbl)
    # frontmatter intacte; definició amagada; taula amb dades
    assert once.startswith("---\nid: p1\ntitle: Àrea X\n---\n")
    assert "gnosi-view:def" in once and "```gnosi-view" not in once
    assert "| Títol | N |" in once
    assert "# Formació" in once and "# Resta" in once
    # re-materialitzar amb les MATEIXES dades → idèntic (no escriuria)
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
