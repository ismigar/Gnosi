import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Loader2, AlertCircle, Plus, Search, SlidersHorizontal, ChevronDown, ChevronUp, X, LayoutTemplate, MoreHorizontal, Settings, Edit2, Copy, Trash2 } from 'lucide-react';
import { compareFieldValues, NUM_RE, ISO_DATE_RE, parseNumericValue, normalizeForSearch } from '../../utils/vaultFilters';
import { VaultEditorContext } from './VaultEditorContext';
import { VaultMarkdown, RetryableImage } from './VaultMarkdown';
import { normalizeAssetUrl } from './vaultMarkdownUtils';
import { VaultViewBody } from './VaultViewBody';
import { buildSchemaFromTableProperties } from './schemaUtils';
import { VIEW_TYPES } from './viewConstants';
import ConfirmModal from '../ConfirmModal';
import PromptModal from '../PromptModal';
import { toast } from '../../lib/toast';
import { periodBoundary } from '../../utils/projectPlanning';

// Scrollable container to fit the full view components (which
// assume a height) within the embed's document flow. At module level
// so as not to recreate the component type on every render (this would avoid remounts).
const ScrollBox = ({ children }) => (
    // `w-full max-w-full min-w-0` pins the width to that of the container of
    // the editor (not the content's); `overflow-x-auto` makes the table
    // wide scroll INSIDE the box and not overflow the page/editor.
    <div className="my-2 w-full max-w-full min-w-0 max-h-[70vh] min-h-[8rem] overflow-x-auto overflow-y-auto focus-within:ring-1 focus-within:ring-[var(--gnosi-primary)]/30 transition-all">
        {children}
    </div>
);

// Container for the TABLE/list: does NOT scroll on its own (overflow-hidden) and is
// flex-col with bounded height so that VaultTable itself (which has its own
// internal scroller + sticky `title` column) handles the horizontal scroll and
// vertical. If we wrapped the table in a box with `overflow-x-auto`,
// the box would handle the horizontal scroll and the sticky column would not stay fixed.
//
// `isolate` (isolation: isolate) creates a stacking context that CONFINES the
// VaultTable's internal z-index values (sticky cells use z-20/z-30/z-40).
// Without this, since neither the box nor the scroller create a stacking context,
// these z-index values rise up to the embed's root and cover the dropdowns of
// the tab bar (the sticky title column, z-40, was painting over
// the "+"/"…" menu). With `isolate`, the table participates as a single block and the
// menus (in the bar, positioned) always stay on top.
//
// ADAPTIVE height: we no longer force `h-[60vh]` (it left a big gap with few
// rows). VaultTable receives `maxHeight` and its scroller takes the height of the
// content, scrolling internally only if it exceeds it. That's why the box has no
// fixed height nor `overflow-hidden` (which would clip menus that open downward):
// the border/rounding is applied by the table's own scroller (`isEmbedded` mode).
const TableBox = ({ children }) => (
    <div className="my-2 w-full max-w-full min-w-0 isolate">
        {children}
    </div>
);

// Embedded FEED container: GROWS with the content (like Notion) and it's the
// PAGE that scrolls — no 70vh box with internal scroll. The
// feed's infinite scroll plays in our favor: it starts with a small batch and the sentinel
// (which resolves the real scroller via getScrollParent) keeps loading the rest into
// as you scroll down the page; "See more" also expands the page.
const FeedFlowBox = ({ children }) => (
    <div className="my-2 w-full max-w-full min-w-0 rounded-xl border border-transparent focus-within:border-[var(--gnosi-primary)]/50 focus-within:ring-1 focus-within:ring-[var(--gnosi-primary)]/30 overflow-hidden transition-all">
        {children}
    </div>
);

/* -------------------------------------------------------------------------- */
/*  Filter / sort / format utilities                                  */
/* -------------------------------------------------------------------------- */

// Field name without decorative prefix (symbols/spaces), lowercase: allows
// a filter saved with an old variant of a column's name to match the
// canonicalized metadata under the NEW name (`Àrees`) after renaming it. Mirror
// of `_normalize_field_key` (backend view_snapshot.py).
function normFieldKey(name) {
    return String(name ?? '').replace(/^[^\p{L}\p{N}_]+/u, '').trim().toLowerCase();
}
function metaValueForField(meta, field) {
    if (!meta) return undefined;
    if (field in meta) return meta[field];
    const nf = normFieldKey(field);
    if (!nf) return undefined;
    for (const k of Object.keys(meta)) {
        if (normFieldKey(k) === nf) return meta[k];
    }
    return undefined;
}

// Values that a checkbox considers "checked". Parity with `asBool`
// (vaultFilters.js) and `_as_bool` (view_snapshot.py): field absent/""/0/"false"
// = unchecked. Replicated here (instead of importing it from vaultFilters) to
// keep the change scoped to this view's files.
const FILTER_TRUTHY = new Set(['true', '1', 'yes', 'si', 'sí', 'done', 'checked', 'completat']);
function asBool(x) {
    if (x === true) return true;
    if (x === false || x == null || x === '') return false;
    if (typeof x === 'number') return x !== 0;
    return FILTER_TRUTHY.has(String(x).trim().toLowerCase());
}

function applyFilter(row, pageId, f) {
    if (!f?.field) return true;
    const op = (f.operator || 'equals').toLowerCase();
    const raw = f.value === 'this' ? pageId : f.value;
    const target = raw == null ? null : String(raw);
    // `title` lives in the ROW, not in metadata (parity with matchesFilters):
    // without the special case, a filter by title —the default field of the
    // modal— emptied the embedded view while the table tab filtered correctly.
    let v = f.field === 'title'
        ? (row?.title || '')
        : metaValueForField(row?.metadata || {}, f.field);
    if (
        f.periodPart
        || (v && typeof v === 'object' && !Array.isArray(v) && 'start' in v)
    ) {
        v = periodBoundary(v, f.periodPart || 'start');
    }
    const arr = Array.isArray(v) ? v.map(String) : v == null || v === '' ? [] : [String(v)];
    if (op === 'is_empty') return arr.length === 0;
    if (op === 'is_not_empty') return arr.length > 0;
    if (target == null) return true;
    const targetLower = target.toLowerCase();
    // Boolean value (checkbox: "true"/"false"): we compare by truthiness —not by
    // string— so that an absent field counts as "unchecked" and matches "false".
    // Parity with matchesFilters (vaultFilters.js) and apply_filter (backend).
    if ((op === 'equals' || op === 'not_equals') && (targetLower === 'true' || targetLower === 'false')) {
        const want = targetLower === 'true';
        const cur = asBool(v);
        return op === 'equals' ? cur === want : cur !== want;
    }
    // Text/select case-INsensitive (like Notion and like the main view): a
    // the stored "Català" value matches the "català" filter. Numeric values
    // (greater/less) are compared separately, without lowercasing.
    const arrLower = arr.map(x => x.toLowerCase());
    if (op === 'equals') return arrLower.includes(targetLower);
    if (op === 'not_equals') return !arrLower.includes(targetLower);
    if (op === 'contains') return arrLower.some(x => x.includes(targetLower));
    if (op === 'not_contains') return !arrLower.some(x => x.includes(targetLower));
    // greater/less than: if BOTH (value and filter) are pure numbers, comparison
    // is numeric (parseNumericValue, parity with matchesFilters: '12,5' → 12.5,
    // comma decimal; previously bare parseFloat diverged here and even from
    // multiKeySort right here); otherwise, lowercase STRING comparison.
    // For ISO dates, lexicographic order is chronological and matches between JS
    // and Python (ASCII), so the date-range filter works and is
    // consistent with the main view and the backend.
    if (op === 'greater_than' || op === 'less_than') {
        const gt = op === 'greater_than';
        const targetNum = NUM_RE.test(target.trim());
        return arr.some((x, i) => {
            const xt = x.trim();
            if (targetNum && NUM_RE.test(xt)) {
                const n = parseNumericValue(x), t = parseNumericValue(target);
                return gt ? n > t : n < t;
            }
            // Numeric target (bare year) with a non-numeric value: only matches if the value
            // is an ISO date (lexicographic = chronological); arbitrary text ("foo")
            // does NOT match. Parity with vaultFilters (matchesFilters) and the backend.
            if (targetNum && !ISO_DATE_RE.test(xt)) return false;
            const xl = arrLower[i];
            return gt ? xl > targetLower : xl < targetLower;
        });
    }
    return true;
}

