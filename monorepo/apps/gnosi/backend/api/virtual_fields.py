"""
Virtual fields: derived properties computed by the backend at read-time.

A property declared on a table with `{"type": "virtual", "compute": "<name>"}`
is filled in by the backend before pages are returned. Values are read-only and
derived from indexes already cached in memory (graph, backlinks, etc.).

To add a new computer:
  1. Implement a function `_compute_<name>(page_id: str, ctx: dict) -> Any`.
  2. Register it in `VIRTUAL_COMPUTERS` below with a stable key and metadata.
  3. The frontend will see it via GET /api/vault/virtual-fields and offer it
     in the schema config modal.

The `ctx` dict is built once per request and shared across all pages, so each
computer must be O(1) given the precomputed indexes.
"""

from __future__ import annotations

import json
import logging
import time
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional

log = logging.getLogger(__name__)


# ── Cache del graf (evita rellegir vault_graph.json a cada request) ──────────

# Caus PER-VAULT (clau = ruta del graf, que depèn del vault actiu). Abans eren globals → en
# multi-vault un vault servia el graf d'un altre.
_graph_cache: Dict[str, Dict[str, Any]] = {}       # graph_path_str -> data
_graph_cache_mtime: Dict[str, float] = {}          # graph_path_str -> mtime
_graph_cache_ts: Dict[str, float] = {}             # graph_path_str -> monotonic ts
_GRAPH_TTL_SECONDS = 60  # in-memory TTL
import threading
_graph_cache_lock = threading.Lock()


def _load_graph(graph_path: Path) -> Dict[str, Any]:
    """Loads vault_graph.json with TTL cache and stale-cache fallback (PER-VAULT).

    Thread-safe: el lock evita que dos requests concurrents llegeixin el JSON
    en paral·lel quan el cache expira (estalvia I/O redundant a OneDrive).
    """
    global _graph_cache, _graph_cache_mtime, _graph_cache_ts
    empty = {"nodes": [], "edges": []}
    if not graph_path:
        return empty
    key = str(graph_path)

    # Fast-path sense lock (lectura atòmica de referències a Python amb GIL)
    now = time.monotonic()
    cached = _graph_cache.get(key)
    if cached is not None and (now - _graph_cache_ts.get(key, 0.0)) < _GRAPH_TTL_SECONDS:
        return cached

    with _graph_cache_lock:
        now = time.monotonic()
        cached = _graph_cache.get(key)
        if cached is not None and (now - _graph_cache_ts.get(key, 0.0)) < _GRAPH_TTL_SECONDS:
            return cached

        if not graph_path.exists():
            return cached if cached is not None else empty

        try:
            mtime = graph_path.stat().st_mtime
            if cached is not None and mtime <= _graph_cache_mtime.get(key, 0.0):
                _graph_cache_ts[key] = now
                return cached
        except Exception as e:
            if cached is not None:
                log.warning(f"⚠️ virtual_fields: graph stat failed ({e}); serving stale cache")
                return cached
            return empty

        try:
            data = json.loads(graph_path.read_text(encoding="utf-8"))
            _graph_cache[key] = data
            _graph_cache_ts[key] = now
            try:
                _graph_cache_mtime[key] = graph_path.stat().st_mtime
            except Exception:
                pass
            return data
        except Exception as e:
            log.error(f"❌ virtual_fields: failed to load graph: {e}")
            return cached if cached is not None else empty


def _build_degree_index(graph: Dict[str, Any]) -> Dict[str, Dict[str, int]]:
    """Returns {page_id: {'in': N, 'out': N, 'total': N}} from graph edges.

    Tag-pseudo-nodes (keys like 'tag::xxx') are excluded from in/out counts.
    """
    in_deg: Dict[str, int] = defaultdict(int)
    out_deg: Dict[str, int] = defaultdict(int)
    for e in graph.get("edges", []):
        s = e.get("source") or ""
        t = e.get("target") or ""
        if not s or not t:
            continue
        if not s.startswith("tag::"):
            out_deg[s] += 1
        if not t.startswith("tag::"):
            in_deg[t] += 1
    all_ids = set(in_deg) | set(out_deg)
    return {
        nid: {
            "in": in_deg.get(nid, 0),
            "out": out_deg.get(nid, 0),
            "total": in_deg.get(nid, 0) + out_deg.get(nid, 0),
        }
        for nid in all_ids
    }


