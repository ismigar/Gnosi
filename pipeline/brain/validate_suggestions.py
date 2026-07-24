#!/usr/bin/env python3
# validate_suggestions.py
import json, re, argparse, os
from backend.config.logger_config import get_logger
from backend.config.app_config import load_params

cfg = load_params(strict_env=False) 
log = get_logger(__name__)

UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
OUT_JSON = cfg.paths["OUT_JSON"]

def is_uuid(x: str) -> bool:
    if not isinstance(x, str):
        return False
    if x.startswith("tag::"):
        return True
    return bool(UUID_RE.match(x))

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(data, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path)

def validate_legacy(mapping, min_sim=0):
    """
        Old format: { "SRC_UUID": [ {"target_id": UUID, "score": 0..1 or 0..100, "similarity": 0..100, ...}, ... ] }
    Returns the same format, cleaned.
    
    """
    out = {}
    stats = dict(
        total_sources=0, valid_sources=0,
        total_targets=0, valid_targets=0,
        removed_selfloops=0, removed_invalid_ids=0
    )

    for src, lst in (mapping or {}).items():
        stats["total_sources"] += 1
        if not is_uuid(src):
            continue
        stats["valid_sources"] += 1

        fixed = []
        for item in (lst or []):
            stats["total_targets"] += 1
            tgt = item.get("target_id")
            if not is_uuid(tgt):
                stats["removed_invalid_ids"] += 1
                continue
            if tgt == src:
                stats["removed_selfloops"] += 1
                continue

            # normalizes similarity
            sim = item.get("similarity")
            score = item.get("score")
            if sim is None:
                if score is not None:
                    try:
                        sv = float(score)
                        sim = int(round(sv*100)) if sv <= 1 else int(round(sv))
                    except:
                        sim = 0
                else:
                    sim = 0
            if sim < min_sim:
                continue

            item["similarity"] = int(sim)
            fixed.append(item)

        if fixed:
            out[src] = fixed
    stats["valid_targets"] = sum(len(v) for v in out.values())
    return out, stats

def merge_edge(a, b):
    """Merges two edges (same pair), keeping the maximum similarity and the union of evidence/reasons."""
    out = dict(a)
    # similarity → maximum
    sa = a.get("similarity"); sb = b.get("similarity")
    if isinstance(sa, (int, float)) or isinstance(sb, (int, float)):
        out["similarity"] = max(sa or 0, sb or 0)
    # score → maximum if present
    if isinstance(a.get("score"), (int, float)) or isinstance(b.get("score"), (int, float)):
        out["score"] = max(a.get("score") or 0, b.get("score") or 0)
    # evidence → union
    ev = set()
    for e in (a.get("evidence"), b.get("evidence")):
        if isinstance(e, list): ev.update(e)
        elif isinstance(e, str): ev.add(e)
    out["evidence"] = sorted(ev) if ev else out.get("evidence", [])
    # reasons → unique
    rs = []
    for rlist in (a.get("reasons"), b.get("reasons")):
        if isinstance(rlist, list):
            for r in rlist:
                if r and r not in rs:
                    rs.append(r)
        elif isinstance(rlist, str) and rlist and rlist not in rs:
            rs.append(rlist)
    if rs:
        out["reasons"] = rs
    return out

