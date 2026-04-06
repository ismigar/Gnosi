# pipeline/config/graph_styles.py

from typing import Optional
from config.app_config import load_params
from config.logger_config import get_logger

cfg = load_params(strict_env=False)
C = cfg.colors
log = get_logger(__name__)

# — Load color palette from params.yaml —
COLOR_BY_TYPE = C["node_types"]
COLOR_DEFAULT = COLOR_BY_TYPE.get("default", {"bg": "#ccc", "border": "#999", "font": "#111"})
NOTION_COLOR_MAP = C["notion_color_map"]

SIM_BUCKETS = C["edges"]["similarity_buckets"]
EXPLICIT_EDGE_COLOR = C["edges"]["explicit_color"]
DIRECT_CONNECTION = C["edges"]["direct_color"]
DEFAULT_INFERRED_EDGE_COLOR = C["edges"]["default_inferred_color"]
INFERRED_EDGE_DASHED = C["edges"]["inferred_dashed"]


def notion_color_to_hex(color_name: str) -> str:
    if not color_name:
        return "#999999"
    return NOTION_COLOR_MAP.get(color_name.lower().replace("_background", ""), "#999999")


def node_colors(ntype: str):
    return COLOR_BY_TYPE.get(ntype, COLOR_DEFAULT)


def edge_color_for_similarity(sim: Optional[int]):
    try:
        s = int(sim or 0)
    except Exception:
        s = 0
    for b in SIM_BUCKETS:
        if s >= b["min"]:
            return b["color"], b["label"]
    return DEFAULT_INFERRED_EDGE_COLOR, "very weak"


def edge_style_by_evidence_and_similarity(evidence, similarity=None):
    evset = set(e.lower() for e in (evidence or []) if isinstance(e, str))
    sim = similarity or 0

    if "explicit" in evset:
        return {"color": EXPLICIT_EDGE_COLOR, "dashes": False}

    if evset == {"tags"}:
        return {"color": C["edges"].get("tag_edge_color", "#4d22b3"), "dashes": False}

    if "tags_inferred" in evset or "ai" in evset:
        for b in SIM_BUCKETS:
            if sim >= b["min"]:
                return {"color": b["color"], "dashes": True}
        return {"color": DEFAULT_INFERRED_EDGE_COLOR, "dashes": True}

    if {"explicit", "ai"} <= evset or {"explicit", "tags_inferred"} <= evset:
        for b in SIM_BUCKETS:
            if sim >= b["min"]:
                return {"color": b["color"], "dashes": False}
        return {"color": EXPLICIT_EDGE_COLOR, "dashes": False}

    return {"color": DEFAULT_INFERRED_EDGE_COLOR, "dashes": False}