# ── NetworkX-based computations (lazy + cached per request) ──────────────────

_nx_cache: Dict[str, Any] = {}
_nx_cache_graph_id: int = 0  # id(graph_dict) of the cached graph object


def _ensure_nx_cache_fresh(graph: Dict[str, Any]) -> None:
    """Invalida _nx_cache si el graf de fons ha canviat.

    Abans aquesta lògica només s'executava dins _get_nx_graph, però els
    `_get_*` (betweenness, pagerank, etc.) feien `if 'metric' in _nx_cache`
    ABANS de cridar `_get_nx_graph` → quan el graf es recarregava (TTL de
    60s o mtime), retornaven mètriques caducades fins que algú demanava
    explícitament `_get_nx_graph`. Ara cada `_get_*` invalida primer.
    """
    global _nx_cache, _nx_cache_graph_id
    gid = id(graph)
    if _nx_cache_graph_id != gid:
        _nx_cache = {}
        _nx_cache_graph_id = gid


def _get_nx_graph(graph: Dict[str, Any]):
    """Returns an undirected NetworkX graph from the JSON, excluding tag pseudo-nodes.

    Cached based on the graph dict identity (rebuilt only if the underlying graph
    cache reloaded a fresh object).
    """
    import networkx as nx
    _ensure_nx_cache_fresh(graph)
    if _nx_cache.get("nx") is not None:
        return _nx_cache["nx"]
    G = nx.Graph()
    for n in graph.get("nodes", []):
        nid = n.get("key") or n.get("id")
        if nid and not str(nid).startswith("tag::"):
            G.add_node(nid)
    for e in graph.get("edges", []):
        s = e.get("source") or ""
        t = e.get("target") or ""
        if not s or not t:
            continue
        if str(s).startswith("tag::") or str(t).startswith("tag::"):
            continue
        G.add_edge(s, t)
    _nx_cache["nx"] = G
    return G


def _get_betweenness(graph: Dict[str, Any]) -> Dict[str, float]:
    _ensure_nx_cache_fresh(graph)
    if "betweenness" in _nx_cache:
        return _nx_cache["betweenness"]
    import networkx as nx
    try:
        G = _get_nx_graph(graph)
        # k=None means exact; for our size (~850 nodes) it runs in <1s.
        bc = nx.betweenness_centrality(G, normalized=True)
    except Exception as e:
        log.warning(f"betweenness failed: {e}")
        bc = {}
    _nx_cache["betweenness"] = bc
    return bc


def _get_pagerank(graph: Dict[str, Any]) -> Dict[str, float]:
    _ensure_nx_cache_fresh(graph)
    if "pagerank" in _nx_cache:
        return _nx_cache["pagerank"]
    import networkx as nx
    try:
        G = _get_nx_graph(graph)
        pr = nx.pagerank(G, alpha=0.85, max_iter=100, tol=1e-6)
    except Exception as e:
        log.warning(f"pagerank failed: {e}")
        pr = {}
    _nx_cache["pagerank"] = pr
    return pr


def _get_eigenvector(graph: Dict[str, Any]) -> Dict[str, float]:
    _ensure_nx_cache_fresh(graph)
    if "eigenvector" in _nx_cache:
        return _nx_cache["eigenvector"]
    import networkx as nx
    try:
        G = _get_nx_graph(graph)
        ec = nx.eigenvector_centrality_numpy(G)
    except Exception as e:
        # Fallback to power iteration if numpy/scipy missing
        try:
            ec = nx.eigenvector_centrality(G, max_iter=500, tol=1e-6)
        except Exception as e2:
            log.warning(f"eigenvector failed: {e}; fallback failed: {e2}")
            ec = {}
    _nx_cache["eigenvector"] = ec
    return ec