// A node is a GROUP (not a leaf rule) when it carries a `rules` array. Parity
// with vaultFilters.isFilterGroup / backend view_snapshot._is_filter_group.
function isFilterGroup(node) {
    return !!node && Array.isArray(node.rules);
}

// Recursively evaluates a filter NODE — a leaf rule { field, operator, value }
// or a group { conjunction, rules: [...] } whose children may themselves be
// groups (arbitrary nesting, like Notion). An empty group matches everything.
// 1:1 parity with vaultFilters.matchesFilterNode and the backend's
// view_snapshot.apply_filter_node.
function applyFilterNode(row, pageId, node) {
    if (!node) return true;
    if (isFilterGroup(node)) {
        const rules = node.rules;
        if (!rules || rules.length === 0) return true;
        const useOr = String(node.conjunction || 'and').toLowerCase() === 'or';
        return useOr
            ? rules.some(child => applyFilterNode(row, pageId, child))
            : rules.every(child => applyFilterNode(row, pageId, child));
    }
    return applyFilter(row, pageId, node);
}

function multiKeySort(rows, sorts) {
    // Comparator shared with the main view (vaultFilters.compareFieldValues):
    // empties last, numeric order for numbers, and normalized localeCompare for
    // the rest. It used to sort by pure string (`localeCompare`), so that
    // numbers came out lexicographic ("10" before "2") and empty values floated to the
    // top → the embedded view diverged from the main table.
    if (!sorts || sorts.length === 0) {
        return [...rows].sort((a, b) => compareFieldValues(a.title, b.title, 'asc'));
    }
    // `title` is in the row; for everything else, a tolerant key into metadata with
    // fallback to the top-level field (last_modified/created) — parity with the
    // comparator of the main view (useVaultViewData).
    const sortValOf = (r, field) => field === 'title'
        ? (r?.title || '')
        : (metaValueForField(r?.metadata, field) ?? r?.[field]);
    const result = [...rows];
    for (let i = sorts.length - 1; i >= 0; i--) {
        const { field, direction = 'asc' } = sorts[i];
        if (!field) continue;
        result.sort((a, b) => compareFieldValues(sortValOf(a, field), sortValOf(b, field), direction));
    }
    return result;
}

function displayValue(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
}

function pickDateCol(columns, rows) {
    // Whole-word match (separators: space, hyphen, underscore, or
    // start/end) to avoid false positives like "metadata" (contains "data"),
    // "Today"/"Sunday"/"Holiday" (contenen "day"), etc.
    const byName = (columns || []).find(c => /(^|[\s_-])(data|date|fecha|created|day)([\s_-]|$)/i.test(String(c || '')));
    if (byName) return byName;
    // Heuristic: first column whose values are parseable as a date in
    // at least 50% of the rows.
    for (const c of columns || []) {
        let hits = 0;
        for (const r of rows || []) {
            if (parseDate(r.metadata?.[c])) hits++;
        }
        if (hits >= Math.max(1, (rows?.length || 0) * 0.5)) return c;
    }
    return null;
}

