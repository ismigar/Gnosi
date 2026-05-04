# ──────────────────────────────────────────────────────────────────────────────
# 🔍 Graph JSON Sanitization Module
# ──────────────────────────────────────────────────────────────────────────────
import math
from datetime import datetime
from typing import Any, Union
from config.logger_config import get_logger
import json

log = get_logger(__name__)

def sanitize_json_graph(data: Any, path: str = "") -> str:
    """
    Sanitize JSON data structure:
      1. Clean invalid values (NaN, Infinity, None, quotes, newlines).
      2. Remove objects with invalid critical fields (id, source, target, label).
      3. Display summary in Streamlit (if enabled).
      4. Save full trace to log file.
    """
    issues, removed = [], []
    CRITICAL_KEYS = {"id", "source", "target", "label"}

    def is_invalid(v: Any) -> bool:
        return (
            v is None
            or (isinstance(v, float) and (math.isnan(v) or math.isinf(v)))
            or (isinstance(v, str) and ('"' in v or "\n" in v))
        )

    def clean_value(v: Any, p: str) -> Union[Any, None]:
        if isinstance(v, dict):
            new_dict = {}
            invalid_critical = False
            for k, vv in v.items():
                if is_invalid(vv):
                    issues.append(f"{p}.{k} = {vv}")
                    if k in CRITICAL_KEYS:
                        invalid_critical = True
                    continue
                cleaned = clean_value(vv, f"{p}.{k}" if p else k)
                if cleaned is not None:
                    new_dict[k] = cleaned
            if invalid_critical:
                removed.append(f"{p} (invalid critical field)")
                return None
            return new_dict if new_dict else None

        elif isinstance(v, list):
            new_list = []
            for idx, i in enumerate(v):
                cleaned = clean_value(i, f"{p}[{idx}]")
                if cleaned is not None:
                    new_list.append(cleaned)
                else:
                    removed.append(f"{p}[{idx}] removed (invalid object)")
            return new_list if new_list else None

        elif is_invalid(v):
            issues.append(f"{p} = {v}")
            return None
        elif isinstance(v, str):
            return v.replace('"', '\\"').replace("\n", " ")
        else:
            return v

    safe_data = clean_value(data, path)

    # ── Write sanitization report to log ──────────────────────
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    log.info(f"\n=== JSON Sanitize Report — {timestamp} ===\n")
    if issues:
        log.info(f"Cleaned fields ({len(issues)}):\n")
        for i in issues:
            log.info(f"  - {i}\n")
    if removed:
        log.info(f"Removed objects ({len(removed)}):\n")
        for r in removed:
            log.info(f"  - {r}\n")
    if not (issues or removed):
        log.info("No anomalies detected.\n")
    log.info("=" * 60 + "\n")

    try:
        return json.dumps(safe_data, ensure_ascii=False)
    except Exception as e:
        log.error(f"❌ Error serializing JSON: {e}")
        return "{}"