def _get_closeness(graph: Dict[str, Any]) -> Dict[str, float]:
    _ensure_nx_cache_fresh(graph)
    if "closeness" in _nx_cache:
        return _nx_cache["closeness"]
    import networkx as nx
    try:
        G = _get_nx_graph(graph)
        cc = nx.closeness_centrality(G)
    except Exception as e:
        log.warning(f"closeness failed: {e}")
        cc = {}
    _nx_cache["closeness"] = cc
    return cc


def _get_clustering(graph: Dict[str, Any]) -> Dict[str, float]:
    _ensure_nx_cache_fresh(graph)
    if "clustering" in _nx_cache:
        return _nx_cache["clustering"]
    import networkx as nx
    try:
        G = _get_nx_graph(graph)
        cl = nx.clustering(G)
    except Exception as e:
        log.warning(f"clustering failed: {e}")
        cl = {}
    _nx_cache["clustering"] = cl
    return cl


# ── Computers ────────────────────────────────────────────────────────────────

def _compute_degree_centrality(page_id: str, ctx: Dict[str, Any]) -> int:
    """Total connections (in + out edges) involving this page."""
    return ctx["degrees"].get(page_id, {}).get("total", 0)


def _compute_in_degree(page_id: str, ctx: Dict[str, Any]) -> int:
    """Number of pages linking TO this page."""
    return ctx["degrees"].get(page_id, {}).get("in", 0)


def _compute_out_degree(page_id: str, ctx: Dict[str, Any]) -> int:
    """Number of pages linked FROM this page."""
    return ctx["degrees"].get(page_id, {}).get("out", 0)


def _round4(x: float) -> float:
    try:
        return round(float(x), 4)
    except Exception:
        return 0.0


def _compute_betweenness(page_id: str, ctx: Dict[str, Any]) -> float:
    """Fraction of shortest paths in the graph that pass through this page."""
    return _round4(ctx["betweenness"].get(page_id, 0.0))


def _compute_pagerank(page_id: str, ctx: Dict[str, Any]) -> float:
    """PageRank score (importance weighted by neighbours' importance)."""
    return _round4(ctx["pagerank"].get(page_id, 0.0))


def _compute_eigenvector(page_id: str, ctx: Dict[str, Any]) -> float:
    """Eigenvector centrality (mutual reinforcement of important nodes)."""
    return _round4(ctx["eigenvector"].get(page_id, 0.0))


def _compute_closeness(page_id: str, ctx: Dict[str, Any]) -> float:
    """Closeness centrality (how short the paths to all other nodes are)."""
    return _round4(ctx["closeness"].get(page_id, 0.0))


def _compute_clustering(page_id: str, ctx: Dict[str, Any]) -> float:
    """Local clustering coefficient (cohesion of this node's neighbourhood)."""
    return _round4(ctx["clustering"].get(page_id, 0.0))


def _compute_is_hub(page_id: str, ctx: Dict[str, Any]) -> bool:
    """Boolean: whether this page sits in the top decile of degree centrality."""
    threshold = ctx.get("hub_threshold", 0)
    deg = ctx["degrees"].get(page_id, {}).get("total", 0)
    return deg >= threshold and deg > 0


def _compute_is_orphan(page_id: str, ctx: Dict[str, Any]) -> bool:
    """Boolean: whether this page has zero connections in the graph."""
    return ctx["degrees"].get(page_id, {}).get("total", 0) == 0


# ── Rollup invers: progrés de tasques ────────────────────────────────────────
# A diferència dels computers de graf, aquest deriva d'una ALTRA taula (Tasques)
# i de la seva relació INVERSA cap a aquest registre. L'índex es construeix a
# `inject_for_*` (que té el `page_loader`) i es deixa al ctx; el computer és O(1).

