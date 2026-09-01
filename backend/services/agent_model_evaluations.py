"""Explicit privacy-safe evaluations for configured agent models."""

from __future__ import annotations

import json
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

from backend.config.data_dir import resolve_data_dir
from backend.services.agent_model_strategy import route_key


EVALUATION_CASES = (
    {"id": "concise_en", "prompt": "Reply with exactly the word READY.", "expected": "ready"},
    {"id": "concise_ca", "prompt": "Respon exactament amb la paraula PREPARAT.", "expected": "preparat"},
    {"id": "structured", "prompt": 'Return only this JSON object: {"status":"ok"}', "expected": '"status"'},
)


def _path() -> Path:
    root = resolve_data_dir(create=True)
    return root / "agent_model_evaluations.sqlite"


def _connect() -> sqlite3.Connection:
    path = _path()
    from backend.migrations.runner import (
        data_dir_for_database,
        ensure_database_schema_once,
    )

    ensure_database_schema_once(path, "model_evaluations", data_dir_for_database(path))
    connection = sqlite3.connect(path, timeout=30)
    connection.row_factory = sqlite3.Row
    return connection


def evaluate_with_invoker(
    provider: str,
    model: str,
    agent_id: str,
    invoker: Callable[[str], Any],
    *,
    cases: Iterable[dict[str, str]] = EVALUATION_CASES,
) -> dict[str, Any]:
    """Run synthetic cases and persist metadata only, never responses or prompts."""
    passed = 0
    total = 0
    failures = []
    input_tokens = 0
    output_tokens = 0
    started = time.monotonic()
    for case in cases:
        total += 1
        try:
            response = invoker(case["prompt"])
            content = str(getattr(response, "content", response) or "").strip().lower()
            usage = getattr(response, "usage_metadata", None) or {}
            input_tokens += int(usage.get("input_tokens") or 0)
            output_tokens += int(usage.get("output_tokens") or 0)
            if case["expected"] in content:
                passed += 1
            else:
                failures.append(f"{case['id']}:contract_mismatch")
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{case['id']}:{type(exc).__name__}")
    latency_ms = max(0, int((time.monotonic() - started) * 1000))
    score = round(passed / total, 4) if total else 0.0
    from backend.agent.model_router import model_cost_rates

    input_rate, output_rate = model_cost_rates(provider, model)
    estimated_cost_usd = round(
        (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000,
        8,
    )
    created_at = datetime.now(timezone.utc).isoformat()
    with _connect() as connection:
        cursor = connection.execute(
            """INSERT INTO model_evaluations
            (provider, model, agent_id, score, passed, total, latency_ms,
             input_tokens, output_tokens, estimated_cost_usd, failure_codes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(provider)[:64], str(model)[:192], str(agent_id)[:128], score,
                passed, total, latency_ms, input_tokens, output_tokens,
                estimated_cost_usd,
                json.dumps(failures[:12]), created_at,
            ),
        )
        if cursor.lastrowid is None:
            raise RuntimeError("Model evaluation insert did not return an identifier")
        evaluation_id = cursor.lastrowid
    return {
        "evaluation_id": evaluation_id,
        "provider": provider,
        "model": model,
        "agent_id": agent_id,
        "score": score,
        "passed": passed,
        "total": total,
        "latency_ms": latency_ms,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "estimated_cost_usd": estimated_cost_usd,
        "failure_codes": failures[:12],
        "created_at": created_at,
        "privacy": "synthetic_prompts_metadata_only",
    }


def list_evaluations(limit: int = 50) -> list[dict[str, Any]]:
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM model_evaluations ORDER BY created_at DESC LIMIT ?",
            (max(1, min(int(limit), 200)),),
        ).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        item["failure_codes"] = json.loads(item.get("failure_codes") or "[]")
        result.append(item)
    return result


def quality_scores() -> dict[str, float]:
    """Return the latest reviewed score per model route for adaptive routing."""
    scores: dict[str, float] = {}
    for row in list_evaluations(200):
        key = route_key(row.get("provider"), row.get("model"))
        scores.setdefault(key, float(row.get("score") or 0.0))
    return scores
