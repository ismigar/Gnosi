"""Snapshot of the results of a view embedded in the markdown body.

Each ```gnosi-view``` block in the body can be followed by a list of wikilinks
``[[Title|id]]`` to the pages the view RETURNS. It exists for
portability: Obsidian (graph, backlinks, navigation), plain readers, and the sync to
Drupal see the links even if they don't execute the view. The list is
delimited by sentinel HTML comments so that it's a DERIVED artifact,
not authored content:

    ```gnosi-view
    { "view_id": "…", "heading": "", "heading_level": 1 }
    ```

    <!-- gnosi-view:result view_id=… -->
    - [[Title A|id-a]]
    - [[Title B|id-b]]
    <!-- /gnosi-view:result -->

Same philosophy as the relation wikilinks (``relation_links.py``):
- **Writing** (``inject_view_snapshots``, in ``save_page_md``): self-healing,
  re-resolves rows and titles on every save. Idempotent (removes the previous block and
  puts it back).
- **Reading** (``strip_view_snapshots``, in ``parse_frontmatter``): removes the
  list so that neither the editor nor the domain ever see it. The editor's
  round-trip doesn't duplicate it.

The wikilink format (``[[Title|id]]``, id in the alias) and title
safety are reused from ``relation_links``.

Deliberately lightweight module (re + json + typing): row and title
resolution arrives via callbacks injected from ``vault_routes`` (no heavy
dependency or global state here).
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import date
from functools import cmp_to_key
from typing import Any, Callable, Dict, List, Optional, Sequence

from backend.services.relation_links import _decorate_item

# --- Snapshot block sentinels -----------------------------------------
SNAPSHOT_OPEN_PREFIX = "<!-- gnosi-view:result"
_SNAPSHOT_BLOCK_RE = re.compile(
    r"[ \t]*<!--\s*gnosi-view:result\b[^>]*-->\n"  # opening (with optional view_id)
    r".*?"                                            # items (non-greedy)
    r"\n[ \t]*<!--\s*/gnosi-view:result\s*-->[ \t]*",  # tancament
    re.DOTALL,
)

# ```gnosi-view ... ``` fence (JSON in the middle). The frontend emits it with 3 backticks
# and `gnosi-view` tag; we tolerate trailing spaces on the closing line.
_FENCE_RE = re.compile(
    r"```gnosi-view[ \t]*\n(?P<json>.*?)\n```[ \t]*",
    re.DOTALL,
)

# Defensive limit: a view without filters can return the whole table. We avoid
# writing oversized lists on every save. If exceeded, it's truncated and
# leaves an explicit RECORD (never a silent cut).
DEFAULT_MAX_ITEMS = 500

# --- View definition: visible fence ↔ hidden HTML comment -----------
# On disk, the definition is stored as an HTML comment
# (`<!-- gnosi-view:def {json} -->`) so that Obsidian and plain readers
# HIDE it (a ```gnosi-view``` code block would always be visible). The editor
# Gnosi ALWAYS works with the fence: the backend converts comment→fence back on
# read it, and fence→comment on save. This way the frontend doesn't change and the round-trip
# of the editor is identical. JSON on a single line (the match stops at `-->`).
_DEF_COMMENT_RE = re.compile(r"[ \t]*<!--\s*gnosi-view:def\s+(?P<json>.*?)\s*-->[ \t]*")


def compact_view_fences(body: Any) -> Any:
    """WRITE boundary: ```gnosi-view {json}``` → `<!-- gnosi-view:def {json} -->`.
    Compacts the JSON into one line. If the JSON is not valid, leaves the fence intact
    (never break the definition)."""
    if not isinstance(body, str) or "```gnosi-view" not in body:
        return body

    def _repl(m):
        try:
            payload = json.loads(m.group("json"))
        except Exception:
            return m.group(0)
        compact = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        return f"<!-- gnosi-view:def {compact} -->"

    return _FENCE_RE.sub(_repl, body)


_FRONTMATTER_RE = re.compile(r"^---\s*\n.*?\n---\s*\n", re.DOTALL)


def rematerialize_md(
    raw: Any,
    host_page_id: Optional[str],
    resolve_ids: Callable[[str, Optional[str]], Optional[List[str]]],
    id_to_title: Optional[Callable[[str], Optional[str]]] = None,
    config_for: Optional[Callable[[str], Optional[Dict[str, Any]]]] = None,
    resolve_table: Optional[Callable[[str, Optional[str]], Optional[Dict[str, Any]]]] = None,
) -> Any:
    """Regenerates the view snapshot of a COMPLETE .md document (frontmatter +
    body) from the CURRENT data. Leaves the frontmatter byte for byte and only
    touches the body's snapshot region. Returns the new .md — IDENTICAL to the input
    if nothing has changed (to avoid writing needlessly). Pure: no I/O. It's the unit
    used by the vault's materialization task.
    
    """
    if not isinstance(raw, str) or "gnosi-view" not in raw:
        return raw
    m = _FRONTMATTER_RE.match(raw)
    prefix = raw[:m.end()] if m else ""
    body = raw[m.end():] if m else raw
    new_body = restore_view_fences(body)
    new_body = strip_view_snapshots(new_body)
    new_body = inject_view_snapshots(
        new_body,
        resolve_ids,
        id_to_title=id_to_title,
        host_page_id=host_page_id,
        config_for=config_for,
        resolve_table=resolve_table,
    )
    new_body = compact_view_fences(new_body)
    return prefix + new_body


def restore_view_fences(body: Any) -> Any:
    """READ boundary: `<!-- gnosi-view:def {json} -->` → ```gnosi-view {json}```,
    with the same format the editor produces (JSON indented by 2 spaces) so that
    the round-trip is identical. A comment with invalid JSON is left as-is."""
    if not isinstance(body, str) or "gnosi-view:def" not in body:
        return body

    def _repl(m):
        try:
            payload = json.loads((m.group("json") or "").strip())
        except Exception:
            return m.group(0)
        pretty = json.dumps(payload, ensure_ascii=False, indent=2)
        return f"```gnosi-view\n{pretty}\n```"

    return _DEF_COMMENT_RE.sub(_repl, body)


def strip_view_snapshots(body: Any) -> Any:
    """Removes ALL snapshot blocks from the body. Idempotent; no-op if there are none.

    This is the READ boundary: from here on, the editor and the domain see the
    body without the derived list. Keeps the rest of the document intact and
    collapses the blank line that preceded the block to avoid accumulating blanks.
    
    """
    if not isinstance(body, str) or SNAPSHOT_OPEN_PREFIX not in body:
        return body
    # Also removes one (only one) blank line immediately before, which is
    # the one `inject_view_snapshots` adds as a separator.
    cleaned = re.sub(r"\n?\n" + _SNAPSHOT_BLOCK_RE.pattern, "", body, flags=re.DOTALL)
    # In case some block wasn't preceded by a blank line (manual edit):
    cleaned = _SNAPSHOT_BLOCK_RE.sub("", cleaned)
    return cleaned


# Rendering the snapshot for PREVIEW: unlike
# `strip_view_snapshots` (which removes it for the editor), here we LEAVE it visible
# as Markdown (table/list) and hide the definition. It does NOT resolve any view —
# uses the content already materialized on disk. For the pop-up and the feed.
_RESULT_RENDER_RE = re.compile(
    r"[ \t]*<!--\s*gnosi-view:result\b[^>]*-->\n(?P<content>.*?)\n[ \t]*<!--\s*/gnosi-view:result\s*-->[ \t]*",
    re.DOTALL,
)
_RESULT_TRUNC_RE = re.compile(r"\n?[ \t]*<!--\s*gnosi-view:result-truncated\s+\d+\s*-->[ \t]*")
# Snapshot wikilink `[[Title\|id]]` (id in the alias, pipe escaped inside tables).
# For the preview we reduce it to `[[Title]]`: the frontend renderer treats
# the alias as visible TEXT, so without this the uuid would show.
_SNAPSHOT_WIKILINK_RE = re.compile(r"\[\[([^\[\]|\\]+)\\?\|[^\[\]]+\]\]")


def render_view_snapshots(body: Any) -> Any:
    """PREVIEW boundary: leaves the saved snapshot (the table or
    list from the `:result` block) visible as Markdown and removes the hidden
    definition (`:def`). It's the opposite of `strip_view_snapshots`. For views without
    a snapshot on disk, the definition simply disappears (no raw JSON)."""
    if not isinstance(body, str) or "gnosi-view" not in body:
        return body

    def _show(m):
        content = _RESULT_TRUNC_RE.sub("", m.group("content"))
        content = _SNAPSHOT_WIKILINK_RE.sub(r"[[\1]]", content)
        return content.strip("\n")

    out = _RESULT_RENDER_RE.sub(_show, body)
    out = _DEF_COMMENT_RE.sub("", out)
    return out


def flatten_view_columns(body: Any) -> Any:
    """Flattens the column directives (`:::column-list` / `:::column` / `:::`)
    into linear content for the preview: removes the markers and
    un-indents the content (4 spaces) so that headings and lists don't look like
    code blocks. Designed for the pop-up (not for the editor)."""
    if not isinstance(body, str) or ":::" not in body:
        return body
    out: List[str] = []
    in_cols = False
    for line in body.split("\n"):
        st = line.strip()
        if st.startswith(":::column-list"):
            in_cols = True
            continue
        if st.startswith(":::column") or st == ":::":
            continue
        # A content line WITHOUT indentation closes the column region.
        if in_cols and line and not line[:1].isspace():
            in_cols = False
        if in_cols and line.startswith("    "):
            line = line[4:]
        out.append(line)
    return "\n".join(out)


def _build_block(view_id: str, items: Sequence[str], truncated: int = 0) -> str:
    open_tag = f"<!-- gnosi-view:result view_id={view_id} -->" if view_id else "<!-- gnosi-view:result -->"
    lines = [open_tag]
    lines.extend(f"- {it}" for it in items)
    if truncated > 0:
        lines.append(f"<!-- gnosi-view:result-truncated {truncated} -->")
    lines.append("<!-- /gnosi-view:result -->")
    return "\n".join(lines)


def _md_cell(value: Any) -> str:
    """Escapes a value for a markdown table cell: `|`→`\\|` (preserves
    aliased wikilinks inside tables — Obsidian understands `[[T\\|id]]`) and flattens
    line breaks."""
    s = "" if value is None else str(value)
    return (
        s.replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", " ").strip()
    )


def _build_table_block(view_id: str, headers: Sequence[str], rows: Sequence[Sequence[Any]], truncated: int = 0) -> str:
    open_tag = f"<!-- gnosi-view:result view_id={view_id} -->" if view_id else "<!-- gnosi-view:result -->"
    lines = [open_tag]
    lines.append("| " + " | ".join(_md_cell(h) for h in headers) + " |")
    lines.append("| " + " | ".join("---" for _ in headers) + " |")
    for row in rows:
        lines.append("| " + " | ".join(_md_cell(c) for c in row) + " |")
    if truncated > 0:
        lines.append(f"<!-- gnosi-view:result-truncated {truncated} -->")
    lines.append("<!-- /gnosi-view:result -->")
    return "\n".join(lines)


def inject_view_snapshots(
    body: Any,
    resolve_ids: Callable[[str, Optional[str]], Optional[List[str]]],
    id_to_title: Optional[Callable[[str], Optional[str]]] = None,
    host_page_id: Optional[str] = None,
    max_items: int = DEFAULT_MAX_ITEMS,
    config_for: Optional[Callable[[str], Optional[Dict[str, Any]]]] = None,
    resolve_table: Optional[Callable[[str, Optional[str]], Optional[Dict[str, Any]]]] = None,
) -> Any:
    """After each ```gnosi-view``` fence, writes the list of wikilinks for
    the pages the view returns. Idempotent and self-healing.

    - ``resolve_ids(view_id, host_page_id)`` returns the view's sorted page
      ids (or ``None``/empty if it can't be resolved → no list is written).
    - ``id_to_title`` resolves the id to the CURRENT title (for the wikilink). If it doesn't resolve,
      ``_decorate_item`` falls back to the bare id (never blocks).
    - ``host_page_id`` replaces the ``this`` filter value.
    - ``config_for(view_id)`` (optional) returns the PER-VIEW config of the
      snapshot: ``{"enabled": bool, "limit": int}``. If ``enabled`` is false, the
      view does NOT write a list (it's skipped, not even resolved). ``limit`` (>0)
      caps the items with a truncation marker; ``0`` = no limit. If not
      passed, ``max_items`` is applied to all.

    Never raises: in the face of any error it returns the body untouched (defensive,
    like the relation decoration).
    
    """
    if not isinstance(body, str) or "```gnosi-view" not in body:
        return body
    try:
        clean = strip_view_snapshots(body)

        out: List[str] = []
        last = 0
        for m in _FENCE_RE.finditer(clean):
            out.append(clean[last:m.end()])
            last = m.end()
            view_id = ""
            try:
                payload = json.loads(m.group("json"))
                view_id = str(payload.get("view_id") or "")
            except Exception:
                view_id = ""
            if not view_id:
                continue
            # Per-view config (activation + limit) BEFORE resolving: a
            # disabled view doesn't pay the cost of resolution.
            enabled, limit = True, max_items
            if config_for is not None:
                try:
                    cfg = config_for(view_id) or {}
                    enabled = cfg.get("enabled", True)
                    if cfg.get("limit") is not None:
                        limit = cfg.get("limit")
                except Exception:
                    enabled, limit = True, max_items
            if not enabled:
                continue
            block = None
            # 1) Views that markdown knows how to represent (table/list): table with
            #    the real data (headers + cells), via resolve_table.
            if resolve_table is not None:
                try:
                    tbl = resolve_table(view_id, host_page_id)
                except Exception:
                    tbl = None
                if tbl and tbl.get("headers") and tbl.get("rows"):
                    trows = list(tbl["rows"])
                    truncated = 0
                    if limit and limit > 0 and len(trows) > limit:
                        truncated = len(trows) - limit
                        trows = trows[:limit]
                    if trows:
                        block = _build_table_block(view_id, tbl["headers"], trows, truncated)
            # 2) Fallback (any other type): list of wikilinks.
            if block is None:
                try:
                    ids = resolve_ids(view_id, host_page_id) or []
                except Exception:
                    ids = []
                if not ids:
                    continue
                truncated = 0
                if limit and limit > 0 and len(ids) > limit:
                    truncated = len(ids) - limit
                    ids = ids[:limit]
                items = [_decorate_item(rid, id_to_title, None) for rid in ids]
                items = [it for it in items if isinstance(it, str) and it.strip()]
                if not items:
                    continue
                block = _build_block(view_id, items, truncated)
            out.append(f"\n\n{block}")
        out.append(clean[last:])
        return "".join(out)
    except Exception:
        return body


# --- Row resolution (faithful port of the frontend DbViewEmbed) ---------------
# sortKey: strips leading punctuation/symbols/spaces so that «¿Què és?» sorts like
# «Què és». \W (non-word) + _ ≈ \p{P}\p{S}\s from the frontend.
_SORTKEY_LEAD_RE = re.compile(r"^[\W_]+", re.UNICODE)


def sort_key(value: Any) -> str:
    return _SORTKEY_LEAD_RE.sub("", str("" if value is None else value))


def _collation_key(value: str) -> str:
    """String comparison key that replicates the front-end's ``localeCompare('en',
    {sensitivity: 'base'})``: folds diacritics (à→a, ç→c, ñ→n, ü→u…)
    and lowercases, so that accented characters sort by their
    BASE LETTER. Without this, the raw `.lower()` codepoint comparison
    put ALL values with an accented initial AFTER 'z' (à = U+00E0 >
    z = U+007A), and the snapshot sorted a Catalan/Spanish vault differently from the
    main view (which does use localeCompare). @language-example"""
    decomposed = unicodedata.normalize("NFKD", value)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return stripped.lower()


_TRUTHY = {"true", "1", "yes", "si", "sí", "done", "checked", "completat"}


def _as_bool(value: Any) -> bool:
    """Parity with ``rule_engine._is_truthy_checkbox`` and the frontend (``asBool``):
    absent field/""/0/"false" = unchecked; ``True``/1/"yes"/"sí"… = checked."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value or "").strip().lower() in _TRUTHY


def _normalize_field_key(name: Any) -> str:
    """Field name without decorative prefix (emoji/spaces) and lowercased.

    Allows a filter saved with the OLD name of a column (e.g. with a
    decorative prefix) to match the metadata canonicalized to the NEW name
    (``Àrees``) after renaming the column. Same normalization as
    ``relation_sync._norm``."""
    return re.sub(r"^[^\w]+", "", str(name or ""), flags=re.UNICODE).strip().lower()


def _meta_value_for_field(meta: Dict[str, Any], field: str) -> Any:
    """Value of ``field`` in ``meta``, tolerant of prefix renames: tries the
    EXACT key and, if not present, matches by normalized name (emoji↔without). This way a filter
    doesn't break when the column it points to is renamed."""
    if field in meta:
        return meta[field]
    nf = _normalize_field_key(field)
    if nf:
        for k, v in meta.items():
            if _normalize_field_key(k) == nf:
                return v
    return None


def apply_filter(meta: Dict[str, Any], page_id: Optional[str], f: Dict[str, Any]) -> bool:
    """1:1 port of ``applyFilter`` (DbViewEmbed.jsx). ``value == 'this'`` →
    ``page_id``. Metadata values: list → set of strings; scalar →
    [str]; empty/None → []. The field is resolved by name OR alias (tolerates renames).

    Text/select is compared case-INsensitively (like Notion and like the main view's
    ``matchesFilters``): a stored "Català" matches the filter "català". The
    checkboxes (``"true"/"false"``) are compared by truthiness and the numeric ones
    (``>``/``<``) by value, neither of them affected by lowercasing."""
    field = f.get("field") if isinstance(f, dict) else None
    if not field:
        return True
    op = str(f.get("operator") or "equals").lower()
    raw = page_id if f.get("value") == "this" else f.get("value")
    targets = [str(value) for value in raw] if isinstance(raw, list) else ([] if raw is None else [str(raw)])
    target = targets[0] if targets else None
    v = _meta_value_for_field(meta or {}, field)
    if f.get("periodPart"):
        start, _, end = str(v or "").partition("/")
        v = (end or start) if f.get("periodPart") == "end" else start
    if isinstance(v, list):
        arr = [str(x) for x in v]
    elif v is None or v == "":
        arr = []
    else:
        arr = [str(v)]
    if op == "is_empty":
        return len(arr) == 0
    if op == "is_not_empty":
        return len(arr) > 0
    if target is None:
        return True
    # Boolean value (checkbox: "true"/"false"): we compare by truthiness, not by
    # string, so that an absent field counts as "unchecked" and matches "false"
    # (and we avoid the mismatch str(True)=="True" vs "true").
    if op in ("equals", "not_equals") and target.lower() in ("true", "false"):
        want = target.lower() == "true"
        cur = _as_bool(v)
        return (cur == want) if op == "equals" else (cur != want)
    # Text/select case-INsensitive (like Notion and like the main view
    # matchesFilters): a stored "Català" value matches the filter
    # "Catalan". Numeric ones (>,<) are compared separately, without lowercasing.
    today = date.today().isoformat()
    targets_l = [(today if value == "today" else value).lower() for value in targets]
    target_l = targets_l[0]
    arr_l = [x.lower() for x in arr]
    if op == "equals":
        return any(value in arr_l for value in targets_l)
    if op == "not_equals":
        return all(value not in arr_l for value in targets_l)
    if op == "contains":
        return any(value in item for value in targets_l for item in arr_l)
    if op == "not_contains":
        return all(not any(value in item for item in arr_l) for value in targets_l)
    # greater/less than: if BOTH (value and filter) are pure numbers, comparison
    # is numeric (_parse_numeric_value, parity with the frontend's parseNumericValue:
    # '12,5' → 12.5, comma decimal); otherwise, lowercase STRING comparison.
    # For ISO dates, lexicographic order is chronological and matches JS
    # (ASCII), so filtering a date column by range works and is
    # consistent with matchesFilters / applyFilter.
    if op in ("greater_than", "less_than"):
        gt = op == "greater_than"
        target_num = bool(_FULL_NUMERIC_RE.match(target.strip()))
        for x in arr:
            x_stripped = x.strip()
            if target_num and _FULL_NUMERIC_RE.match(x_stripped):
                n = _parse_numeric_value(x)
                t = _parse_numeric_value(target)
                if n is None or t is None:
                    continue
                if (n > t) if gt else (n < t):
                    return True
            elif not target_num or _ISO_DATE_RE.match(x_stripped):
                # Lowercase STRING comparison when:
                #  - the filter is NOT numeric (e.g. the target is a full date
                #    "2024-01-15"), o
                #  - the value is an ISO date and the target is a bare year/number
                #    (e.g. `> 2020` on "2024-01-15"): ISO dates sort
                #    chronologically in ASCII, the same in JS and Python.
                # Arbitrary text ("foo") with a numeric target does NOT match (skip): without
                # this, "foo" > "5" (string) incorrectly returned True. Parity
                # with matchesFilters / DbViewEmbed.applyFilter (frontend).
                xl = x.lower()
                if (xl > target_l) if gt else (xl < target_l):
                    return True
        return False
    return True


def _is_filter_group(node: Any) -> bool:
    """A node is a GROUP (not a leaf rule) when it carries a ``rules`` list.
    Parity with the frontend's ``isFilterGroup`` (vaultFilters.js / DbViewEmbed)."""
    return isinstance(node, dict) and isinstance(node.get("rules"), list)


def apply_filter_node(meta: Dict[str, Any], page_id: Optional[str], node: Any) -> bool:
    """Recursively evaluates a filter NODE — a leaf rule
    ``{field, operator, value}`` (delegated to ``apply_filter``) or a group
    ``{conjunction, rules: [...]}`` whose children may themselves be groups
    (arbitrary nesting, like Notion). An empty group matches everything, so it
    never hides rows while the filter is being built. 1:1 parity with the
    frontend's ``matchesFilterNode`` (vaultFilters.js) and ``applyFilterNode``
    (DbViewEmbed.jsx)."""
    if node is None:
        return True
    if _is_filter_group(node):
        rules = node.get("rules") or []
        if not rules:
            return True
        use_or = str(node.get("conjunction") or "and").lower() == "or"
        if use_or:
            return any(apply_filter_node(meta, page_id, child) for child in rules)
        return all(apply_filter_node(meta, page_id, child) for child in rules)
    return apply_filter(meta, page_id, node)


# --- Sort comparator: 1:1 parity with `compareFieldValues` -----------
# JS's parseFloat (it's NOT Python's float()!): skips LEADING whitespace and parses
# the LONGEST numeric prefix, ignoring the rest. float() blows up on "12,5" or "5abc";
# parseFloat("12,5")=12, parseFloat("5abc")=5, parseFloat("0,25")=0. Inclou signe,
# ±Infinity and exponent (the spec's StrDecimalLiteral grammar).
_JS_PARSEFLOAT_RE = re.compile(r"[+-]?(?:Infinity|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)")

# A value only counts as NUMERIC for sorting if the WHOLE string is a number
# (digits, separators, exponent). `_parse_float_js` parses prefixes
# ("2024-07-05"→2024), so without this check dates from the same year
# were compared as equal. Parity with the front-end (`numRe` in compareFieldValues).
_FULL_NUMERIC_RE = re.compile(r"^[+-]?[\d.,]+(?:[eE][+-]?\d+)?$")

# A value "looks like an ISO date" if it starts with YYYY-MM (date, datetime, or bare
# month). It's used so that `> 2020` (bare numeric year target) matches ISO dates by
# lexicographic comparison —chronological in ASCII— without matching arbitrary text
# ("foo"). Parity with the frontend's `ISO_DATE_RE` (vaultFilters.js).
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}")