def _clean_relation_id(token: Any) -> str:
    """Normalitza un valor de relació a id net. El backend ja despulla els
    wikilinks (ids nets), però defensem el cas Obsidian manual `[[Títol|uuid]]`.
    """
    if token is None:
        return ""
    s = str(token).strip()
    if s.startswith("[[") and s.endswith("]]"):
        s = s[2:-2]
    if "|" in s:  # "Títol|uuid" → uuid
        s = s.split("|")[-1]
    return s.strip()


def build_task_progress_index(
    task_pages: Iterable[Any],
    relation_field: str,
    status_field: str,
    done_value: str,
    id_resolver: Optional[Callable[[str], Optional[str]]] = None,
) -> Dict[str, Optional[int]]:
    """Índex {project_id: pct 0-100 | None} a partir de les pàgines de Tasques.

    Agrupa per cada id del camp `relation_field` (p. ex. "Projecte") i compta
    `status_field == done_value` sobre el total. `None` si el projecte no té cap
    tasca (mai apareix a l'índex → la cel·la queda buida). `id_resolver` mapeja
    un títol → id (defensa per enllaços manuals); si retorna None, s'usa el token.
    """
    totals: Dict[str, int] = defaultdict(int)
    done: Dict[str, int] = defaultdict(int)
    done_norm = str(done_value).strip().casefold()

    for page in task_pages:
        md = getattr(page, "metadata", None)
        if md is None and isinstance(page, dict):
            md = page.get("metadata") or page
        if not isinstance(md, dict):
            continue
        rel = md.get(relation_field)
        if not rel:
            continue
        ids = rel if isinstance(rel, list) else [rel]
        is_done = str(md.get(status_field) or "").strip().casefold() == done_norm
        for tok in ids:
            key = _clean_relation_id(tok)
            if not key:
                continue
            if id_resolver:
                key = id_resolver(key) or key
            totals[key] += 1
            if is_done:
                done[key] += 1

    return {
        pid: (round(done[pid] * 100 / total) if total else None)
        for pid, total in totals.items()
    }


def _compute_task_progress(page_id: str, ctx: Dict[str, Any]) -> Optional[int]:
    """% de tasques relacionades completades (0-100) o None si no en té cap."""
    return (ctx.get("task_progress") or {}).get(page_id)


# Cache TTL de l'índex per source_table_id: el `page_loader` ja està cachejat,
# però `refresh_view_snapshots` crida `inject_for_single_page` per pàgina; sense
# aquest cache l'índex es reconstruiria N vegades en un mateix burst.
_task_progress_cache: Dict[str, "tuple[float, Dict[str, Optional[int]]]"] = {}
_TASK_PROGRESS_TTL_SECONDS = 2.0
_task_progress_lock = threading.Lock()


def _task_progress_index_for(
    prop: Dict[str, Any],
    page_loader: Optional[Callable[[str], List[Any]]],
    id_resolver: Optional[Callable[[str], Optional[str]]] = None,
) -> Dict[str, Optional[int]]:
    """Construeix (o recupera del cache TTL) l'índex de progrés per a un vprop
    `task_progress`, llegint la config del camp i carregant les Tasques via
    `page_loader`. Sense provider o sense `source_table_id` → índex buit."""
    cfg = prop.get("config") or {}
    src = cfg.get("source_table_id")
    if not src or page_loader is None:
        return {}
    rel = cfg.get("relation_field") or "Projecte"
    status_field = cfg.get("status_field") or "Estat"
    done_value = cfg.get("done_value") or "Fet"

    now = time.monotonic()
    with _task_progress_lock:
        cached = _task_progress_cache.get(src)
        if cached and (now - cached[0]) < _TASK_PROGRESS_TTL_SECONDS:
            return cached[1]
    try:
        task_pages = page_loader(src) or []
    except Exception as e:
        log.debug(f"task_progress page_loader failed for {src}: {e}")
        return {}
    idx = build_task_progress_index(task_pages, rel, status_field, done_value, id_resolver)
    with _task_progress_lock:
        _task_progress_cache[src] = (now, idx)
    return idx


