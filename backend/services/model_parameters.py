"""Bounded official-source parameter refresh; no guesses from model names."""
from __future__ import annotations

import json
import math
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests

from backend.config.data_dir import resolve_data_dir
from backend.services.model_parameter_seed import CHECKED_AT, PUBLISHED, UNDISCLOSED

# Only manufacturer-controlled Hugging Face organizations are eligible.
AUTHORS = {
    "alibaba": "Qwen", "google": "google", "mistral": "mistralai",
    "deepseek": "deepseek-ai", "meta": "meta-llama", "nvidia": "nvidia",
    "moonshotai": "moonshotai", "zai": "zai-org", "openai": "openai",
    "allenai": "allenai", "microsoft": "microsoft", "cohere": "CohereForAI",
}
ALIASES = {"qwen": "alibaba", "alibabacloud": "alibaba", "googledeepmind": "google",
           "mistralai": "mistral", "moonshot": "moonshotai", "zhipuai": "zai", "zhipu": "zai"}
_EFFORT = r"\s*\((?:non-reasoning|reasoning|non-thinking|thinking|low|medium|high|xhigh|max)\)$"


def normalized(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def creator_key(value: str) -> str:
    value = normalized(value)
    return ALIASES.get(value, value)


def base_name(value: str) -> str:
    return re.sub(_EFFORT, "", value.split("/")[-1], flags=re.I)


def model_key(model: dict[str, Any]) -> str:
    return creator_key(str(model.get("creator", ""))) + ":" + normalized(base_name(str(model.get("name", ""))))


def cache_path() -> Path:
    return resolve_data_dir() / "cache" / "model_parameters.json"


def read_cache(path: Path | None = None) -> dict[str, Any]:
    try:
        value = json.loads((path or cache_path()).read_text(encoding="utf-8"))
        return value if isinstance(value, dict) and isinstance(value.get("entries"), dict) else {"entries": {}}
    except (OSError, ValueError):
        return {"entries": {}}


def write_cache(value: dict[str, Any], path: Path | None = None) -> None:
    target = path or cache_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    from filelock import FileLock
    with FileLock(str(target) + ".lock", timeout=30):
        latest = read_cache(target)
        merged = dict(latest.get("entries", {}))
        for key, entry in value.get("entries", {}).items():
            old = merged.get(key, {})
            # A stale scheduled batch cannot overwrite a later explicit review.
            if str(entry.get("checked_at") or "") >= str(old.get("checked_at") or ""):
                merged[key] = entry
        value = {**value, "entries": merged}
        fd, name = tempfile.mkstemp(prefix=".model-parameters-", dir=target.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(value, stream, ensure_ascii=False, allow_nan=False)
            os.replace(name, target)
        finally:
            if os.path.exists(name):
                os.unlink(name)


def valid_counts(value: dict[str, Any]) -> bool:
    total, active = value.get("total"), value.get("active")
    return (isinstance(total, (int, float)) and not isinstance(total, bool)
            and math.isfinite(total) and 0 < total < 1_000_000
            and (active is None or (isinstance(active, (int, float)) and not isinstance(active, bool)
                 and math.isfinite(active) and 0 < active <= total)))


def metadata(model: dict[str, Any], cache: dict[str, Any]) -> dict[str, Any]:
    entry = cache.get("entries", {}).get(model_key(model), {})
    if isinstance(entry, dict) and entry.get("status") == "not_published" and entry.get("source") and entry.get("verification") == "user_review":
        return {k: entry[k] for k in ("status", "source", "checked_at", "verification") if k in entry}
    if isinstance(entry, dict) and entry.get("status") == "known" and valid_counts(entry):
        return {k: entry[k] for k in ("status", "total", "active", "source", "checked_at", "verification") if k in entry}
    names = {normalized(base_name(str(model.get(field, "")))) for field in ("name", "slug")}
    creator = creator_key(str(model.get("creator", "")))
    for seed in PUBLISHED:
        if creator_key(seed["creator"]) == creator and any(normalized(n) in names for n in seed["names"]):
            return {"status": "known", "checked_at": CHECKED_AT,
                    **{k: seed[k] for k in ("total", "active", "source") if k in seed}}
    closed_name = normalized(re.sub(r"\s*\([^)]*\)$", "", str(model.get("name", ""))))
    for disclosure in UNDISCLOSED:
        if creator_key(disclosure["creator"]) == creator and closed_name in map(normalized, disclosure["names"]):
            return {"status": "not_published", "source": disclosure["source"], "checked_at": CHECKED_AT}
    return {"status": "pending"}


def enrich_comparison(feed: dict[str, Any]) -> dict[str, Any]:
    cache = read_cache()
    return {**feed, "models": [{**model, "parameter_metadata": metadata(model, cache)}
                              for model in feed.get("models", [])]}


def _billions(number: str, unit: str) -> float:
    return float(number.replace(",", ".")) * {"m": .001, "b": 1, "t": 1000}[unit.lower()[0]]


def parse_card(text: str, repo: str) -> dict[str, float] | None:
    """Only explicit count fields or the exact model's table row, not benchmarks."""
    text = text.replace("**", "").replace("__", "")
    number = r"([0-9]+(?:[.,][0-9]+)?)\s*(B|M|T|billion|million|trillion)\b"
    result: dict[str, float] = {}
    match = re.search(r"(?:Number of Parameters|Total Parameters)\s*[:|]\s*" + number, text, re.I)
    if match:
        result["total"] = _billions(match[1], match[2])
        line = text[match.start():].splitlines()[0]
        active = re.search(number + r"\s*(?:activated|active)", line, re.I)
        if active:
            result["active"] = _billions(active[1], active[2])
        active = re.search(r"(?:Activated|Active) Parameters\s*[:|]\s*" + number, text, re.I)
        if active:
            result["active"] = _billions(active[1], active[2])
    if not result:
        for line in text.splitlines():
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            if len(cells) < 3 or normalized(cells[0]) != normalized(repo.split("/")[-1]):
                continue
            total = re.fullmatch(number, cells[1], re.I)
            active = re.fullmatch(number, cells[2], re.I)
            if total and active:
                result = {"total": _billions(total[1], total[2]), "active": _billions(active[1], active[2])}
    return result if valid_counts(result) else None


def _get(url: str, *, params: dict[str, Any] | None = None) -> bytes:
    # URLs are constructed here from pinned official authors, never supplied by cards.
    with requests.get(url, params=params, timeout=(4, 8), allow_redirects=False, stream=True) as response:
        response.raise_for_status()
        if response.status_code != 200:
            raise ValueError("Unexpected source response")
        chunks, size = [], 0
        for chunk in response.iter_content(8192):
            size += len(chunk)
            if size > 2_000_000:
                raise ValueError("Official model card exceeds size limit")
            chunks.append(chunk)
        return b"".join(chunks)


def _identity(value: str) -> str:
    # Instruction-tuning suffixes are allowed; version/date/size suffixes are preserved.
    return normalized(re.sub(r"(?:[- ](?:instruct|it))$", "", base_name(value), flags=re.I))


def discover(model: dict[str, Any], author: str) -> dict[str, Any] | None:
    name = base_name(str(model.get("name", "")))
    candidates = json.loads(_get("https://huggingface.co/api/models", params={
        "author": author, "search": re.sub(r"\s+", "-", name), "limit": 20,
    }))
    identities = {_identity(str(model.get(field, ""))) for field in ("name", "slug")}
    matches = []
    for candidate in candidates if isinstance(candidates, list) else []:
        if not isinstance(candidate, dict):
            continue
        repo = str(candidate.get("id", ""))
        if (re.fullmatch(r"[\w.-]+/[\w.-]+", repo) and repo.split("/")[0] == author
                and _identity(repo) in identities):
            matches.append(repo)
    # Ambiguous versions require review; never select the first similar result.
    if len(matches) != 1:
        return None
    repo = matches[0]
    card = _get(f"https://huggingface.co/{quote(repo, safe='/')}/raw/main/README.md").decode("utf-8")
    counts = parse_card(card, repo)
    return {**counts, "source": f"https://huggingface.co/{repo}"} if counts else None


def refresh_parameters(*, models: list[dict[str, Any]] | None = None,
                       path: Path | None = None, max_models: int = 40,
                       budget_seconds: float = 120) -> dict[str, Any]:
    if models is None:
        from backend.services.artificial_analysis import _read_cache, fetch_all_models
        feed = _read_cache() or fetch_all_models()
        models = feed.get("models", [])
    cache = read_cache(path)
    entries = cache["entries"]
    unique = {model_key(model): model for model in models}
    now = datetime.now(timezone.utc).isoformat()
    deadline = time.monotonic() + budget_seconds
    attempted = updated = failed = 0
    ordered = sorted(unique)
    cursor = cache.get("cursor", "")
    ordered = [key for key in ordered if key > cursor] + [key for key in ordered if key <= cursor]
    for key in ordered:
        if attempted >= max_models or time.monotonic() >= deadline:
            break
        model = unique[key]
        author = AUTHORS.get(creator_key(str(model.get("creator", ""))))
        if not author:
            continue
        attempted += 1
        cache["cursor"] = key
        previous = metadata(model, cache)
        try:
            found = discover(model, author)
            if found:
                entries[key] = {**found, "status": "known", "checked_at": now}
                updated += 1
            else:
                entries[key] = {**previous, "attempted_at": now, "reason": "needs_review"}
        except (requests.RequestException, ValueError, KeyError, TypeError):
            failed += 1
            entries[key] = {**previous, "attempted_at": now, "reason": "source_unavailable"}
    cache["last_run"] = now
    write_cache(cache, path)
    return {"success": failed < attempted or attempted == 0, "attempted": attempted,
            "verified": updated, "source_errors": failed,
            "pending": sum(metadata(model, cache)["status"] == "pending" for model in unique.values()),
            "message": "Official parameter sources checked; unmatched models remain pending review."}