def _parse_float_js(text: str) -> Optional[float]:
    """Equivalent to JS ``parseFloat``: returns the float of the numeric prefix or
    ``None`` (JS's ``NaN``) if it doesn't start with a number. ``re.match`` anchors at
    the start; ``lstrip`` replicates parseFloat's «skip leading whitespace»."""
    m = _JS_PARSEFLOAT_RE.match(text.lstrip())
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:  # defensive; the regex already restricts the token
        return None


# Unambiguous case of a COMMA decimal ("12,5", without a thousands separator dot): a single
# comma between digits. Parity with the frontend's `parseNumericValue` (vaultFilters.js).
_COMMA_DECIMAL_RE = re.compile(r"^-?\d+,\d+$")


def _parse_numeric_value(text: str) -> Optional[float]:
    """Port of ``parseNumericValue`` (vaultFilters.js): tolerates the LOCAL comma
    decimal ("0,25" → 0.25, unambiguous case of a single comma without a thousands
    separator dot); everything else falls to ``_parse_float_js`` (which, like parseFloat, stops at
    the comma: "0,25" → 0). Without this, the snapshot filtered and sorted
    number fields in Catalan/Spanish format differently from the main view."""
    t = text.strip()
    if _COMMA_DECIMAL_RE.match(t):
        return float(t.replace(",", "."))
    return _parse_float_js(t)