VIRTUAL_COMPUTERS: Dict[str, Dict[str, Any]] = {
    "degree_centrality": {
        "fn": _compute_degree_centrality,
        "label": "Centralitat de grau",
        "description": (
            "Suma d'enllaços entrants i sortints. Mètrica simple i intuïtiva: "
            "quants altres conceptes es relacionen amb aquesta nota. Útil per "
            "identificar nuclis temàtics i candidats a Maps of Content (MOC)."
        ),
        "value_type": "number",
        "needs": ["graph"],
    },
    "in_degree": {
        "fn": _compute_in_degree,
        "label": "Enllaços entrants",
        "description": (
            "Quantes pàgines enllacen cap a aquesta. Indica influència o "
            "rellevància com a referent — semblant als backlinks d'Obsidian. "
            "Útil per detectar notes estructurals citades sovint."
        ),
        "value_type": "number",
        "needs": ["graph"],
    },
    "out_degree": {
        "fn": _compute_out_degree,
        "label": "Enllaços sortints",
        "description": (
            "Quantes pàgines enllaça aquesta. Indica el grau d'integració amb "
            "la resta del coneixement: notes amb out_degree=0 estan 'aïllades' "
            "i probablement requereixen revisió."
        ),
        "value_type": "number",
        "needs": ["graph"],
    },
    "betweenness_centrality": {
        "fn": _compute_betweenness,
        "label": "Betweenness (intermediació)",
        "description": (
            "Fracció dels camins més curts del graf que passen per aquesta nota. "
            "Detecta 'ponts' entre dominis temàtics: notes que connecten àrees "
            "que altrament no es tocarien (p. ex. una nota d'ètica que enllaça "
            "filosofia i economia). Valors alts → nodes pivot estratègics."
        ),
        "value_type": "number",
        "needs": ["graph", "nx"],
    },
    "pagerank": {
        "fn": _compute_pagerank,
        "label": "PageRank",
        "description": (
            "Importància recursiva: una nota és rellevant si la citen notes "
            "rellevants (la idea darrere de l'algorisme de Google). "
            "Mostra els 'pesos pesants' del teu vault tenint en compte qui els "
            "cita, no només quants. Sumat a tots els nodes = 1.0."
        ),
        "value_type": "number",
        "needs": ["graph", "nx"],
    },
    "eigenvector_centrality": {
        "fn": _compute_eigenvector,
        "label": "Eigenvector",
        "description": (
            "Variant més pura del PageRank: la teva importància depèn de la "
            "importància dels teus veïns. Útil per trobar les notes 'reines' "
            "d'una comunitat — les que estan envoltades de les notes més "
            "centrals d'aquell domini."
        ),
        "value_type": "number",
        "needs": ["graph", "nx"],
    },
    "closeness_centrality": {
        "fn": _compute_closeness,
        "label": "Closeness (proximitat)",
        "description": (
            "Inversa de la distància mitjana a la resta de notes. Valor alt → "
            "es pot arribar fàcilment a qualsevol altra part del coneixement "
            "des d'aquesta nota. Indicador de 'punt d'entrada' al vault."
        ),
        "value_type": "number",
        "needs": ["graph", "nx"],
    },
    "clustering_coefficient": {
        "fn": _compute_clustering,
        "label": "Coeficient de clustering",
        "description": (
            "Mesura quant de cohesionat està el veïnat d'aquesta nota: si els "
            "seus veïns també estan connectats entre ells (1.0 = tots; 0 = cap). "
            "Notes amb clustering alt formen comunitats temàtiques denses."
        ),
        "value_type": "number",
        "needs": ["graph", "nx"],
    },
    "is_hub": {
        "fn": _compute_is_hub,
        "label": "És un hub?",
        "description": (
            "Booleà: la nota està al 10% més connectat del vault? Filtre ràpid "
            "per llistar només els nodes estructurals d'una vista de taula."
        ),
        "value_type": "checkbox",
        "needs": ["graph", "hubs"],
    },
    "is_orphan": {
        "fn": _compute_is_orphan,
        "label": "És òrfena?",
        "description": (
            "Booleà: la nota no té cap enllaç (entrant ni sortint). Senyal "
            "que cal integrar-la al graf — probablement falta enllaçar-la "
            "amb conceptes existents."
        ),
        "value_type": "checkbox",
        "needs": ["graph"],
    },
    "task_progress": {
        "fn": _compute_task_progress,
        "label": "Progrés de tasques",
        "description": (
            "Percentatge (0-100) de tasques relacionades completades. Es deriva "
            "de la relació INVERSA d'una taula font (config: source_table_id, "
            "relation_field, status_field, done_value): compta status==done sobre "
            "el total de registres que apunten a aquesta pàgina. Buit si no en té "
            "cap. Read-only, calculat en llegir (sempre fresc)."
        ),
        "value_type": "number",
        "needs": ["task_progress"],
    },
}


