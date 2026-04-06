#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Hybrid system:
- Analysis by tags (fast)
- Analysis with AI (AI_MODEL) optional
- Email with suggestions (optional, via SMTP)
- Writes JSON for the viewer to output/suggestions.json
"""
from __future__ import annotations
from collections import Counter
from config.schema_keys import NODE_KIND_KEYS
from pipeline.parses.robust_ai_parser import analyze_ai
from pipeline.ai_client import check_model_availability
import requests
import unicodedata
import json
import html
import re
import os
import smtplib
import ssl
import time
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from pipeline.brain.validate_suggestions import validate_graph
from config.logger_config import setup_logging, get_logger
from config.app_config import load_params
from config.text_normalization import normalize_text
from pathlib import Path
from pprint import pprint
from itertools import combinations
from pipeline.skills.json_to_sigma.scripts.json_to_sigma import convert_for_sigma
from pipeline.notion_api import (
    get_notes_by_type, 
    notion_url, 
    update_page_relations, 
    query_database, 
    get_blocks, 
    retrieve_page, 
    get_database_properties
)
from pipeline.utils.tag_normalization import normalize_tag, normalize_tagset

cfg = load_params(strict_env=False)
setup_logging()
log = get_logger(__name__)

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------

# ============================================================
# 🎯 CONFIG ACCESS (params.yaml)
# ============================================================

# --- Simple keys (outside sections) ---
MIN_REASON_WORDS   = cfg.get("MIN_REASON_WORDS")
MAX_REASON_WORDS   = cfg.get("MAX_REASON_WORDS")
MIN_CONTENT_WORDS  = cfg.get("MIN_CONTENT_WORDS")
MIN_SIM            = cfg.get("MIN_SIM")
TAGS_MIN_SCORE_KEEP= cfg.get("tags_min_score_keep")

# --- Notion Keys (all within cfg.notion) ---
TYPE_PROP_KEYS      = cfg.notion.get("type_property")
TAGS_PROP_KEYS      = cfg.notion.get("tags_property")
LINKS_PROP_KEYS     = cfg.notion.get("links_property")
TITLE_PROP_KEYS     = cfg.notion.get("title_property")

# --- Schema keys (only existing ones in schema_keys.py) ---
NODE_ID_KEYS       = cfg.schema_keys["NODE_ID_KEYS"]
NODE_TITLE_KEYS    = cfg.schema_keys["NODE_TITLE_KEYS"]
NODE_KIND_KEYS     = cfg.schema_keys["NODE_KIND_KEYS"]
EDGE_SRC_KEYS      = cfg.schema_keys["EDGE_SRC_KEYS"]
EDGE_DST_KEYS      = cfg.schema_keys["EDGE_DST_KEYS"]
EDGE_ARRAY_KEYS    = cfg.schema_keys["EDGE_ARRAY_KEYS"]
PROJECT_KEYS       = cfg.schema_keys["PROJECT_KEYS"]
ENLLACA_ALIASES    = cfg.schema_keys["LINKS_PROP_KEYS"]
SELECT_TO_KIND     = cfg.schema_keys["SELECT_TO_KIND"]

# -----------------------------
# 🔐 Environment Variables
# -----------------------------
NOTION_TOKEN       = cfg.notion["NOTION_TOKEN"]
DATABASE_ID        = cfg.notion["NOTION_DATABASE"]

# -----------------------------
# 📧 SMTP
# -----------------------------
SMTP_HOST           = cfg.get("smtp_host")
SMTP_PORT           = cfg.get("smtp_port")
SMTP_USER           = cfg.get("smtp_user")
SMTP_PASS           = cfg.get("smtp_pass")
MAIL_TO             = cfg.get("mail_to")
MAIL_FROM           = cfg.get("mail_from")

# -----------------------------
# 🤖 AI MODEL
# -----------------------------
AI_MODEL_URL        = cfg.ai.get("model_url")
AI_MODEL_MODEL      = cfg.ai.get("model_name")
AI_MODEL_TIMEOUT    = cfg.ai.get("timeout")
AI_MODEL_RETRIES    = cfg.ai.get("retries")
AI_MODEL_BACKOFF    = cfg.ai.get("backoff")

# -----------------------------
# ⏱️ Delays
# -----------------------------
DELAY_ENTRE_NOTAS   = cfg.get("delay_entre_notas")
DELAY_ENTRE_IA      = cfg.get("delay_entre_ia")

# -----------------------------
# 📁 Paths (derived from get_paths())
# -----------------------------
OUT_JSON            = cfg.paths["OUT_JSON"]
OUT_GRAPH           = cfg.paths["OUT_GRAPH"]
LOG_DIR             = cfg.paths["LOG_DIR"]
STOPWORDS_PATH      = cfg.paths["STOPWORDS_PATH"]

# -----------------------------
# 🔧 Optional configuration for robust_ai_parser
# -----------------------------
try:
    import pipeline.parses.robust_ai_parser as robust_ai_parser
    robust_ai_parser.MIN_SIM = MIN_SIM
except Exception:
    pass

# --- Notion Client ---
from notion_client import Client
notion = Client(auth=NOTION_TOKEN)

def _find_relation_prop(props: dict) -> str | None:
    """Finds the real name of the 'Project' relation property among various aliases."""
    for k in props.keys():
        v = props.get(k)
        if isinstance(v, dict) and v.get("type") == "relation":
            # flexible match by visible name
            low = k.strip().casefold()
            for alias in PROJECT_KEYS:
                if low == alias.casefold():
                    return k
            # fallback: if name contains 'project'
            if "project" in low or "projecte" in low or "proyecto" in low:
                return k
    return None

def _tags_from_props(props: dict) -> list[dict]:
    """Extracts Notion tags with their color."""
    for k in TAGS_PROP_KEYS:
        v = props.get(k)
        if isinstance(v, dict) and v.get("type") == "multi_select":
            tags = []
            for it in v.get("multi_select", []):
                name = it.get("name")
                color = it.get("color", "default")
                if name:
                    tags.append({"name": name, "color": color})
            return tags
    return []

def _extract_keywords(text: str, min_len: int) -> list[str]:
    def _clean_text(text: str) -> str:
        return re.sub(r'[^\w\s]', ' ', (text or "").lower())
    words = _clean_text(text).split()
    # short stoplist; "good" stopwords are loaded by the robust parser if needed
    stops = {'para','como','sobre','desde','entre','donde','cuando','aunque','porque','entonces',
             'también','este','esta','però','amb','per','aquest','aquesta','això','esto',
             'que','con','les','los','els'}
    return [p for p in words if len(p) >= min_len and p not in stops]



def get_notes(select_type: str):
  """
  Wrapper function to maintain compatibility with the unified API.
  Ensures the return structure matches what the pipeline expects.
  """
  # Ensure tag_aliases is a list
  tag_aliases = TAGS_PROP_KEYS if isinstance(TAGS_PROP_KEYS, list) else [TAGS_PROP_KEYS]
  
  return get_notes_by_type(
       tipo_select=select_type,
       type_property_name=TYPE_PROP_KEYS,     # "Note type"
       title_aliases=NODE_TITLE_KEYS,    # title (multilingual)
       tag_aliases=tag_aliases,            # Multi-select Tags
       project_aliases=PROJECT_KEYS,      # Project / Projects / etc.
       links_aliases=LINKS_PROP_KEYS      # NEW: Enable Sync Relations for these notes
   )

# ──────────────────────────────────────────────────────────────────────────────
# Helpers for enriched export (nodes + edges)
# ──────────────────────────────────────────────────────────────────────────────
def _norm_uuid(u: str) -> str:
    """Normalizes UUIDs (with or without dashes) to dashed format."""
    s = (u or "").lower().replace("{", "").replace("}", "").strip()
    if "-" in s:
        return s
    m = re.fullmatch(r"([0-9a-f]{32})", s)
    if m:
        raw = m.group(1)
        return f"{raw[0:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:32]}"
    return s

def _kind_from_label(label: str) -> str:
    lab = (label or "").lower()
    if "permanent" in lab: return "permanent"
    if "lectura"    in lab: return "lectura"
    if "índex" in lab or "index" in lab: return "index"
    if "dialogo" in lab or "diàleg" in lab: return "dialogo"
    return ""

def _find_relation_prop_by_aliases(props: dict, aliases: list[str]) -> str | None:
    if not isinstance(props, dict):
        return None
    low2key = {k.strip().casefold(): k for k in props.keys()}
    # 1) exact match by alias
    for alias in aliases:
        ak = alias.strip().casefold()
        if ak in low2key:
            k = low2key[ak]
            v = props.get(k)
            if isinstance(v, dict) and v.get("type") == "relation":
                return k
    # 2) fallback: any relation containing the keyword
    for k, v in props.items():
        if isinstance(v, dict) and v.get("type") == "relation":
            lk = k.strip().casefold()
            if any(a.split()[0].casefold() in lk for a in aliases):
                return k
    return None

def _get_relations_links_to(page_id: str) -> list[str]:
    """Reads the 'Links to' relational property (with aliases)."""
    try:
        page = retrieve_page(page_id=page_id)
        props = page.get("properties", {}) or {}
        rel_name = _find_relation_prop_by_aliases(props, ENLLACA_ALIASES)
        if not rel_name:
            return []
        rel = props.get(rel_name)
        if rel and rel.get("type") == "relation":
            return [r["id"] for r in rel.get("relation", []) if "id" in r]
    except Exception:
        pass
    return []


# -----------------------------------------------------------------------------
# TAG-BASED EDGES (direct match by tag coincidence)
# -----------------------------------------------------------------------------
def build_tag_edges_from_nodes(nodes: list[dict], min_shared: int = 1) -> list[dict]:
    """
    Constructs inferred edges between nodes that share >= min_shared Notion tags.
    Saves via_tags (shared literal names) and marks evidence=["tags_inferred"].
    These connections should be shown as dashed.
    """
    idx = {}
    tags_by_id = {}

    for n in nodes:
        nid = n.get("id")
        tags_raw = n.get("tags", []) or []
        # accepts Notion dicts {"name": "..."} or strings
        tags = []
        for t in tags_raw:
            if isinstance(t, dict):
                name = t.get("name") or t.get("title") or t.get("label")
            else:
                name = str(t) if t else ""
            if name:
                tags.append(name.strip())
        tags_by_id[nid] = tags
        for tag in tags:
            idx.setdefault(normalize_tag(tag), set()).add(nid)

    edges = []
    for tag_norm, nids in idx.items():
        if len(nids) < 2:
            continue
        for a, b in combinations(sorted(nids), 2):
            # via_tags: literal intersection (not normalized) between a and b
            shared = sorted(set(tags_by_id[a]).intersection(tags_by_id[b]))
            if len(shared) >= min_shared:
                edges.append({
                    "source": a,
                    "target": b,
                    "evidence": ["tags_inferred"],
                    "via_tags": shared,
                    "similarity": 99,
                    "score": 0.99,
                    "reason": f"common tags: {', '.join(shared[:2])}"
                })
    return edges

# -----------------------------------------------------------------------------
# Tag-based Analysis
# -----------------------------------------------------------------------------
def tag_similarity(n1: dict, n2: dict, cfg) -> tuple[int, list[str]]:
    """
    Calculates a similarity 0..100 based on TAGS and keyword matching.
    Uses weights defined in config (cfg.tags_*).
    """
    pts_per_tag = int(getattr(cfg, "tags_points_per_common_tag", 25))
    tags_cap    = int(getattr(cfg, "tags_max_points_from_tags", 50))
    kw_minlen   = int(getattr(cfg, "tags_keywords_min_len", 5))
    kw_pts      = int(getattr(cfg, "tags_keywords_points_per_overlap", 3))
    kw_cap      = int(getattr(cfg, "tags_keywords_max_points", 50))

    score, razones = 0, []

    # 1) TAGS Coincidence
    tags1 = normalize_tagset(n1.get("tags", []))
    tags2 = normalize_tagset(n2.get("tags", []))
    comunes = sorted(tags1 & tags2)
    if comunes:
        add = min(len(comunes) * pts_per_tag, tags_cap)
        score += add
        razones.append(f"Common tags ({len(comunes)}): {', '.join(comunes[:3])}")

    # 2) Keyword matching (text)
    p1 = _extract_keywords(n1.get("contenido", ""), kw_minlen)
    p2 = _extract_keywords(n2.get("contenido", ""), kw_minlen)
    if p1 and p2:
        c1, c2 = Counter(p1), Counter(p2)
        comunes_kw = set(c1) & set(c2)
        if comunes_kw:
            freq = sum(min(c1[w], c2[w]) for w in comunes_kw)
            add = min(freq * kw_pts, kw_cap)
            score += add
            top = sorted(comunes_kw, key=lambda w: c1[w] + c2[w], reverse=True)[:2]
            if top:
                razones.append(f"Common concepts: {', '.join(top)}")

    return min(score, 99), razones

def analyze_tags(note: dict, candidates: list[dict], threshold=None) -> list[dict]:
    if threshold is None:
        threshold = TAGS_MIN_SCORE_KEEP
    out = []
    for cand in candidates:
        sc, reasons = tag_similarity(note, cand, cfg)
        if sc >= threshold:
            out.append({"id": cand["id"], "titulo": cand["titulo"], "score": sc, "razones": reasons, "metodo": "tags"})
    return sorted(out, key=lambda x: x["score"], reverse=True)

# -----------------------------------------------------------------------------
# AI Analysis (AI_MODEL)
# -----------------------------------------------------------------------------
from pipeline.ai_client import check_model_availability

# ... (imports)

# -----------------------------------------------------------------------------
# AI-based Analysis
# -----------------------------------------------------------------------------
# AI_MODEL_disponible removed, using check_model_availability from ai_client

# -----------------------------------------------------------------------------
# Email Notification (Optional)
# -----------------------------------------------------------------------------
def _escape(s: str) -> str:
    return html.escape(s or "", quote=True)

def _render_html(resultats: dict[str, list[dict]], id2meta: dict[str, dict]) -> str:
    # results: map source_id -> list of conns (target_id/score/reason)
    parts = [
        "<h2>Connection Suggestions</h2>",
        "<p>Below are the main connections (TAGS and AI).</p>"
    ]
    for src, lst in resultats.items():
        meta = id2meta.get(src, {})
        ttl  = normalize_text(_escape(meta.get("titulo") or src[:12]))
        url  = meta.get("url")
        parts.append(f"<h3>📖 <a href='{_escape(url)}' target='_blank'>{ttl}</a></h3>" if url else f"<h3>📖 {ttl}</h3>")
        if not lst:
            parts.append("<p style='opacity:.7'>No relevant connection</p>")
            continue
        parts.append("<ul>")
        for c in lst[:8]:
            tgt = id2meta.get(c["target_id"], {})
            tttl = normalize_text(_escape(tgt.get("titulo") or c['target_id'][:12]))
            turl = tgt.get("url")
            score_txt = f"{int(round((c.get('score') or 0)))}%"
            reason = normalize_text(_escape(c.get("reason","")))
            line = f"<li>→ <a href='{_escape(turl)}' target='_blank'>{tttl}</a> · {score_txt}"
            if reason:
                line += f"<br><small>{reason}</small>"
            parts.append(line + "</li>")
        parts.append("</ul>")
    return "\n".join(parts)

def save_graph(graph: dict, path: Path = OUT_JSON) -> None:
    """
    Writes JSON atomically using a temporary file.
    `graph` must be a dict with keys "nodes" and "edges".
    """
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")

        with tmp.open("w", encoding="utf-8") as f:
            json.dump(graph, f, ensure_ascii=False, indent=2)
            f.flush();
            os.fsync(f.fileno())

        os.replace(tmp, path)

        n_nodes = len(graph.get("nodes", []))
        n_edges = len(graph.get("edges", []))
        log.info("[OK] Final graph saved to: %s  (%d nodes · %d edges)", str(path), n_nodes, n_edges)

    except Exception as e:
        log.exception("Could not save graph to %s: %s", path, e)

def _edge_type(e):
    ev = [x.strip().lower() for x in (e.get("evidence") or []) if isinstance(x, str)]
    ev = sorted(set(ev))
    if not ev:
        return "other"
    if ev == ["ai"]:
        return "ai"
    if ev == ["explicit"]:
        return "explicit"
    if ev == ["tags"]:
        return "tags"
    # combinacions
    return "+".join(ev)

def _title(id2node, nid):
    n = id2node.get(nid, {})
    return n.get("title") or nid[:8]

def debug_edges_table(graph):
    id2node = {n["id"]: n for n in graph.get("nodes", [])}
    rows = []
    for e in graph.get("edges", []):
        rows.append({
            "type": _edge_type(e),
            "source": _title(id2node, e["source"]),
            "target": _title(id2node, e["target"]),
            "similarity": e.get("similarity"),
            "via_tags": ", ".join(e.get("via_tags", [])[:3]) if e.get("via_tags") else ""
        })
    # sort by type and then by source
    rows.sort(key=lambda r: (r["type"], r["source"], r["target"]))

    # ─────────────────────────────────────────────────────────────
    #  FINAL EDGES SUMMARY
    # ─────────────────────────────────────────────────────────────
    edges = graph.get("edges", [])

    # Classify edge strength based on similarity score
    def classify_strength(sim):
        if sim is None:
            return "explicit"
        try:
            s = int(sim)
        except Exception:
            return "?"
        if s >= 85:
            return "strong"
        elif s >= 65:
            return "medium"
        elif s >= 45:
            return "weak"
        else:
            return "faint"

    SYMBOLS = {
        "strong": "🟢",
        "medium": "🟡",
        "weak": "🟠",
        "faint": "🔴",
        "explicit": "⚫"
    }

    # Count by evidence type
    explicit = sum("explicit" in e.get("evidence", []) for e in edges)
    ai = sum(e.get("evidence") == ["ai"] for e in edges)
    tags = sum("tags" in e.get("reason", "").lower() for e in edges)
    mixes = sum(set(e.get("evidence", [])) == {"ai", "explicit"} for e in edges)

    total = len(edges)
    log.info("——— EDGES SUMMARY ———")
    log.info(f"total={total} | explicit={explicit} | ai={ai} | tags={tags} | mixes={mixes}")

    # Table header
    log.info(f"{'TYPE':<10} | {'SOURCE':<32} | {'TARGET':<32} | {'SIM':>3} | {'STRENGTH':<10} | VIA_TAGS")
    log.info("-" * 110)

    # Show summary for each edge
    for e in edges:
        ev = e.get("evidence", [])
        etype = "+".join(ev)
        sim = e.get("similarity")
        src = graph["_meta_names"].get(e["source"], e["source"]) if "_meta_names" in graph else e["source"]
        dst = graph["_meta_names"].get(e["target"], e["target"]) if "_meta_names" in graph else e["target"]
        via_tags = "✓" if "tags" in (e.get("reason", "").lower()) else ""
        strength = classify_strength(sim)
        icon = SYMBOLS.get(strength, "")
        log.info(
            f"{etype:<10} | {src:<32} | {dst:<32} | {sim if sim is not None else '—':>3} | {icon} {strength:<9} | {via_tags}")


# -----------------------------------------------------------------------------
# Main process
# -----------------------------------------------------------------------------
def process(force_layout: bool = False):
    log.info("=" * 70)
    log.info("🔍 HYBRID SYSTEM: TAGS + AI")
    log.info("=" * 70 + "\n")

    AI_MODEL_ok = check_model_availability()
    if not AI_MODEL_ok:
        if cfg.ai.get("model_url"):
             log.warning("⚠️  AI_MODEL_URL is set but model is not reachable. Proceeding with tags only.")
        else:
             log.info("ℹ️  AI_MODEL not configured - tags only\n")

    # ─────────────────────────────────────────────────────────────
    # Notion Schema Diagnostic
    # ─────────────────────────────────────────────────────────────
    log.info("🔎 Validating DB access…")
    log.info("DATABASE_ID: %s", DATABASE_ID)

    # A) Database metadata: property names and types
    try:
        db_meta = get_database_properties(database_id=DATABASE_ID)
        props = db_meta.get("properties", {})
        log.info("📇 Notion Properties (%d):", len(props))
        pprint([{"name": k, "type": v.get("type")} for k, v in props.items()])
    except Exception as e:
        log.exception("❌ Error getting DB metadata: %s", e)

    # B) Show 1 page and its properties
    try:
        qr = query_database(database_id=DATABASE_ID, page_size=1)
        results = qr.get("results", [])
        if results:
            page = results[0]
            pprops = page.get("properties", {})
            log.info("🧪 Sample page properties:")
            pprint(list(pprops.keys()))
        else:
            log.warning("⚠️ Query returned no pages (could be Notion filter or permissions).")
    except Exception as e:
        log.exception("❌ Error querying DB: %s", e)

    # C) What your config expects (for quick comparison)
    log.info("🔧 Expecting: TYPE_PROP_KEYS=%s  LINKS_PROP_KEYS=%s", TYPE_PROP_KEYS, LINKS_PROP_KEYS)
    log.info("🔧 Aliases: TITLE=%s", NODE_TITLE_KEYS)
    log.info("🔧 Aliases: KIND =%s", NODE_KIND_KEYS)
    log.info("🔧 Aliases: LINKS=%s", LINKS_PROP_KEYS)
    log.info("🔧 Aliases: TAGS =%s", TAGS_PROP_KEYS)
    # ─────────────────────────────────────────────────────────────

    log.info("🔄 Loading notes...")
    permanents = get_notes("Nota permanent")
    lectures   = get_notes("Nota de lectura")
    indexos    = get_notes("Nota índex")
    dialogos   = get_notes("Nota diàleg")

    log.info(f"✅ {len(permanents)} permanent notes, {len(lectures)} reading notes, {len(indexos)} index notes, {len(dialogos)} dialogue notes\n")

    if not permanents and not lectures and not dialogos:
        log.info("No notes to analyze")
        return

    # Index for quick metadata
    id2meta: dict[str, dict] = {n["id"]: n for n in (permanents + lectures + indexos + dialogos)}

    # Result expected by the viewer:
    # { "SOURCE_ID": [ {"target_id": "...", "score": 0.82, "reason": "…"}, ... ] }
    resultats: dict[str, list[dict]] = {}

    # --- Analyze reading notes against permanent and other reading notes
    lect_recents = lectures
    if lect_recents:
        log.info(f"📊 Analyzing reading notes ({len(lect_recents)})\n" + "-"*70 + "\n")
    for i, lect in enumerate(lect_recents, 1):
        log.info(f"[{i}/{len(lect_recents)}] 📖 {lect['titulo'][:50]}...")
        
        # 0) Update "Enllaça a" from mentions (if any)
        mentions = lect.get("mentions", [])
        if mentions:
            log.info(f"   → Found {len(mentions)} mentions. Updating relations...")
            update_page_relations(lect["id"], mentions, LINKS_PROP_KEYS)

        time.sleep(DELAY_ENTRE_NOTAS)

        # vs permanent notes
        conn_perm_tags = analyze_tags(lect, permanents)[:5]
        ids_tags = {c["id"] for c in conn_perm_tags}
        conn_perm_ia = (analyze_ai(lect, permanents, ids_tags) or [])[:3] if AI_MODEL_ok else []

        # vs other reading notes
        altres_lect = [l for l in lectures if l["id"] != lect["id"]]
        conn_lect_tags = analyze_tags(lect, altres_lect)[:5]

        # Consolidated -> viewer format
        items: list[dict] = []
        for c in (conn_perm_tags + conn_perm_ia + conn_lect_tags):
            if not c.get("id"):
                continue

            score = float(c.get("score", 0))
            score01 = score / 100.0 if score > 1.0 else score
            similarity = min(int(round(score01 * 100)), 99)

            # Robust reason (accepts 'reason' from AI parser, 'razon' and 'razones' list)
            if isinstance(c.get("razones"), list) and c["razones"]:
                reason = "; ".join(c["razones"])
            else:
                reason = (str(c.get("reason") or c.get("razon") or "")).strip() or "semantic match (AI)"

            reason = normalize_text(reason)

            items.append({
                "target_id": c["id"],
                "score": round(score01, 4),
                "similarity": similarity,
                "reason": reason,
                "metodo": (c.get("metodo") or "").strip().lower()
            })
        resultats[lect["id"]] = items

    # --- Analyze permanent notes against other permanent notes
    perm_recents = permanents
    if perm_recents:
        log.info("-"*70 + "\n💎 PERMANENT NOTES ANALYSIS\n")
    for i, perm in enumerate(perm_recents, 1):
        log.info(f"[{i}/{len(perm_recents)}] 💎 {perm['titulo'][:50]}...")
        
        # 0) Update "Enllaça a" from mentions (if any)
        mentions = perm.get("mentions", [])
        if mentions:
            log.info(f"   → Found {len(mentions)} mentions. Updating relations...")
            update_page_relations(perm["id"], mentions, LINKS_PROP_KEYS)
            
        time.sleep(DELAY_ENTRE_NOTAS)

        altres_perm = [p for p in permanents if p["id"] != perm["id"]]
        conn_tags = analyze_tags(perm, altres_perm)[:5]
        ids_tags = {c["id"] for c in conn_tags}
        conn_ia  = analyze_ai(perm, altres_perm, ids_tags)[:3] if AI_MODEL_ok else []

        items: list[dict] = []
        for c in (conn_tags + conn_ia):
            if not c.get("id"):
                continue

            score = float(c.get("score", 0))
            score01 = score / 100.0 if score > 1.0 else score
            similarity = min(int(round(score01 * 100)), 99)

            if isinstance(c.get("razones"), list) and c["razones"]:
                reason = "; ".join(c["razones"])
            else:
                reason = (str(c.get("reason") or c.get("razon") or "")).strip() or "semantic match (AI)"

            items.append({
                "target_id": c["id"],
                "score": round(score01, 4),
                "similarity": similarity,
                "reason": reason,
                "metodo": (c.get("metodo") or "").strip().lower()
            })
        resultats[perm["id"]] = items

    log.info("=" * 70)
    log.info("✅ ANALYSIS COMPLETED")
    log.info("=" * 70 + "\n")

    # Save JSON for the viewer
    # ──────────────────────────────────────────────────────────────────────────────
    # Construct a single enriched graph object: {"nodes": [...], "edges": [...]}
    # ──────────────────────────────────────────────────────────────────────────────

    # 1) Nodes (permanent + reading + indexes)
    ids_perm = {n["id"] for n in permanents}
    ids_lect = {n["id"] for n in lectures}
    ids_indx = {n["id"] for n in indexos}
    ids_dial = {n["id"] for n in dialogos}

    # 1) Nodes (permanents + lectures + index + dialogos)
    nodes = []
    seen = set()
    all_tags = set()  # To collect all unique tags
    
    for n in (permanents + lectures + indexos + dialogos):
        pid = _norm_uuid(n["id"])
        if pid in seen:
            continue
        seen.add(pid)

        # Label type: never "unknown"; if unknown, leave empty
        if n.get("tipo"):
            kind = n["tipo"]
        else:
            if n["id"] in ids_perm:
                kind = "permanent"
            elif n["id"] in ids_lect:
                kind = "lectura"
            elif n["id"] in ids_indx:
                kind = "index"
            elif n["id"] in ids_dial:
                kind = "dialogo"
            else:
                kind = ""

        # Collect tags from this note
        note_tags = n.get("tags", [])[:8]
        for tag in note_tags:
            tag_name = tag.get("name") if isinstance(tag, dict) else str(tag)
            if tag_name:
                all_tags.add(tag_name.strip())

        nodes.append({
            "id": pid,
            "title": n.get("titulo") or "Untitled",
            "kind": kind,
            "url": notion_url(pid),
            "tags": note_tags,
            "projects": n.get("projects", []),
            "project_ids": n.get("project_ids", []),
            "created_time": n.get("created_time"),
        })

    # 1a) Create nodes for tags
    tag_nodes = []
    for tag_name in sorted(all_tags):
        # Create a unique ID for the tag based on its name
        tag_id = f"tag::{tag_name.lower().replace(' ', '-')}"
        tag_nodes.append({
            "id": tag_id,
            "title": f"tag::{tag_name}",
            "kind": "tag",
            "url": "",  # Tags do not have URLs
            "tags": [],
            "projects": [],
            "project_ids": [],
        })
    
    # Add tag nodes to the node list
    nodes.extend(tag_nodes)
    log.info(f"📌 Created {len(tag_nodes)} tag nodes from {len(all_tags)} unique tags")

    # 1b) TAG Edges (direct via Notion TAGS)
    tag_edges_directes = build_tag_edges_from_nodes(nodes, min_shared=1)  # 1 = at least 1 shared tag

    # 1c) Create edges between notes and their tags
    tag_edges = []
    for n in (permanents + lectures + indexos + dialogos):
        note_id = _norm_uuid(n["id"])
        note_tags = n.get("tags", [])
        for tag in note_tags:
            tag_name = tag.get("name") if isinstance(tag, dict) else str(tag)
            if tag_name:
                tag_id = f"tag::{tag_name.strip().lower().replace(' ', '-')}"
                tag_edges.append({
                    "source": note_id,
                    "target": tag_id,
                    "evidence": ["tag"],
                    "dashes": False,
                    "similarity": 100,
                    "score": 1.0,
                    "reason": f"tagged with: {tag_name.strip()}"
                })
    
    log.info(f"🔗 Created {len(tag_edges)} edges connecting notes to tags")

    # 2) Explicit edges ("Links to"): evidence=["explicit"], dashes=False
    edges = []
    for n in (permanents + lectures + indexos + dialogos):
        src = _norm_uuid(n["id"])
        try:
            targets = _get_relations_links_to(src)
        except Exception:
            targets = []
        for t in targets:
            dst = _norm_uuid(t)
            if src == dst:
                continue
            edges.append({
                "source": src,
                "target": dst,
                "evidence": ["explicit"],
                "dashes": False,              # kept for compat.
                "similarity": 100,            # explicit → 100
                "score": 1.0,
                "reason": "ref: Enllaça a"
            })


    # 3) AI/tag edges (from your 'results'): dashes=True
    for src_id, lst in (resultats or {}).items():
        src = _norm_uuid(src_id)
        for it in (lst or []):
            dst = _norm_uuid(it.get("target_id", ""))
            if not dst or src == dst:
                continue
            score_f = float(it.get("score", 0.0))  # 0..1
            similarity_i = min(int(round(score_f * 100)), 99)  # 0..99
            metodo = (it.get("metodo") or "").strip().lower()
            ev = ["tags"] if metodo == "tags" else ["ai"]

            edges.append({
                "source": src,
                "target": dst,
                "evidence": ev,
                "dashes": (ev == ["ai"]),  # dashed if only AI
                "score": score_f,
                "similarity": similarity_i,
                "reason": (it.get("reason") or "").strip()
            })

    # 3b) Add direct TAGS to the list
    edges.extend(tag_edges_directes)
    
    # 3c) Add edges between notes and tags
    edges.extend(tag_edges)

    # 4) Write enriched format to the same OUT_JSON
    graph = {"nodes": nodes, "edges": edges}

    # Unify and enrich
    graph = postprocess_graph(graph)

    # 📊 DEBUG: final edges table
    try:
        debug_edges_table(graph)
    except Exception as _e:
        log.warning("debug_edges_table failed: %s", _e)

    # ➌ Add metadata (point 3)
    graph["_meta"] = {
        "nodes": len(graph.get("nodes", [])),
        "edges": len(graph.get("edges", [])),
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
       "min_similarity_kept": int(getattr(cfg, "min_similarity_kept", 60)),
        "topk_per_node": int(getattr(cfg, "topk_per_node", 3)),
    }

    # 4b) Integrated validation + atomic save of final JSON
    try:
        res = validate_graph(graph, min_sim=int(getattr(cfg, "min_similarity_kept", 60)))
        # Can return a dict or (validated_graph, report)
        if isinstance(res, tuple):
            graph, validation_report = res
        else:
            graph = res
            validation_report = None

        save_graph(graph, OUT_JSON)

        if validation_report:
            # leave as INFO/DEBUG as preferred
            log.info("Validation report: %s", validation_report)

    except Exception as e:
        log.warning("validate_graph failed (%s); writing unvalidated graph", e)
        # Save unvalidated graph anyway
        save_graph(graph, OUT_JSON)

    # 5) Step json to sigma
    convert_for_sigma(filters={"force_layout": force_layout})

    # 6) Email (optional) — if creds are missing, skip
    try:
        n_src = len(resultats)
        n_edges = sum(len(v) for v in resultats.values())
        subject = f"[Brain] Daily suggestions · {n_src} notes · {n_edges} connections"
        html    = _render_html(resultats, id2meta)
        text    = "See the HTML version of the suggestions."
        if all([SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO]):
            _enviar_email(subject, html, text)
        else:
            log.info("[INFO] SMTP not fully configured: skipping email send.")
    except Exception as e:
        log.info(f"[WARN] Email not sent: {e}")

def _enviar_email(subject: str, body_html: str, body_text: str = "See the HTML version."):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = MAIL_FROM or SMTP_USER
    msg["To"]      = MAIL_TO or (SMTP_USER or "")

    msg.attach(MIMEText(body_text, "plain", "utf-8"))
    msg.attach(MIMEText(body_html, "html",  "utf-8"))

    context = ssl.create_default_context()
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
        server.ehlo()
        server.starttls(context=context)
        server.ehlo()
        server.login(SMTP_USER, SMTP_PASS)
        server.send_message(msg)
    log.info("[OK] Email sent via SMTP STARTTLS")

def sort_pair(a, b):
    # For undirected edge (to deduplicate), sort IDs
    return tuple(sorted([a, b]))

def compute_overlap(a_tags, b_tags):
    def _normalize_tag(tag):
        if isinstance(tag, dict):
            tag = tag.get("name") or tag.get("title") or ""
        tag = str(tag or "").strip().casefold()
        tag = unicodedata.normalize("NFD", tag)
        return "".join(ch for ch in tag if unicodedata.category(ch) != "Mn")

    a = {_normalize_tag(t) for t in (a_tags or []) if _normalize_tag(t)}
    b = {_normalize_tag(t) for t in (b_tags or []) if _normalize_tag(t)}
    return sorted(a & b)

def compute_project_overlap(a_projects, b_projects):
    a = [ (p or "").strip().casefold() for p in (a_projects or []) ]
    b = [ (p or "").strip().casefold() for p in (b_projects or []) ]
    return sorted(set(a) & set(b))

def reason_ok(reason: str) -> bool:
    if not reason:
        return False
    words = re.findall(r"\w+", reason, flags=re.UNICODE)
    return len(words) >= max(5, MIN_REASON_WORDS)

def postprocess_graph(graph):
    """
    Inputs:
      graph = {"nodes": [...], "edges": [...]}
    Output:
      New cleaned and enriched graph
    """
    id2node = {n["id"]: n for n in graph.get("nodes", [])}

    # 1) Normalize node texts
    for n in graph.get("nodes", []):
        n["title"] = normalize_text(n.get("title", ""))
        n["projects"] = [normalize_text(p) for p in n.get("projects", [])]

    merged = {}  # key: (a,b) if undirected, or (a,b,"dir") if you want to preserve direction
    new_edges = []

    for e in graph.get("edges", []):
        s = e["source"]; t = e["target"]
        if s not in id2node or t not in id2node:
            continue  # safety

        # 2) Classify evidence (respect 'evidence' if provided)
        ev_list = e.get("evidence")
        if isinstance(ev_list, str):
            ev_list = [ev_list]
        ev_set = {(x or "").strip().lower() for x in (ev_list or []) if isinstance(x, str) and x.strip()}

        if not ev_set:
            # old compatibility: infer from dashes if needed
            ev_set = {"ai"} if e.get("dashes", False) else {"explicit"}

        # if via_tags exists, ensure 'tags'
        if e.get("via_tags"):
            ev_set.add("tags")

        # 3) Clean, validate and (if needed) enrich reason with overlaps
        reason = normalize_text(e.get("reason", "")).strip()
        sim = e.get("similarity")

        # 4) Calculate overlaps BEFORE to use them if reason is too short
        tags_overlap = compute_overlap(id2node[s].get("tags", []), id2node[t].get("tags", []))
        proj_overlap = compute_project_overlap(id2node[s].get("projects", []), id2node[t].get("projects", []))

        if ev_set == "ai":
            # If reason is too short, try to enrich with objective info
            if not reason_ok(reason):
                extras = []
                if tags_overlap:
                    extras.append(f"tags comuns: {', '.join(tags_overlap[:2])}")
                if proj_overlap:
                    extras.append(f"projectes comuns: {', '.join(proj_overlap[:1])}")
                if extras:
                    # Join without repeating dash if 'reason' is empty
                    reason = (reason + (" – " if reason else "") + "; ".join(extras)).strip()

                # Re-validate; if still poor, discard edge
                if not reason_ok(reason):
                    continue

        # 5) Decide merge keys (undirected recommended)
        key = sort_pair(s, t)

        entry = merged.get(key)
        if not entry:
            # for explicit without 'sim', assign 100; if AI, leave None
            sim_init = sim if isinstance(sim, (int, float)) else (100 if ev_set == "explicit" else None)
            entry = {
                "source": s, "target": t,
                "evidence": ev_set,
                "reasons": [reason] if reason else [],
                "similarity": sim_init,  # single displayable value
                "score": e.get("score", None),
                "tags_overlap": tags_overlap,
                "project_overlap": proj_overlap
            }
        else:
            # Merge
            entry["evidence"].update(ev_set)
            if reason:
                entry["reasons"].append(reason)

            # Max similarity:
            if isinstance(sim, (int, float)):
                if entry["similarity"] is None or sim > entry["similarity"]:
                    entry["similarity"] = sim
            elif ev_set == "explicit":
                # if explicit and we didn't have 'sim' (or was lower), set 100
                if entry["similarity"] is None or entry["similarity"] < 100:
                    entry["similarity"] = 100

            # Max score
            if isinstance(e.get("score"), (int, float)):
                if entry["score"] is None or e["score"] > entry["score"]:
                    entry["score"] = e["score"]

            # Union overlaps
            entry["tags_overlap"] = sorted(set(entry["tags_overlap"]) | set(tags_overlap))
            entry["project_overlap"] = sorted(set(entry["project_overlap"]) | set(proj_overlap))

        merged[key] = entry

        # --- Directionality (only for explicit evidence) ------------------------
        directed = False
        direction_info = "undirected"

        # If there are reasons or explicit evidence
        if "explicit" in entry.get("evidence", set()):
            reasons_lower = [r.lower() for r in entry.get("reasons", [])]
            if any("enllaça a" in r for r in reasons_lower):
                directed = True
                direction_info = "source_to_target"
            elif any("enllaçat per" in r or "referenciat per" in r for r in reasons_lower):
                directed = True
                direction_info = "target_to_source"

        entry["directed"] = directed
        entry["direction_info"] = direction_info

    # 6) Build final edges
    for key, m in merged.items():
        m["evidence"] = sorted(list(m["evidence"]))
        # Decide line style: dashed only if EXCLUSIVELY AI
        m["dashes"] = (m["evidence"] == ["ai"])
        # If explicit+ai → solid line but keep reasons
        # Unique and clean reasons
        m["reasons"] = [r for r in dict.fromkeys([normalize_text(r) for r in m["reasons"]]) if r]
        # If no reasons, put a minimal informative one for "explicit"
        if not m["reasons"] and "explicit" in m["evidence"]:
            m["reasons"] = ["Explicit link between the two notes"]
        # Arrow if directional
        m["arrow"] = "end" if m.get("directed") else None
        new_edges.append(m)

    graph["edges"] = new_edges

    # 7) Prune by min similarity and Top-K per node
    meta_min = None
    meta_topk = None
    try:
        meta_min = int(graph.get("_meta", {}).get("min_similarity_kept"))
    except Exception:
        pass
    try:
        meta_topk = int(graph.get("_meta", {}).get("topk_per_node"))
    except Exception:
        pass

    if meta_min is not None or meta_topk is not None:
        # Index by "node key" (sort by id for stability)
        by_node = {}
        for e in graph["edges"]:
            # Treat edge as undirected for pruning (consistent with merge)
            a, b = sort_pair(e["source"], e["target"])
            by_node.setdefault(a, []).append(e)
            by_node.setdefault(b, []).append(e)

        def keep_edge(e):
            if meta_min is None:
                return True
            sim = e.get("similarity")
            try:
                return (sim is None) or (int(sim) >= meta_min)  # explicit ones can carry None
            except Exception:
                return True

        kept = []
        # 1) Filter by min similarity
        prelim = [e for e in graph["edges"] if keep_edge(e)]

        if meta_topk is None or meta_topk <= 0:
            kept = prelim
        else:
            # 2) Top-K per node (by similarity desc; explicit with None at the end)
            def score_of(e):
                s = e.get("similarity")
                return (-1 if s is None else int(s))

            # For stability, do a global sort first
            prelim_sorted = sorted(prelim, key=lambda e: (score_of(e), e["source"], e["target"]), reverse=True)

            cap_count = {}  # (node_id -> how many edges it already has)
            def can_take(e):
                a, b = sort_pair(e["source"], e["target"])
                ca = cap_count.get(a, 0)
                cb = cap_count.get(b, 0)
                return (ca < meta_topk) or (cb < meta_topk)

            for e in prelim_sorted:
                a, b = sort_pair(e["source"], e["target"])
                if can_take(e):
                    kept.append(e)
                    cap_count[a] = cap_count.get(a, 0) + 1
                    cap_count[b] = cap_count.get(b, 0) + 1

        graph["edges"] = kept

    directed_count = sum(1 for e in new_edges if e.get("directed"))
    log.info(f"📈 {directed_count} directional edges inferred from {len(new_edges)} total.")

    return graph

# -----------------------------------------------------------------------------
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Force layout recalculation")
    args = parser.parse_args()
    
    process(force_layout=args.force)