def _js_str(value: Any) -> str:
    """Coercion EQUIVALENT to JS ``String(value)`` (the frontend does ``String(raw ?? '')``):
    ``None``→'', ``bool``→'true'/'false', list→elements joined by ',' (like
    ``Array.prototype.toString``, with '' for ``None``), dict→'[object Object]'.
    Without this, a relation/multi_select (Python list) would compare as
    "['a', 'b']" on the backend but "a,b" on the frontend → divergent order (which is why the
    relation broke). ``bool`` is checked BEFORE anything else (it's a subclass of int)."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return ",".join(_js_str(x) for x in value)
    if isinstance(value, dict):
        return "[object Object]"
    return str(value)


def _compare_field_values(a_raw: Any, b_raw: Any, direction: str = "asc") -> int:
    """1:1 port of ``compareFieldValues`` (vaultFilters.js), the ONLY source of truth
    for view sorting on the frontend (main view and embedded ones):

    - EMPTY values FOLLOW the direction (like Excel/Sheets): LAST in ascending,
      FIRST in descending. Direction applies to BOTH the empty and non-empty
      parts (which is why a comparator is needed, not a ``key=`` with
      ``reverse``).
    - if both are NUMERIC (according to JS's ``parseFloat``), real numeric order
      (2 < 10, not "10" < "2").
    - otherwise, string fallback with ``_collation_key(sort_key(...))``, which folds
      diacritics to the base letter to replicate the frontend's ``localeCompare('en',
      {sensitivity: 'base'})`` (à==a): accented characters sort by their
      base letter, not by codepoint (which would put them after 'z').

    Returns -1/0/1."""
    a_val = _js_str(a_raw)
    b_val = _js_str(b_raw)
    a_empty = a_val.strip() == ""
    b_empty = b_val.strip() == ""
    if a_empty or b_empty:
        if a_empty and b_empty:
            return 0
        # Empty values FOLLOW the direction: LAST in asc, FIRST in desc
        # (Excel/Sheets convention). Both branches depend on `direction`.
        empty_first = direction == "desc"
        if a_empty:
            return -1 if empty_first else 1
        return 1 if empty_first else -1
    a_num = _parse_numeric_value(a_val) if _FULL_NUMERIC_RE.match(a_val.strip()) else None
    b_num = _parse_numeric_value(b_val) if _FULL_NUMERIC_RE.match(b_val.strip()) else None
    if a_num is not None and b_num is not None:
        cmp = (a_num > b_num) - (a_num < b_num)  # sign (avoids nan from inf-inf)
    else:
        ka = _collation_key(sort_key(a_val))
        kb = _collation_key(sort_key(b_val))
        cmp = (ka > kb) - (ka < kb)
    return -cmp if direction == "desc" else cmp


def multi_key_sort(rows: List[Dict[str, Any]], sorts: Optional[Sequence[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Port of ``multiKeySort`` (DbViewEmbed) with the shared comparator
    ``_compare_field_values`` (1:1 parity with the frontend's ``compareFieldValues``):
    without sorts, by title; otherwise, STABLE multi-key sort applying the keys from
    last to first (``list.sort`` is stable, like ``Array.sort``)."""
    if not sorts:
        return sorted(
            rows,
            key=cmp_to_key(lambda a, b: _compare_field_values(a.get("title"), b.get("title"), "asc")),
        )
    result = list(rows)
    for s in reversed(list(sorts)):
        field = s.get("field") if isinstance(s, dict) else None
        if not field:
            continue
        direction = "desc" if str((s or {}).get("direction") or "asc") == "desc" else "asc"
        result.sort(
            key=cmp_to_key(
                lambda a, b, _f=field, _d=direction: _compare_field_values(
                    (a.get("metadata") or {}).get(_f),
                    (b.get("metadata") or {}).get(_f),
                    _d,
                )
            )
        )
    return result