def list_virtual_field_specs() -> List[Dict[str, Any]]:
    """Public catalogue used by the frontend schema config modal."""
    return [
        {
            "compute": key,
            "label": meta.get("label", key),
            "description": meta.get("description", ""),
            "value_type": meta.get("value_type", "string"),
        }
        for key, meta in VIRTUAL_COMPUTERS.items()
    ]


# ── Context building & injection ─────────────────────────────────────────────

def _build_ctx(needs: Iterable[str], graph_path: Optional[Path]) -> Dict[str, Any]:
    """Builds the shared computation context based on which indexes are needed.

    Each index is computed at most once per request and shared across all pages
    and all virtual properties. NetworkX-based metrics are only computed when
    a property explicitly declares "nx" in its `needs`.
    """
    ctx: Dict[str, Any] = {}
    needs_set = set(needs)
    if not needs_set or graph_path is None:
        return ctx
    graph = _load_graph(graph_path)
    if "graph" in needs_set:
        ctx["degrees"] = _build_degree_index(graph)
    if "nx" in needs_set:
        # Compute only the NetworkX metrics that are actually needed by visible props.
        # The cache inside each _get_* function avoids recomputation across requests
        # while the graph dict identity stays the same (cleared when graph reloads).
        if "betweenness_centrality" in needs_set:
            ctx["betweenness"] = _get_betweenness(graph)
        if "pagerank" in needs_set:
            ctx["pagerank"] = _get_pagerank(graph)
        if "eigenvector_centrality" in needs_set:
            ctx["eigenvector"] = _get_eigenvector(graph)
        if "closeness_centrality" in needs_set:
            ctx["closeness"] = _get_closeness(graph)
        if "clustering_coefficient" in needs_set:
            ctx["clustering"] = _get_clustering(graph)
    if "hubs" in needs_set:
        # Hub threshold = 90th percentile of degree centrality
        degrees = ctx.get("degrees") or _build_degree_index(graph)
        ctx["degrees"] = degrees
        totals = sorted([d["total"] for d in degrees.values() if d["total"] > 0])
        if totals:
            idx = max(0, int(len(totals) * 0.9) - 1)
            ctx["hub_threshold"] = totals[idx]
        else:
            ctx["hub_threshold"] = 0
    return ctx