def validate_graph(graph, min_sim=0, dedup=True):
    """
        Current format: {"nodes":[...], "edges":[...]}
    Returns the same format, cleaned and, optionally, deduplicated.
    
    """
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []

    stats = dict(
        total_nodes=len(nodes), valid_nodes=0,
        total_edges=len(edges), kept_edges=0,
        removed_selfloops=0, removed_invalid_ids=0, removed_low_sim=0, dedup_merged=0
    )

    # Filters nodes with a valid UUID
    valid_nodes = []
    node_ids = set()
    for n in nodes:
        nid = n.get("id")
        if is_uuid(nid):
            valid_nodes.append(n)
            node_ids.add(nid)
    stats["valid_nodes"] = len(valid_nodes)

    # Normalize and filter edges.
    cleaned = []
    for e in edges:
        s = e.get("source"); t = e.get("target")
        if not (is_uuid(s) and is_uuid(t)):
            stats["removed_invalid_ids"] += 1
            continue
        if s not in node_ids or t not in node_ids:
            stats["removed_invalid_ids"] += 1
            continue
        if s == t:
            stats["removed_selfloops"] += 1
            continue

        sim = e.get("similarity")
        if sim is None:
            # tries to derive from score
            sc = e.get("score")
            if isinstance(sc, (int, float)):
                sim = int(round(sc*100)) if sc <= 1 else int(round(sc))
            else:
                sim = 0
        try:
            sim = int(sim)
        except:
            sim = 0

        if sim < min_sim:
            stats["removed_low_sim"] += 1
            continue

        # Normalizes minimal fields
        ne = dict(e)
        ne["similarity"] = sim
        # Ensure common field types
        ne["dashes"] = bool(ne.get("dashes", False))
        if isinstance(ne.get("evidence"), str):
            ne["evidence"] = [ne["evidence"]]
        cleaned.append(ne)

    # Deduplication (undirected): key = (min(s,t), max(s,t))
    if dedup:
        merged = {}
        for e in cleaned:
            s, t = e["source"], e["target"]
            key = (s, t) if s < t else (t, s)
            if key in merged:
                merged[key] = merge_edge(merged[key], e)
                stats["dedup_merged"] += 1
            else:
                merged[key] = e
        cleaned = list(merged.values())

    stats["kept_edges"] = len(cleaned)
    return {"nodes": valid_nodes, "edges": cleaned}, stats

def main():
    ap = argparse.ArgumentParser(description="Validate suggestions JSON (graph or legacy map).")
    ap.add_argument("--in", dest="inp", default=OUT_JSON)
    ap.add_argument("--out", dest="out", default=OUT_JSON)
    ap.add_argument("--min-sim", dest="min_sim", type=int, default=55,
                    help="Filter edges whose similarity is below min-sim (graph and legacy formats)")
    ap.add_argument("--no-dedup", dest="dedup", action="store_false",
                    help="Do not deduplicate edges (graph format only)")
    args = ap.parse_args()

    data = load_json(args.inp)

    # Detect the format.
    if isinstance(data, dict) and "nodes" in data and "edges" in data:
        fixed, stats = validate_graph(data, min_sim=args.min_sim, dedup=args.dedup)
        save_json(fixed, args.out)
        log.info("\n📊 VALIDATION (GRAPH)")
        log.info("──────────────────────────────")
        log.info(f"Nodes:  {stats['valid_nodes']}/{stats['total_nodes']} valid")
        log.info(f"Edges:  {stats['kept_edges']}/{stats['total_edges']} kept")
        log.info(f" - removed_selfloops:   {stats['removed_selfloops']}")
        log.info(f" - removed_invalid_ids: {stats['removed_invalid_ids']}")
        log.info(f" - removed_low_sim:     {stats['removed_low_sim']}")
        log.info(f" - dedup_merged:        {stats['dedup_merged']}")
        log.info(f"\n✅ Saved to: {args.out}")
    else:
        fixed, stats = validate_legacy(data, min_sim=args.min_sim)
        save_json(fixed, args.out)
        log.info("\n📊 VALIDATION (LEGACY MAP)")
        log.info("──────────────────────────────")
        log.info(f"Sources: {stats['valid_sources']}/{stats['total_sources']} valid")
        log.info(f"Targets: {stats['valid_targets']}/{stats['total_targets']} valid")
        log.info(f" - removed_selfloops:   {stats['removed_selfloops']}")
        log.info(f" - removed_invalid_ids: {stats['removed_invalid_ids']}")
        log.info(f"\n✅ Saved to: {args.out}")

if __name__ == "__main__":
    main()