function parseDate(v) {
    const raw = Array.isArray(v) ? v[0] : v;
    if (!raw) return null;
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function Heading({ level, children }) {
    const safeLevel = Math.min(Math.max(Number(level) || 1, 1), 6);
    const Tag = `h${safeLevel}`;
    const cls = safeLevel === 1 ? 'text-2xl font-bold mb-3'
        : safeLevel === 2 ? 'text-xl font-bold mb-2'
        : 'text-lg font-semibold mb-2';
    return <Tag className={`${cls} text-[var(--text-primary)]`}>{children}</Tag>;
}

/* -------------------------------------------------------------------------- */
/*  Action helpers (create / update property)                               */
/* -------------------------------------------------------------------------- */

async function createPageInTable({ tableId, title = 'Nou registre', extraMetadata = {} } = {}) {
    const body = {
        title,
        content: '',
        metadata: { table_id: tableId, ...extraMetadata },
    };
    const res = await axios.post('/api/vault/pages', body);
    return res.data;
}

async function patchPageMetadata(pageId, partialMetadata) {
    // Direct partial PATCH: the backend does `metadata.update(request.metadata)`
    // and keeps title/content/other fields intact. We used to do GET +
    // PATCH (2 round-trips serialized, 400-700 ms) to build a
    // full payload "for safety"; the current backend accepts partials
    // so we save the GET and its corresponding latency.
    await axios.patch(
        `/api/vault/pages/${encodeURIComponent(pageId)}`,
        { metadata: partialMetadata }
    );
    return partialMetadata;
}

async function patchSectionConfig(pageId, section, patch) {
    // The POST /api/pages/{page_id}/views does an upsert by heading. We send the
    // the full section (preserving all legacy fields) with the patch
    // applied. Requires ConfigDict(extra='allow') on the ViewSection model.
    const next = { ...section, ...patch };
    await axios.post(`/api/pages/${encodeURIComponent(pageId)}/views`, next);
    return next;
}

function ViewActionsBar({
    onCreate,
    templates = [],
    onOpenConfig,
    searchTerm,
    setSearchTerm,
    showSearch,
    setShowSearch,
}) {
    const { t } = useTranslation();
    const [showNewMenu, setShowNewMenu] = useState(false);
    const menuRef = useRef(null);
    useEffect(() => {
        if (!showNewMenu) return undefined;
        const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowNewMenu(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showNewMenu]);

    return (
        <div className="flex items-center gap-1">
            {showSearch ? (
                <div className="flex items-center gap-1 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1">
                    <Search size={12} className="text-[var(--text-tertiary)]" />
                    <input
                        autoFocus
                        type="text"
                        value={searchTerm}
                        onChange={e => setSearchTerm?.(e.target.value)}
                        placeholder={t('common.search_placeholder', "Search...")}
                        className="text-xs outline-none w-28 text-[var(--text-primary)] bg-transparent"
                    />
                    <button
                        onClick={() => { setSearchTerm?.(''); setShowSearch?.(false); }}
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                    >
                        <X size={12} />
                    </button>
                </div>
            ) : (
                <button
                    onClick={() => setShowSearch?.(true)}
                    className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    title={t('views_header.search_title', "Search")}
                >
                    <Search size={14} />
                </button>
            )}

            {onOpenConfig && (
                <button
                    onClick={onOpenConfig}
                    className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-md transition-colors"
                    title={t('views_header.view_settings', "View settings")}
                >
                    <SlidersHorizontal size={13} />
                </button>
            )}

            {onCreate && (
                <div className="relative" ref={menuRef}>
                    <button
                        onClick={() => onCreate()}
                        className="btn-gnosi btn-gnosi-primary !px-3 !py-1.5 !text-xs !gap-1.5 !shadow-none active:scale-95"
                        style={{ boxShadow: 'none' }}
                    >
                        <Plus size={14} />
                        <span>{t('views_header.new_action', "New")}</span>
                        <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); setShowNewMenu(o => !o); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowNewMenu(o => !o); } }}
                            className="pl-1 border-l border-white/20 hover:text-white/80 cursor-pointer inline-flex"
                        >
                            <ChevronDown size={14} />
                        </span>
                    </button>
                    {showNewMenu && (
                        <div className="absolute top-full right-0 mt-1 w-56 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[1001] py-1">
                            <button
                                onClick={() => { setShowNewMenu(false); onCreate(); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] text-left"
                            >
                                <Plus size={14} className="text-[var(--text-tertiary)]" />
                                <span>{t('views_header.new_empty_record', "New record")}</span>
                            </button>
                            {templates.length > 0 && (
                                <>
                                    <div className="h-px bg-[var(--border-primary)] my-1 mx-2" />
                                    <div className="px-3 py-1 text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-tighter">{t('views_header.templates_title', "Templates")}</div>
                                    {templates.map(tpl => (
                                        <button
                                            key={tpl.id}
                                            onClick={() => { setShowNewMenu(false); onCreate({}, tpl); }}
                                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] text-left group"
                                        >
                                            <LayoutTemplate size={14} className="text-[var(--text-tertiary)] group-hover:text-[var(--gnosi-primary)]" />
                                            <span className="truncate">{tpl.title || t('view.untitled', "(untitled)")}</span>
                                        </button>
                                    ))}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function ColumnPlusButton({ onClick }) {
    const { t } = useTranslation();
    return (
        <button
            onClick={onClick}
            className="text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]"
            title={t('views_header.create_in_column', "Create in this column")}
        >
            <Plus size={12} />
        </button>
    );
}

/* -------------------------------------------------------------------------- */
/*  Preview and per-table page cache                                  */
/* -------------------------------------------------------------------------- */

const _previewCache = new Map();
function _cacheGet(id) { return _previewCache.get(id); }
function _cacheSet(id, value) {
    if (_previewCache.size >= 500) {
        const oldest = _previewCache.keys().next().value;
        _previewCache.delete(oldest);
    }
    _previewCache.set(id, value);
}

const _byTableCache = new Map();
// 5 min: the cache avoids bursts of /pages/by-table calls during navigation
// short (switching tabs and back, scrolling, opening/closing the modal for
// config). The backend serves the same list for about 10-15s on cold OneDrive,
// so reusing the cache a bit longer avoids a wait
// of the same length. The cache is cleared if the user presses the reload button.
const BY_TABLE_TTL_MS = 300_000;
// Each entry can hold thousands of PageInfo (a large table), so
// unlike the per-entry TTL, a hard limit on entries is needed to prevent
// a long session visiting many tables from accumulating memory unchecked. 32
// tables comfortably covers any active view; once exceeded, eviction
// FIFO of the oldest one (Map preserves insertion order).
const BY_TABLE_MAX_ENTRIES = 32;
function _byTableGet(tableId) {
    const e = _byTableCache.get(tableId);
    if (!e) return null;
    if (Date.now() - e.ts > BY_TABLE_TTL_MS) { _byTableCache.delete(tableId); return null; }
    return e.value;
}
function _byTableSet(tableId, value) {
    // Refreshes the insertion position so the FIFO head doesn't evict a table
    // that was just re-read.
    if (_byTableCache.has(tableId)) _byTableCache.delete(tableId);
    else if (_byTableCache.size >= BY_TABLE_MAX_ENTRIES) {
        const oldest = _byTableCache.keys().next().value;
        _byTableCache.delete(oldest);
    }
    _byTableCache.set(tableId, { ts: Date.now(), value });
}

/* -------------------------------------------------------------------------- */
/*  Graph (force)                                                             */
/* -------------------------------------------------------------------------- */

function GraphRender({ rows, columns, onOpenPage }) {
    const { t } = useTranslation();
    const idToRow = useMemo(() => Object.fromEntries((rows || []).map(r => [r.id, r])), [rows]);
    const titleToId = useMemo(() => {
        const m = {};
        (rows || []).forEach(r => { if (r.title) m[r.title] = r.id; });
        return m;
    }, [rows]);

    const relationCol = (columns || []).find(c => (rows || []).some(r => Array.isArray(r.metadata?.[c]) && r.metadata[c].length > 0));

    const { nodes, links } = useMemo(() => {
        const nodeMap = new Map();
        (rows || []).forEach(r => nodeMap.set(r.id, { id: r.id, title: r.title || t('view.untitled', "(untitled)") }));
        const edges = [];
        if (relationCol) {
            (rows || []).forEach(r => {
                const targets = r.metadata?.[relationCol];
                if (!Array.isArray(targets)) return;
                targets.forEach(t => {
                    const tid = idToRow[t] ? t : titleToId[t];
                    if (!tid) return;
                    if (!nodeMap.has(tid)) nodeMap.set(tid, { id: tid, title: tid });
                    edges.push({ source: r.id, target: tid });
                });
            });
        }
        return { nodes: Array.from(nodeMap.values()), links: edges };
    }, [rows, relationCol, idToRow, titleToId]);

    const svgRef = useRef(null);
    const [hover, setHover] = useState(null);
    const W = 600, H = 360;

    // Force simulation run as a derived computation (useMemo) to avoid
    // setState inside useEffect — the cost is amortizable: ~250 iterations × N²
    // is fast for views with fewer than 200 nodes (the common case).
    const positions = useMemo(() => {
        if (nodes.length === 0) return {};
        const sim = nodes.map((n, i) => ({
            id: n.id,
            x: W / 2 + Math.cos((i * 2 * Math.PI) / nodes.length) * 80,
            y: H / 2 + Math.sin((i * 2 * Math.PI) / nodes.length) * 80,
            vx: 0, vy: 0,
        }));
        const byId = Object.fromEntries(sim.map(s => [s.id, s]));
        const REPEL = 4000, SPRING = 0.02, SPRING_LEN = 80, CENTER = 0.005, DAMP = 0.85, STEPS = 250;

        for (let step = 0; step < STEPS; step++) {
            for (let i = 0; i < sim.length; i++) {
                for (let j = i + 1; j < sim.length; j++) {
                    const a = sim[i], b = sim[j];
                    let dx = a.x - b.x, dy = a.y - b.y;
                    const dist2 = dx * dx + dy * dy + 0.01;
                    const f = REPEL / dist2;
                    const dist = Math.sqrt(dist2);
                    dx /= dist; dy /= dist;
                    a.vx += dx * f * 0.001; a.vy += dy * f * 0.001;
                    b.vx -= dx * f * 0.001; b.vy -= dy * f * 0.001;
                }
            }
            links.forEach(l => {
                const s = byId[l.source], t = byId[l.target];
                if (!s || !t) return;
                const dx = t.x - s.x, dy = t.y - s.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const f = SPRING * (dist - SPRING_LEN);
                const fx = (dx / dist) * f, fy = (dy / dist) * f;
                s.vx += fx; s.vy += fy; t.vx -= fx; t.vy -= fy;
            });
            sim.forEach(n => {
                n.vx += (W / 2 - n.x) * CENTER;
                n.vy += (H / 2 - n.y) * CENTER;
                n.vx *= DAMP; n.vy *= DAMP;
                n.x += n.vx; n.y += n.vy;
                n.x = Math.max(20, Math.min(W - 20, n.x));
                n.y = Math.max(20, Math.min(H - 20, n.y));
            });
        }
        return Object.fromEntries(sim.map(s => [s.id, { x: s.x, y: s.y }]));
    }, [nodes, links]);

    return (
        <div className="my-2 bg-[var(--bg-secondary)]/30">
            <div className="p-2 border-b border-[var(--border-primary)]/40 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                {t('view.graph_title', "Graph")} {relationCol ? <>{t('view.graph_via', 'via')} <code>{relationCol}</code></> : t('view.graph_no_relations', "(no relations)")} · {t('view.graph_stats', "{{nodes}} nodes · {{edges}} edges", { nodes: nodes.length, edges: links.length })}
            </div>
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 400 }}>
                {links.map((l, i) => {
                    const a = positions[l.source], b = positions[l.target];
                    if (!a || !b) return null;
                    return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border-primary)" strokeOpacity="0.6" strokeWidth="1" />;
                })}
                {nodes.map(n => {
                    const p = positions[n.id]; if (!p) return null;
                    const isHover = hover === n.id;
                    return (
                        <g
                            key={n.id}
                            transform={`translate(${p.x}, ${p.y})`}
                            style={{ cursor: 'pointer' }}
                            onClick={() => onOpenPage?.(n.id)}
                            onMouseEnter={() => setHover(n.id)}
                            onMouseLeave={() => setHover(null)}
                        >
                            <circle r={isHover ? 8 : 5} fill="var(--gnosi-primary)" />
                            <text
                                x={10}
                                y={4}
                                fontSize={isHover ? 12 : 10}
                                fill="var(--text-primary)"
                                style={{ pointerEvents: 'none' }}
                            >
                                {n.title.length > 24 ? n.title.slice(0, 22) + '…' : n.title}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Wrapper principal                                                         */
/* -------------------------------------------------------------------------- */

export function DbViewEmbed({ block }) {
    const { t } = useTranslation();
    const ctx = useContext(VaultEditorContext) || {};
    const pageId = ctx.pageId;
    const onOpenPage = ctx.onOpenPage;
    const onOpenPageViewModal = ctx.onOpenPageViewModal;
    const onOpenViewConfig = ctx.onOpenViewConfig;
    // Keyboard-navigation API that the embedded VaultTable registers with, so that
    // the editor can "enter" the table (focusFirstCell/focusLastCell) when
    // you can reach it with the arrow keys. See the bridge in VaultEditorContext.
    const tableNavApiRef = useRef(null);
    // Outer container of the embed. When the view is NOT table/list (feed,
    // gallery, kanban, timeline…) there are no navigable cells: we make the
    // whole shell focusable (tabIndex=-1) and act like a widget —
    // "entering it" with ↓ gives it a visible focus, and you exit with ↑/↓/Esc.
    const embedContainerRef = useRef(null);
    const isInEditor = typeof ctx.exitEmbedToEditor === 'function';

    // Focuses the SHELL of the embed (widget). Serves as an «entry point» for views
    // without navigable cells and as the Esc target from records (gallery).
    const focusShell = useCallback(() => {
        const el = embedContainerRef.current;
        if (!el) return false;
        try { el.focus({ preventScroll: false }); el.scrollIntoView({ block: 'nearest' }); } catch { /* noop */ }
        return true;
    }, []);

    // Keyboard handling when the SHELL has focus (not a child: card, search, cell…).
    // ↑/↓ return the cursor to the editor (adjacent block or upper zone); Esc exits.
    // Space/Enter "goes down" into it: enters the view's records (first cell or
    // card) if it has navigable ones (table/list/gallery). Feed/kanban/timeline
    // don't register the API → they do nothing and the key is left to pass through.
    const handleShellKeyDown = useCallback((e) => {
        if (e.target !== embedContainerRef.current) return;
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            const dir = e.key === 'ArrowUp' ? 'up' : (e.key === 'ArrowDown' ? 'down' : 'escape');
            ctx.exitEmbedToEditor?.(block?.id, dir);
            return;
        }
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            const r = tableNavApiRef.current?.focusFirstCell?.();
            if (r !== undefined && r !== false) {
                e.preventDefault();
                e.stopPropagation();
            }
        }
    }, [ctx, block?.id]);

    const viewId = String(block?.props?.view_id || '').trim();
    const headingProp = block?.props?.heading || '';
    const headingLevelProp = Number(block?.props?.heading_level) || 0;

    const [view, setView] = useState(null);          // the embedded SECTION (anchor: table + `this`)
    const [rawRecords, setRawRecords] = useState([]); // non-template records WITHOUT filtering
    const [templates, setTemplates] = useState([]);  // separate templates
    // PHASE 3: view tabs. List of the table's views (registry.views)
    // and which one is active. By default, the block's section view.
    const [tableViews, setTableViews] = useState([]);
    const [activeViewId, setActiveViewId] = useState('');
    const [loading, setLoading] = useState(() => Boolean(pageId && viewId));
    const [error, setError] = useState(() => {
        if (!pageId) return t('errors.no_active_page', "No active page to resolve the view.");
        if (!viewId) return t('errors.view_missing_id', "View without view_id.");
        return '';
    });
    const [reloadKey, setReloadKey] = useState(0);
    // Last `viewSectionNonce` (from the context) that we have already applied. When it changes, it
    // means a view's config has just been saved: the client's ctx.registry
    // goes stale and the views need to be reread from the backend (see `load`).
    const lastSavedNonceRef = useRef(0);
    const [searchTerm, setSearchTerm] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [addMenuOpen, setAddMenuOpen] = useState(false); // add-view menu (type / existing)
    const [tabMenuFor, setTabMenuFor] = useState(null);     // id of the view with its (remove/delete) menu open
    const [menuUp, setMenuUp] = useState(false);            // open the dropdown upward if it doesn't fit below
    const [confirmDeleteView, setConfirmDeleteView] = useState(null); // view pending deletion everywhere (ConfirmModal)
    const [renameView, setRenameView] = useState(null);     // view pending rename (PromptModal)
    // Decides the dropdown's direction based on the space below the trigger.
    const decideMenuDir = (e) => {
        try { const r = e.currentTarget.getBoundingClientRect(); setMenuUp(window.innerHeight - r.bottom < 300); } catch { setMenuUp(false); }
    };
    // Views PINNED as tabs IN THIS block, apart from the view of the
    // section (anchor, always present). None by default: the block shows only the
    // view that was inserted/chosen, not all of the table's views. Two sources:
    //   · `tabs` of the ANCHOR view in the registry (persistent and portable across
    //     browsers — this is what the Notion importer writes to replicate
    //     the block's tabs)
    //   · localStorage (legacy local pins). Key: pageId + view_id of the section.
    const [pinnedViewIds, setPinnedViewIds] = useState(() => {
        try { return new Set(JSON.parse(localStorage.getItem(`gnosi_embed_pinned_${pageId}_${viewId}`) || '[]')); } catch { return new Set(); }
    });
    const persistPinned = (set) => {
        try { localStorage.setItem(`gnosi_embed_pinned_${pageId}_${viewId}`, JSON.stringify([...set])); } catch { /* noop */ }
    };
    // Persists the block's tabs in the anchor view's `tabs` field in the
    // registry (the PUT merges by key, the full dict isn't required). If the anchor
    // isn't in the registry (a legacy section without a view), it fails silently and
    // localStorage still calls the shots.
    const persistServerTabs = useCallback((set) => {
        axios.put(`/api/vault/views/${encodeURIComponent(viewId)}`, { tabs: [...set] })
            .catch(() => { /* anchor outside the registry: localStorage only */ });
    }, [viewId]);

    const reload = useCallback(() => {
        _byTableCache.delete(view?.source_table_id || view?.table_id);
        setReloadKey(k => k + 1);
    }, [view]);

    useEffect(() => {
        if (!pageId || !viewId) return undefined;
        let cancelled = false;
        const load = async () => {
            setError('');
            setLoading(true);
            try {
                const viewsRes = await axios.get(`/api/pages/${encodeURIComponent(pageId)}/views`);
                const sections = viewsRes.data?.sections || [];
                let section = sections.find(s => s.view_id === viewId)
                    || (headingProp ? sections.find(s => s.heading === headingProp) : null);
                // Fallback: if this block has no registered section (e.g. because
                // the PER HEADING section upsert has collided with another
                // it's an embed without a heading on the same page), but the view DOES
                // exist in the registry, we build the section from the view.
                // The fence's `view_id` is the source of truth: this way the block
                // renders even if the page section has been lost.
                if (!section) {
                    let regView = (ctx.registry?.views || []).find(v => String(v.id) === String(viewId));
                    if (!regView) {
                        try {
                            const vr = await axios.get('/api/vault/views');
                            const allViews = Array.isArray(vr.data) ? vr.data : (vr.data?.views || []);
                            regView = allViews.find(v => String(v.id) === String(viewId));
                        } catch { /* registry inaccessible: it will fall to the error below */ }
                    }
                    if (regView) {
                        section = {
                            view_id: regView.id,
                            heading: headingProp || '',
                            source_table_id: regView.table_id,
                            view_type: regView.type || 'table',
                            filters: regView.filters || [],
                            sorts: regView.sorts || (regView.sort ? [regView.sort] : []),
                            visible_properties: regView.visibleProperties || regView.visible_properties || ['title'],
                        };
                    }
                }
                if (cancelled) return;
                if (!section) {
                    if (!cancelled) {
                        setView(null);
                        setRawRecords([]);
                        setTemplates([]);
                        setError(t('errors.view_not_found_registry', "View \"{{id}}...\" not found in the registry.", { id: viewId.slice(0, 8) }));
                        setLoading(false);
                    }
                    return;
                }
                if (!cancelled) setView(section);

                const tableId = section.source_table_id || section.table_id;
                if (!tableId) {
                    if (!cancelled) { setRawRecords([]); setTemplates([]); setLoading(false); }
                    return;
                }

                const cached = _byTableGet(tableId);
                let all = cached;
                if (!all) {
                    const pagesRes = await axios.get(`/api/vault/pages/by-table/${encodeURIComponent(tableId)}`);
                    all = Array.isArray(pagesRes.data) ? pagesRes.data : [];
                    _byTableSet(tableId, all);
                }

                // Separate templates (for the "New" button's dropdown) from the
                // records to display. Templates never appear in the body
                // of the view, even if they pass the filters.
                const tpls = all.filter(p => p.metadata?.is_template === true);
                const records = all.filter(p => !p.metadata?.is_template);

                // The table's views (for the tabs and for the cardSize/
                // galleryPreview from which embeddedView derives). They usually come from
                // ctx.registry, but right after a view's config is saved to
                // (viewSectionNonce has changed) this one goes stale — saving touches
                // the backend, not to ctx.registry—, so we reread the views
                // fresh, so the change (size/preview…) is visible live.
                let registryViews = ctx.registry?.views || [];
                if (ctx.viewSectionNonce !== lastSavedNonceRef.current) {
                    lastSavedNonceRef.current = ctx.viewSectionNonce;
                    try {
                        const vr = await axios.get('/api/vault/views');
                        const fresh = Array.isArray(vr.data) ? vr.data : vr.data?.views;
                        if (Array.isArray(fresh)) registryViews = fresh;
                    } catch { /* fallback: ctx.registry */ }
                }

                if (!cancelled) {
                    setRawRecords(records);
                    setTemplates(tpls);
                    // Pinned tabs = anchor view's `tabs` in the registry
                    // (portable; written by the Notion importer or by its own
                    // pinned by the user) ∪ localStorage (legacy local pins).
                    let pinned = [];
                    try {
                        pinned = JSON.parse(localStorage.getItem(`gnosi_embed_pinned_${pageId}_${viewId}`) || '[]');
                    } catch { /* noop */ }
                    const anchorReg = registryViews.find(v => String(v.id) === String(viewId));
                    if (Array.isArray(anchorReg?.tabs)) pinned = [...pinned, ...anchorReg.tabs.map(String)];
                    setPinnedViewIds(new Set(pinned));
                    // We guarantee the section's view is always there.
                    const tv = registryViews.filter(v => String(v.table_id) === String(tableId));
                    const sectionAsView = {
                        id: section.view_id,
                        name: section.heading || t('views_header.default_view_name', "View"),
                        type: section.view_type || 'table',
                        table_id: tableId,
                        filters: section.filters || [],
                        sorts: section.sorts || (section.sort ? [section.sort] : []),
                        visibleProperties: section.visible_properties || section.columns || ['title'],
                        // Per-type options saved in the section (ViewSection accepts
                        // extra fields); we preserve them so embeddedView can read them.
                        cardSize: section.cardSize,
                        galleryPreview: section.galleryPreview,
                        coverField: section.coverField || section.cover_field,
                        imageFit: section.imageFit || section.image_fit,
                        groupBy: section.groupBy || section.group_by,
                        dateField: section.dateField || section.date_field,
                        endDateField: section.endDateField || section.end_date_field,
                        calendarView: section.calendarView || section.calendar_view,
                        colorField: section.colorField || section.color_field,
                        rowHeight: section.rowHeight || section.row_height,
                        enableSubitems: section.enableSubitems ?? section.enable_subitems,
                        columnWidths: section.columnWidths || section.column_widths,
                        // Chart options (the 'chart' view).
                        chartType: section.chartType || section.chart_type,
                        xField: section.xField || section.x_field,
                        yField: section.yField || section.y_field,
                        aggregation: section.aggregation,
                    };
                    const merged = tv.some(v => v.id === section.view_id) ? tv : [sectionAsView, ...tv];
                    setTableViews(merged);
                    // Remembers the last selected tab if it still exists;
                    // otherwise, it falls back to the block's section view. The key must
                    // be STABLE across reloads: `block.id` gets regenerated by
                    // BlockNote on every load, but the section's `pageId`+`view_id`
                    // are persisted in the markdown fence.
                    let saved = '';
                    try { saved = localStorage.getItem(`gnosi_embed_view_${pageId}_${viewId}`) || ''; } catch { /* noop */ }
                    const def = (saved && merged.some(v => v.id === saved)) ? saved : section.view_id;
                    setActiveViewId(prev => prev || def);
                    setLoading(false);
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e?.response?.data?.detail || e?.message || t('errors.load_view', "Error loading the view"));
                    setRawRecords([]);
                    setTemplates([]);
                    setLoading(false);
                }
            }
        };
        void load();
        return () => { cancelled = true; };
        // `ctx.viewSectionNonce` increments when a view's config is saved
        // (BlockEditor): we re-trigger the load to read the updated section
        // (cardSize/galleryPreview/…), because editing only the size doesn't change
        // viewId/headingProp and the useEffect wouldn't re-trigger otherwise.
    }, [viewId, pageId, headingProp, reloadKey, ctx.viewSectionNonce]);

    const tableId = view?.source_table_id || view?.table_id;

    // The EFFECTIVE view = the active tab (of the table) or, by default, the
    // the block's section. Columns, type, filters, and sorting all come from it.
    const effectiveView = useMemo(() => {
        const fromTab = tableViews.find(v => v.id === activeViewId);
        return fromTab || view || null;
    }, [tableViews, activeViewId, view]);

    const columns = useMemo(
        () => effectiveView?.visibleProperties || effectiveView?.visible_properties || effectiveView?.columns || ['title'],
        [effectiveView],
    );
    const rawType = String(effectiveView?.view_type || effectiveView?.type || 'table').toLowerCase();
    const viewType = rawType === 'db_view' ? 'table' : rawType;
    // The title/heading is carried by the block's section (it doesn't change with the tab).
    const displayHeading = headingProp || view?.heading;
    const displayLevel = headingLevelProp || view?.heading_level || 1;

    // Derived rows: raw records filtered by the effective view (with the
    // `this` value → pageId) and sorted. Reacts when switching tabs
    // without a refetch (same table).
    const allRows = useMemo(() => {
        // Prefer the nested `filterTree` (complex AND/OR groups); fall back to the
        // legacy flat `filters`/`filter` (AND). Parity with the main view
        // (viewMatchesFilters) and the backend snapshot (resolve_rows).
        const tree = isFilterGroup(effectiveView?.filterTree)
            ? effectiveView.filterTree
            : {
                conjunction: 'and',
                rules: (effectiveView?.filters && effectiveView.filters.length > 0)
                    ? effectiveView.filters
                    : (effectiveView?.filter ? [effectiveView.filter] : []),
            };
        const filtered = rawRecords.filter(r => applyFilterNode(r, pageId, tree));
        const sorts = (effectiveView?.sorts && effectiveView.sorts.length > 0)
            ? effectiveView.sorts
            : (effectiveView?.sort ? [effectiveView.sort] : []);
        return multiKeySort(filtered, sorts);
    }, [rawRecords, effectiveView, pageId]);

    // Local search over the set of records: title + ALL the metadata,
    // accent-insensitive (normalizeForSearch) — parity with matchesSearch from
    // the main view. It used to be bare toLowerCase ("merce" would not find
    // "Mercè") and it only looked at the visible columns.
    const rows = useMemo(() => {
        const q = normalizeForSearch(searchTerm.trim());
        if (!q) return allRows;
        return allRows.filter(r => {
            if (normalizeForSearch(r.title || '').includes(q)) return true;
            return Object.values(r.metadata || {}).some(v => {
                if (v == null) return false;
                const s = Array.isArray(v) ? v.join(' ') : String(v);
                return normalizeForSearch(s).includes(q);
            });
        });
    }, [allRows, searchTerm]);

    const handleCreate = useCallback(async (extra = {}, template = null) => {
        if (!tableId) return;
        try {
            const baseMeta = template?.metadata || {};
            const title = template ? `Nou (${template.title || 'plantilla'})` : 'Nou registre';
            const created = await createPageInTable({
                tableId,
                title,
                extraMetadata: {
                    ...baseMeta,
                    is_template: false,
                    ...extra,
                },
            });
            const newId = created?.id;
            reload();
            if (newId) onOpenPage?.(newId);
        } catch (e) {
            console.warn('createPageInTable failed', e);
        }
    }, [tableId, onOpenPage, reload]);

    const handleMove = useCallback(async (pageId_, field, value) => {
        await patchPageMetadata(pageId_, { [field]: value });
        _byTableCache.delete(tableId);
    }, [tableId]);

    const handleChangeGroupBy = useCallback(async (newGroupBy) => {
        if (!view || !pageId) return;
        const next = await patchSectionConfig(pageId, view, { group_by: newGroupBy });
        setView(next);
    }, [view, pageId]);

    const handleOpenConfig = useCallback(() => {
        if (!onOpenPageViewModal || !tableId) return;
        const sectionVid = block?.props?.view_id || '';
        if (!activeViewId || activeViewId === sectionVid) {
            // The active tab is the section's view → the block's config as-is.
            onOpenPageViewModal(tableId, block);
        } else {
            // Config for the ACTIVE tab's view: we pass an editingBlock
            // synthetic one with its view_id. When saving, PageViewModal updates
            // this view and re-anchors the block's section to it (the block then
            // shows the view you configured).
            onOpenPageViewModal(tableId, {
                id: block?.id,
                props: { view_id: activeViewId, heading: headingProp || '', heading_level: headingLevelProp || 1 },
            });
        }
    }, [onOpenPageViewModal, tableId, block, activeViewId, headingProp, headingLevelProp]);

    // --- PHASE 3: CRUD for the view tabs (registry.views) ---
    const refetchTableViews = useCallback(async () => {
        try {
            const res = await axios.get('/api/vault/views');
            const all = Array.isArray(res.data) ? res.data : (res.data?.views || []);
            setTableViews(all.filter(v => String(v.table_id) === String(tableId)));
        } catch { /* keep the current state */ }
    }, [tableId]);

    const pinView = useCallback((id) => {
        if (!id || id === viewId) return;
        setPinnedViewIds(prev => { const next = new Set(prev); next.add(id); persistPinned(next); persistServerTabs(next); return next; });
    }, [viewId, pageId, persistServerTabs]);

    const handleAddView = useCallback((type = 'table') => {
        if (!tableId || !onOpenViewConfig) return;
        onOpenViewConfig({ type: type, name: '' }, (savedView) => {
            if (savedView?.id) {
                pinView(savedView.id);
                setActiveViewId(savedView.id);
            }
        });
    }, [tableId, onOpenViewConfig, pinView]);

    // Adds a view that ALREADY exists on the table to this block (pins it as
    // tab). It creates nothing new.
    const handleAddExistingView = useCallback((v) => {
        if (!v?.id) return;
        pinView(v.id);
        setActiveViewId(v.id);
    }, [pinView]);

    const handleDeleteView = useCallback((v) => {
        if (!v?.id) return;
        if (tableViews.length <= 1) { toast.error(t('errors.delete_only_view', "Cannot delete the only view.")); return; }
        setConfirmDeleteView(v);
    }, [tableViews]);

    const doDeleteView = useCallback(async () => {
        const v = confirmDeleteView;
        setConfirmDeleteView(null);
        if (!v?.id) return;
        try {
            await axios.delete(`/api/vault/views/${encodeURIComponent(v.id)}`);
            await refetchTableViews();
            if (activeViewId === v.id) setActiveViewId(view?.view_id || '');
        } catch (e) { console.warn('delete view failed', e); }
    }, [confirmDeleteView, activeViewId, view, refetchTableViews]);

    // Removes the view from this block ("unpins" it); does NOT delete it from the registry.
    // The section's view (anchor) cannot be removed.
    const handleUnpinView = useCallback((v) => {
        if (!v?.id || v.id === viewId) return;
        setPinnedViewIds(prev => { const next = new Set(prev); next.delete(v.id); persistPinned(next); persistServerTabs(next); return next; });
        if (activeViewId === v.id) setActiveViewId(viewId);
    }, [viewId, pageId, activeViewId, persistServerTabs]);

    const handleRenameView = useCallback((v) => {
        if (!v?.id) return;
        setRenameView(v);
    }, []);

    const doRename = useCallback(async (name) => {
        const v = renameView;
        setRenameView(null);
        if (!v?.id) return;
        if (!name || name === (v.name || v.heading)) return;
        try {
            await axios.put(`/api/vault/views/${encodeURIComponent(v.id)}`, { ...v, name });
            await refetchTableViews();
        } catch (e) { console.warn('rename view failed', e); }
    }, [renameView, refetchTableViews]);

    // Configures a SPECIFIC view (the one from the "..." menu, not necessarily the active one).
    // Same logic as handleOpenConfig but parameterized by `v`: if it's the
    // section's view, it opens the block as-is; if not, it passes a synthetic editingBlock
    // with its view_id (when saving, it re-anchors the section to this view).
    const handleConfigureView = useCallback((v) => {
        if (!onOpenPageViewModal || !tableId) return;
        const sectionVid = block?.props?.view_id || '';
        if (!v?.id || v.id === sectionVid) {
            onOpenPageViewModal(tableId, block);
        } else {
            onOpenPageViewModal(tableId, {
                id: block?.id,
                props: { view_id: v.id, heading: headingProp || '', heading_level: headingLevelProp || 1 },
            });
        }
    }, [onOpenPageViewModal, tableId, block, headingProp, headingLevelProp]);

    // Duplicates a view in the registry (a new view with the same filters/sort/
    // columns) and pins it as this block's tab.
    const handleDuplicateView = useCallback(async (v) => {
        if (!v?.id || !tableId) return;
        try {
            // FULL copy of the view (like the board's duplicate): copying
            // only filters/sort/columns used to lose all the per-type options
            // (chartType/xField, groupBy, dateField, cardSize…) and copying a
            // chart used to come out empty. The identity fields are removed and
            // rewrite their own.
            const { id: _id, is_main: _im, is_default: _idf, ...rest } = v;
            const sorts = v.sorts || (v.sort ? [v.sort] : []);
            const res = await axios.post('/api/vault/views', {
                ...rest,
                table_id: tableId,
                name: `${v.name || v.heading || 'Vista'} (còpia)`,
                type: v.type || 'table',
                filters: v.filters || [],
                sorts,
                sort: sorts[0] || null,
                visibleProperties: v.visibleProperties || columns || ['title'],
                // It originates as a tab of this block, not of the board
                // (isPageEmbedView filters it out of the table tabs).
                embedded: true,
            });
            await refetchTableViews();
            if (res.data?.id) { pinView(res.data.id); setActiveViewId(res.data.id); }
        } catch (e) { console.warn('duplicate view failed', e); }
    }, [tableId, columns, refetchTableViews, pinView]);

    // Editor↔view bridge: registers this view in the context under `block.id` so that
    // the editor can enter it with the keyboard. The actual API (focusFirstCell/Last)
    // la proporciona la VaultTable via `registerNavApi` → tableNavApiRef.
    useEffect(() => {
        if (!ctx.registerEmbedNav || !block?.id) return undefined;
        // Entry with ↓ from the editor:
        //  - Table/list → first/last CELL (VaultTable registers it).
        //  - Rest of the views (gallery, feed, kanban, timeline) → the SHELL of the
        //    the embed (widget), so the user can see it's there and can leave it
        //    with ↑/↓/Esc or drop down into the records with Space/Enter (gallery). Before,
        //    for non-tables, we returned `false` and the cursor fell into a void block
        //    without a visible caret or exit.
        const isCellNav = viewType === 'table' || viewType === 'list';
        ctx.registerEmbedNav(block.id, {
            focusFirstCell: () => {
                if (!isCellNav) return focusShell();
                const r = tableNavApiRef.current?.focusFirstCell?.();
                return (r !== undefined && r !== false) ? true : focusShell();
            },
            focusLastCell: () => {
                if (!isCellNav) return focusShell();
                const r = tableNavApiRef.current?.focusLastCell?.();
                return (r !== undefined && r !== false) ? true : focusShell();
            },
        });
        return () => ctx.registerEmbedNav(block.id, null);
    }, [ctx, block?.id, viewType, focusShell]);

    // --- PHASE 1: full EDITABLE table inside the embed reusing VaultTable ---
    // DEFINED BEFORE the early returns (loading/error) so as not to violate the
    // Rules of Hooks. The table and schema come from the context's registry.
    const table = (ctx.registry?.tables || ctx.allTables || []).find(t => String(t.id) === String(tableId)) || null;
    const embeddedSchema = useMemo(
        () => buildSchemaFromTableProperties(table?.properties || []),
        [table],
    );
    // The embedded section → the "view" model that VaultTable expects. The filters
    // (including `this` → pageId) and sorting are ALREADY applied to `rows`, so
    // we don't pass them again as filters (VaultTable doesn't know how to resolve `this`);
    // editing filters/sorting is delegated to the configuration modal of
    // the embed (onEditSchema('filters'|'sorts') → handleOpenConfig).
    const embeddedView = useMemo(() => ({
        id: effectiveView?.id || effectiveView?.view_id || 'embedded',
        name: effectiveView?.name || effectiveView?.heading || t('views_header.default_view_name', "View"),
        type: viewType === 'list' ? 'list' : 'table',
        filters: [],
        sort: (effectiveView?.sorts && effectiveView.sorts.length) ? effectiveView.sorts : (effectiveView?.sort ? [effectiveView.sort] : []),
        visibleProperties: columns,
        // Reflects the real signal: if the active tab is the MAIN view,
        // the table shows the entire live schema; otherwise, it respects visibleProperties.
        is_main: !!(effectiveView?.is_main || effectiveView?.is_default),
        // Type-specific options (gallery/kanban/calendar/timeline). In the
        // embed props were lost; we propagate them from the effective view (registry
        // or section) so the render honors them the same as on the table page.
        cardSize: effectiveView?.cardSize,
        galleryPreview: effectiveView?.galleryPreview,
        coverField: effectiveView?.coverField || effectiveView?.cover_field,
        imageFit: effectiveView?.imageFit || effectiveView?.image_fit,
        groupBy: effectiveView?.groupBy || effectiveView?.group_by,
        dateField: effectiveView?.dateField || effectiveView?.date_field,
        endDateField: effectiveView?.endDateField || effectiveView?.end_date_field,
        calendarView: effectiveView?.calendarView || effectiveView?.calendar_view,
        colorField: effectiveView?.colorField || effectiveView?.color_field,
        rowHeight: effectiveView?.rowHeight || effectiveView?.row_height,
        enableSubitems: effectiveView?.enableSubitems ?? effectiveView?.enable_subitems,
        columnWidths: effectiveView?.columnWidths || effectiveView?.column_widths,
        // Chart options (embedded 'chart' view).
        chartType: effectiveView?.chartType || effectiveView?.chart_type,
        xField: effectiveView?.xField || effectiveView?.x_field,
        yField: effectiveView?.yField || effectiveView?.y_field,
        aggregation: effectiveView?.aggregation,
    }), [effectiveView, viewType, columns]);

    if (loading) {
        return (
            <div className="my-4 p-4 flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                <Loader2 size={14} className="animate-spin" />
                {t('views_header.loading_view', "Loading view...")}
            </div>
        );
    }

    if (error) {
        return (
            <div className="my-4 p-3 bg-[var(--status-error)]/5 border border-[var(--status-error)]/20 rounded-lg flex items-start gap-2.5">
                <AlertCircle size={16} className="text-[var(--status-error)] mt-0.5 shrink-0" />
                <div className="text-xs text-[var(--status-error)]">{error}</div>
            </div>
        );
    }

    const commonProps = { rows, columns, view, onOpenPage, onCreate: tableId ? handleCreate : null, blockId: block?.id };

    // Shared callback adapters for ALL real view components
    // (table/list/kanban/gallery/timeline/feed/calendar).
    const onEditSchemaAdapter = (type) => {
        if (type === 'filters' || type === 'sorts') handleOpenConfig();
        else if (ctx.onEditSchema && table) ctx.onEditSchema(table);
    };
    const onCreateRecordAdapter = (templateId) => {
        const tpl = templates.find(t => t.id === templateId) || null;
        handleCreate({}, tpl);
    };
    // We notify VaultDashboard of the deleted ids so it records them in the
    // its undo stack (the global Cmd+Z lives there). The soft-delete of the view
    // embedded one goes through direct axios and, without this signal, it wasn't undoable.
    const announceDeleted = (ids) => {
        const clean = [...(ids || [])].filter(Boolean);
        if (!clean.length) return;
        window.dispatchEvent(new CustomEvent('gnosi:records-deleted', { detail: { ids: clean } }));
    };
    const onDeletePageAdapter = (id, title) => { ctx.onDeletePage?.(id, title); if (id) announceDeleted([id]); setTimeout(reload, 400); };
    const onDeleteSelectedAdapter = (ids) => {
        Promise.allSettled([...ids].map(id => axios.delete(`/api/vault/pages/${encodeURIComponent(id)}`)))
            .then((results) => {
                const ok = [...ids].filter((_, i) => results[i]?.status === 'fulfilled'
                    || results[i]?.reason?.response?.status === 404);
                announceDeleted(ok);
                reload();
            });
    };
    const onUpdateViewAdapter = async (nextView) => {
        if (!pageId) return;
        const sorts = Array.isArray(nextView?.sort) ? nextView.sort : (nextView?.sort ? [nextView.sort] : []);
        // `columnWidths` is sent by VaultTable when resizing a column: without
        // persist it, the widths would revert on every reload (the
        // main view does save them via VaultDashboard).
        const isSection = !view ? false : (activeViewId === view.view_id);
        if (isSection || !activeViewId) {
            // The active tab is the block's section → patch to the section.
            const next = await patchSectionConfig(pageId, view, {
                visible_properties: nextView?.visibleProperties || columns,
                sorts,
                sort: sorts[0] || null,
                group_by: nextView?.group_by ?? view?.group_by,
                ...(nextView?.columnWidths ? { columnWidths: nextView.columnWidths } : {}),
            });
            setView(next);
        } else {
            // Tab of a registry view → direct PUT to /api/vault/views.
            const current = tableViews.find(v => v.id === activeViewId) || {};
            try {
                await axios.put(`/api/vault/views/${encodeURIComponent(activeViewId)}`, {
                    ...current,
                    visibleProperties: nextView?.visibleProperties || columns,
                    sorts,
                    sort: sorts[0] || null,
                    ...(nextView?.group_by !== undefined ? { group_by: nextView.group_by } : {}),
                    ...(nextView?.columnWidths ? { columnWidths: nextView.columnWidths } : {}),
                });
                await refetchTableViews();
            } catch (e) { console.warn('update view failed', e); }
        }
    };
    const onUpdateNoteAdapter = async (id, patch) => {
        await patchPageMetadata(id, patch?.metadata || patch || {});
        reload();
    };
    // Common props for rich components that share the same signature.
    const sharedViewProps = {
        notes: rows,
        schema: embeddedSchema,
        idToTitle: ctx.idToTitle || {},
        allNotes: allRows,
        activeView: embeddedView,
        // Maximum cap on the embedded table/list height: below that, it grows with
        // the content (without empty space); above that it scrolls internally.
        maxHeight: '70vh',
        searchTerm,
        onSearchChange: setSearchTerm,
        onNoteSelect: (id) => onOpenPage?.(id),
        onCreateRecord: onCreateRecordAdapter,
        onDeletePage: onDeletePageAdapter,
        onDeleteSelected: onDeleteSelectedAdapter,
        onEditSchema: onEditSchemaAdapter,
        onUpdateView: onUpdateViewAdapter,
        // Editor↔view keyboard navigation bridge. The table/list register the
        // cell navigation; the gallery, the card one (handleShellKeyDown uses it to
        // descend into it with Space/Enter). `onFocusShell` returns focus to the shell
        // (Esc from the gallery records).
        registerNavApi: (api) => { tableNavApiRef.current = api; },
        onExitTop: () => ctx.exitEmbedToEditor?.(block?.id, 'up'),
        onExitBottom: () => ctx.exitEmbedToEditor?.(block?.id, 'down'),
        onEscape: () => ctx.exitEmbedToEditor?.(block?.id, 'escape'),
        onFocusShell: focusShell,
    };
    const renderBody = () => {
        // The `graph` has no equivalent editable component → bespoke render.
        if (viewType === 'graph') return <GraphRender {...commonProps} />;
        // The rest of the types are delegated to the shared body (VaultViewBody), which
        // same one used by the full table. The table/list use a
        // container that lets it do the internal scroll (sticky column); the
        // for the rest, a box with its own scroll.
        const Box = (viewType === 'table' || viewType === 'list') ? TableBox
            : (viewType === 'feed') ? FeedFlowBox
            : ScrollBox;
        return (
            <Box>
                <VaultViewBody
                    type={viewType}
                    {...sharedViewProps}
                    templates={templates}
                    isEmbedded={true}
                    onOpenParallel={ctx.onOpenParallel}
                    onCellSaved={() => reload()}
                    onTranslated={() => reload()}
                    onUpdateFieldOptions={ctx.onAddSchemaOption}
                    onUpdateNote={onUpdateNoteAdapter}
                    actionRules={table?.action_rules}
                />
            </Box>
        );
    };

    return (
        // `min-w-0 w-full`: the block's container (.bn-block-content) is flex;
        // without `min-w-0` this div doesn't shrink below the content's width
        // (wide table) and overflows the editor with horizontal scroll on the page.
        <div
            ref={embedContainerRef}
            tabIndex={isInEditor ? -1 : undefined}
            onKeyDown={isInEditor ? handleShellKeyDown : undefined}
            className="mt-0 mb-4 min-w-0 w-full gnosi-view-embed-container rounded-lg outline-none focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/40"
        >
            <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-baseline gap-2 min-w-0">
                    {displayHeading && <Heading level={displayLevel}>{displayHeading}</Heading>}
                    <span className="text-[11px] text-[var(--text-tertiary)] font-medium whitespace-nowrap">
                        {t('views_header.records_count', { count: rows.length })}
                    </span>
                </div>
                <ViewActionsBar
                    onCreate={tableId ? handleCreate : null}
                    templates={templates}
                    onOpenConfig={onOpenPageViewModal && tableId ? handleOpenConfig : null}
                    searchTerm={searchTerm}
                    setSearchTerm={setSearchTerm}
                    showSearch={showSearch}
                    setShowSearch={setShowSearch}
                />
            </div>
            {/* Tabs of views for THIS block: the section's view (anchor)
                + those that have been explicitly pinned to it. Not all the
                table's views are shown. The bar uses `flex-wrap` (not `overflow`) so as
                not to clip the × and + dropdowns. */}
            {(() => {
                const visibleTabs = tableViews.filter(v => v.id === viewId || pinnedViewIds.has(v.id));
                const unpinnedExisting = tableViews.filter(v => v.id !== viewId && !pinnedViewIds.has(v.id));
                if (visibleTabs.length === 0) return null;
                return (
                <div className="relative z-30 flex flex-wrap items-center gap-0.5 border-b border-[var(--border-primary)] mb-2">
                    {visibleTabs.map(v => {
                        const isActive = v.id === activeViewId;
                        const isAnchor = v.id === viewId; // section's view (cannot be removed)
                        return (
                            <div
                                key={v.id}
                                className={`group relative flex items-center gap-1 px-2.5 py-1 text-xs whitespace-nowrap border-b-2 cursor-pointer ${isActive ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)] font-semibold' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                                onClick={() => {
                                    setActiveViewId(v.id);
                                    try { localStorage.setItem(`gnosi_embed_view_${pageId}_${viewId}`, v.id); } catch { /* noop */ }
                                }}
                                onDoubleClick={() => handleRenameView(v)}
                                title={t('views_header.tab_tooltip', "Click to switch · double-click to rename")}
                            >
                                <span>{v.name || v.heading || t('views_header.default_view_name', "View")}</span>
                                <button
                                    onClick={(e) => { e.stopPropagation(); decideMenuDir(e); setTabMenuFor(m => m === v.id ? null : v.id); }}
                                    className={`${tabMenuFor === v.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} text-[var(--text-tertiary)] hover:text-[var(--text-primary)]`}
                                    title={t('views_header.view_options', "View options")}
                                >
                                    <MoreHorizontal size={13} />
                                </button>
                                {tabMenuFor === v.id && (
                                    <>
                                        <div className="fixed inset-0 z-[55]" onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); }} />
                                        <div className={`absolute z-[60] left-0 ${menuUp ? "bottom-full mb-1" : "top-full mt-1"} w-56 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg py-1 text-[var(--text-primary)] font-normal`}>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); handleConfigureView(v); }}
                                                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]"
                                            >
                                                <Settings size={13} className="text-[var(--text-tertiary)]" />
                                                {t('views_header.configure', "Configure")}
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); handleRenameView(v); }}
                                                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]"
                                            >
                                                <Edit2 size={13} className="text-[var(--text-tertiary)]" />
                                                {t('views_header.rename', "Rename")}
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); handleDuplicateView(v); }}
                                                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]"
                                            >
                                                <Copy size={13} className="text-[var(--text-tertiary)]" />
                                                {t('views_header.duplicate', "Duplicate")}
                                            </button>
                                            {!isAnchor && (
                                                <>
                                                    <div className="h-px bg-[var(--border-primary)] my-1 mx-2" />
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); handleUnpinView(v); }}
                                                        className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]"
                                                    >
                                                        <X size={13} className="text-[var(--text-tertiary)]" />
                                                        {t('views_header.remove_from_page', "Remove from this page")}
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); handleDeleteView(v); }}
                                                        className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-red-500 hover:bg-[var(--bg-tertiary)]"
                                                    >
                                                        <Trash2 size={13} />
                                                        {t('views_header.delete_everywhere', "Delete everywhere…")}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        );
                    })}
                    <button
                        onClick={() => handleAddView('table')}
                        className="px-1.5 py-1 text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]"
                        title={t('views_header.add_view', "Add view")}
                    >
                        <Plus size={13} />
                    </button>
                </div>
                );
            })()}
            {renderBody()}
            <ConfirmModal
                isOpen={confirmDeleteView != null}
                onClose={() => setConfirmDeleteView(null)}
                onConfirm={doDeleteView}
                title={t('views_header.delete_view_title', "Delete view")}
                message={confirmDeleteView ? t('views_header.delete_view_confirm', "Delete the view \"{{name}}\" EVERYWHERE? It will disappear from all pages.", { name: confirmDeleteView.name || confirmDeleteView.heading || '' }) : ''}
                confirmText={t('common.delete', "Delete")}
                cancelText={t('common.cancel', "Cancel")}
                isDestructive
            />
            <PromptModal
                isOpen={renameView != null}
                onClose={() => setRenameView(null)}
                onSubmit={doRename}
                title={t('views_header.rename_view_title', "Rename view")}
                label={t('views_header.new_view_name_label', "New view name")}
                defaultValue={renameView ? (renameView.name || renameView.heading || '') : ''}
                confirmText={t('common.rename', "Rename")}
                cancelText={t('common.cancel', "Cancel")}
            />
        </div>
    );
}