def _virtual_props_of(table: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Returns the list of virtual property dicts declared on a table."""
    return [p for p in (table.get("properties") or []) if p.get("type") == "virtual"]


def _frontmatter_key(prop_name: str) -> str:
    """Identity: the frontmatter key IS the canonical property `name` from the
    registry. No slug, no transformation.

    Single source of truth = vault_db_registry.json. Mirrors
    import_from_export.normalize_key (identity) and
    sync_sections.property_name_to_frontmatter_key (identity). If we slug here
    while the importer uses canonical names, virtual fields get written to a
    key that doesn't exist in the YAML schema → either invisible or shows up
    as a duplicate "ad-hoc" property next to the canonical one.
    """
    return str(prop_name)


def inject_for_table(
    table: Optional[Dict[str, Any]],
    pages: List[Any],
    graph_path: Optional[Path] = None,
    page_loader: Optional[Callable[[str], List[Any]]] = None,
    id_resolver: Optional[Callable[[str], Optional[str]]] = None,
) -> None:
    """In-place inject virtual fields into each page's metadata.

    `pages` is an iterable of objects with `.id` and `.metadata` (dict). Works
    for both PageInfo Pydantic models and plain dicts that already exposed metadata.
    Mutates `metadata` directly. Silent on errors per page.

    `page_loader(table_id) -> list[pages]` permet als computers de rollup invers
    (p. ex. `task_progress`) carregar les pàgines d'una ALTRA taula font.
    """
    if not table:
        return
    vprops = _virtual_props_of(table)
    if not vprops:
        return

    needs: set = set()
    for p in vprops:
        comp_key = p.get("compute") or ""
        meta = VIRTUAL_COMPUTERS.get(comp_key)
        if meta:
            needs.update(meta.get("needs", []))
            # Add the compute key itself so _build_ctx can decide which NX
            # metric to run (avoids computing all when only one is requested).
            needs.add(comp_key)
    ctx = _build_ctx(needs, graph_path)
    _inject_task_progress_into_ctx(ctx, vprops, page_loader, id_resolver)

    for page in pages:
        try:
            pid = getattr(page, "id", None) or (page.get("id") if isinstance(page, dict) else None)
            md = getattr(page, "metadata", None)
            if md is None and isinstance(page, dict):
                md = page.setdefault("metadata", {})
            if not pid or md is None:
                continue
            for prop in vprops:
                comp_key = prop.get("compute") or ""
                comp = VIRTUAL_COMPUTERS.get(comp_key)
                if not comp:
                    continue
                fm_key = _frontmatter_key(prop.get("name", comp_key))
                try:
                    md[fm_key] = comp["fn"](pid, ctx)
                except Exception as e:
                    log.debug(f"virtual_fields compute {comp_key} failed for {pid}: {e}")
        except Exception as e:
            log.debug(f"virtual_fields injection failed for one page: {e}")


def _inject_task_progress_into_ctx(
    ctx: Dict[str, Any],
    vprops: List[Dict[str, Any]],
    page_loader: Optional[Callable[[str], List[Any]]],
    id_resolver: Optional[Callable[[str], Optional[str]]],
) -> None:
    """Si hi ha un vprop `task_progress`, construeix el seu índex (cachejat per
    source_table_id) i el deixa a `ctx["task_progress"]`. Assumeix un sol camp
    d'aquest tipus per taula (cas actual: «Progrés»)."""
    for prop in vprops:
        if (prop.get("compute") or "") == "task_progress":
            ctx["task_progress"] = _task_progress_index_for(prop, page_loader, id_resolver)
            return


def inject_for_single_page(
    table: Optional[Dict[str, Any]],
    page_id: str,
    metadata: Dict[str, Any],
    graph_path: Optional[Path] = None,
    page_loader: Optional[Callable[[str], List[Any]]] = None,
    id_resolver: Optional[Callable[[str], Optional[str]]] = None,
) -> None:
    """In-place inject virtual fields for a single page metadata dict."""
    if not table:
        return
    vprops = _virtual_props_of(table)
    if not vprops:
        return

    needs: set = set()
    for p in vprops:
        comp_key = p.get("compute") or ""
        meta = VIRTUAL_COMPUTERS.get(comp_key)
        if meta:
            needs.update(meta.get("needs", []))
            # Add the compute key itself so _build_ctx can decide which NX
            # metric to run (avoids computing all when only one is requested).
            needs.add(comp_key)
    ctx = _build_ctx(needs, graph_path)
    _inject_task_progress_into_ctx(ctx, vprops, page_loader, id_resolver)

    for prop in vprops:
        comp_key = prop.get("compute") or ""
        comp = VIRTUAL_COMPUTERS.get(comp_key)
        if not comp:
            continue
        fm_key = _frontmatter_key(prop.get("name", comp_key))
        try:
            metadata[fm_key] = comp["fn"](page_id, ctx)
        except Exception as e:
            log.debug(f"virtual_fields compute {comp_key} failed for {page_id}: {e}")