def resolve_row_ids(
    rows: List[Dict[str, Any]],
    view: Dict[str, Any],
    host_page_id: Optional[str],
) -> List[str]:
    """Given the candidate rows (``{id, title, metadata}``, metadata already in
    RESPONSE names and clean relation ids) and a view from the registry, returns
    the sorted ids the view shows. Replicates the frontend's filter + sort.

    Templates must have already been excluded beforehand (as the frontend does with
    ``is_template``)."""
    return [str(r.get("id")) for r in resolve_rows(rows, view, host_page_id) if r.get("id")]


def resolve_rows(
    rows: List[Dict[str, Any]],
    view: Dict[str, Any],
    host_page_id: Optional[str],
) -> List[Dict[str, Any]]:
    """Like ``resolve_row_ids`` but returns the sorted ROWS (``{id, title,
    metadata}``), not just the ids — for the markdown table."""
    # Prefer the nested `filterTree` (complex AND/OR groups); fall back to the
    # legacy flat `filters`/`filter` list (AND). Parity with the frontend
    # (viewMatchesFilters / DbViewEmbed.applyFilterNode).
    tree = view.get("filterTree")
    if not _is_filter_group(tree):
        flat = view.get("filters") or ([view["filter"]] if view.get("filter") else [])
        tree = {"conjunction": "and", "rules": flat}
    filtered = [
        r for r in rows
        if apply_filter_node(r.get("metadata") or {}, host_page_id, tree)
    ]
    sorts = view.get("sorts") or ([view["sort"]] if view.get("sort") else [])
    return multi_key_sort(filtered, sorts)
