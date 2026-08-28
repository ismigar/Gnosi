"""Privacy-safe agent quality signals and reviewable evaluation candidates."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, Optional

from backend.config.data_dir import resolve_data_dir


RETENTION_SECONDS = 180 * 24 * 60 * 60
MAX_EVENTS_PER_USER = 2_000
REVIEW_STATES = {"pending_review", "accepted", "rejected"}


def _database_path() -> Path:
    root = resolve_data_dir(create=True)
    return root / "agent_quality.sqlite"


def _restrict_permissions(path: Path) -> None:
    for candidate in (path, Path(f"{path}-wal"), Path(f"{path}-shm")):
        if not candidate.exists():
            continue
        try:
            os.chmod(candidate, 0o600)
        except OSError:
            continue


def _connect() -> sqlite3.Connection:
    path = _database_path()
    from backend.migrations.runner import (
        data_dir_for_database,
        ensure_database_schema_once,
    )

    ensure_database_schema_once(path, "quality_telemetry", data_dir_for_database(path))
    connection = sqlite3.connect(str(path), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=10000")
    _restrict_permissions(path)
    cutoff = time.time() - RETENTION_SECONDS
    connection.execute(
        "DELETE FROM agent_quality_events WHERE updated_at <= ?", (cutoff,)
    )
    connection.commit()
    return connection


@contextmanager
def _database_connection() -> Iterator[sqlite3.Connection]:
    connection = _connect()
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def _bounded(value: Any, limit: int = 128) -> str:
    return " ".join(str(value or "").split())[:limit]


def _bounded_list(value: Any, *, items: int, chars: int) -> list[str]:
    if not isinstance(value, (list, tuple, set)):
        return []
    result = []
    seen = set()
    for raw in value:
        item = _bounded(raw, chars)
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
        if len(result) >= items:
            break
    return result


def _scope(scope: Dict[str, str]) -> Dict[str, str]:
    normalized = {
        key: _bounded(scope.get(key), 256)
        for key in ("vault_scope", "workspace_id", "user_id")
    }
    if any(not value for value in normalized.values()):
        raise ValueError("Agent quality telemetry scope is incomplete.")
    return normalized


def _hash_identity(scope: Dict[str, str], kind: str, value: str) -> str:
    raw = ":".join((
        scope["vault_scope"],
        scope["workspace_id"],
        scope["user_id"],
        kind,
        str(value or ""),
    ))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def _duration_bucket(duration_ms: Any) -> str:
    try:
        value = max(0, int(duration_ms or 0))
    except (TypeError, ValueError):
        value = 0
    if value >= 60_000:
        return "timeout_range"
    if value >= 15_000:
        return "slow"
    if value >= 2_000:
        return "moderate"
    return "fast"


def _safe_context_refs(domains: list[str], required_tool: str) -> list[dict[str, str]]:
    if "reader" in domains or required_tool.startswith("start_reader_"):
        return [{"id": "reader", "type": "internal", "ref": "reader"}]
    if "vault" in domains or "context" in required_tool:
        return [{"id": "vault", "type": "vault", "ref": "active-vault"}]
    return []


def _synthetic_message(mode: str, domains: list[str], required_tool: str) -> str:
    primary = domains[0] if domains else ""
    if mode == "conversation":
        return "Hello, how can you help?"
    if mode == "action":
        if "mail" in domains or "mail" in required_tool:
            return "Send this email now."
        if "delete" in required_tool:
            return "Delete this page."
        return "Create this item now."
    if mode == "inventory":
        if primary == "reader" or "reader" in required_tool:
            return "List all Reader articles in the attached source."
        return "List all records in the attached Vault."
    if mode == "lookup":
        messages = {
            "weather": "What is the weather forecast for Barcelona?",
            "mail": "Find the latest email from the selected contact.",
            "calendar": "Find today's calendar events.",
            "contacts": "Find the selected contact.",
            "web": "Search the web for current accessibility guidance.",
            "notion": "Search Notion for the project brief.",
        }
        return messages.get(primary, "Find the requested information in the attached source.")
    if primary == "reader" or "reader" in required_tool:
        return "Analyze all Reader articles by topic and compare the trends."
    if primary == "vault" or "context" in required_tool:
        return "Analyze the attached Vault records and summarize their common themes."
    return "Explain photosynthesis simply."


def _candidate_payload(row: Dict[str, Any]) -> tuple[str, Dict[str, Any], Dict[str, Any]]:
    scenario = {
        key: row.get(key)
        for key in (
            "signal", "error_code", "language", "mode", "domains", "route",
            "execution", "output_strategy", "required_tool",
            "verification_status", "limitations", "tool_names", "duration_bucket",
        )
    }
    signature = hashlib.sha256(
        json.dumps(scenario, ensure_ascii=True, sort_keys=True).encode("utf-8")
    ).hexdigest()[:20]
    expected: Dict[str, Any] = {
        "mode": row["mode"],
        "route": row["route"],
        "execution": row["execution"],
    }
    if row["domains"]:
        expected["domains_contains"] = row["domains"]
    if row["required_tool"]:
        expected["required_tool"] = row["required_tool"]
    authorized = []
    if row["mode"] == "action" or row["required_tool"].startswith("start_"):
        authorized = [row["required_tool"]] if row["required_tool"] else []
    synthetic_case = {
        "id": f"telemetry-{signature}",
        "message": _synthetic_message(
            row["mode"], row["domains"], row["required_tool"]
        ),
        "provider": "ollama",
        "context_refs": _safe_context_refs(row["domains"], row["required_tool"]),
        "authorized_tool_names": authorized,
        "expected": expected,
        "runtime_expectations": {
            "must_not_repeat_error_code": row["error_code"] or None,
            "requires_claim_citations": row["mode"] in {"lookup", "inventory", "analysis"},
        },
    }
    return signature, scenario, synthetic_case


def _rebuild_candidates(connection: sqlite3.Connection, scope: Dict[str, str]) -> None:
    rows = connection.execute(
        """
        SELECT * FROM agent_quality_events
        WHERE vault_scope = ? AND workspace_id = ? AND user_id = ?
          AND (signal = 'error' OR (signal = 'feedback' AND rating = 'down'))
        ORDER BY created_at ASC
        """,
        (scope["vault_scope"], scope["workspace_id"], scope["user_id"]),
    ).fetchall()
    grouped: Dict[str, Dict[str, Any]] = {}
    for stored in rows:
        row = {
            "signal": stored["signal"],
            "error_code": stored["error_code"] or "",
            "language": stored["language"],
            "mode": stored["mode"],
            "domains": json.loads(stored["domains_json"]),
            "route": stored["route"],
            "execution": stored["execution"],
            "output_strategy": stored["output_strategy"],
            "required_tool": stored["required_tool"] or "",
            "verification_status": stored["verification_status"] or "",
            "limitations": json.loads(stored["limitations_json"]),
            "tool_names": json.loads(stored["tool_names_json"]),
            "duration_bucket": stored["duration_bucket"],
        }
        signature, scenario, synthetic_case = _candidate_payload(row)
        entry = grouped.setdefault(signature, {
            "count": 0,
            "first_seen": stored["created_at"],
            "last_seen": stored["updated_at"],
            "scenario": scenario,
            "synthetic_case": synthetic_case,
        })
        entry["count"] += 1
        entry["first_seen"] = min(entry["first_seen"], stored["created_at"])
        entry["last_seen"] = max(entry["last_seen"], stored["updated_at"])

    active_signatures = set(grouped)
    existing = connection.execute(
        """
        SELECT signature, review_status FROM agent_eval_candidates
        WHERE vault_scope = ? AND workspace_id = ? AND user_id = ?
        """,
        (scope["vault_scope"], scope["workspace_id"], scope["user_id"]),
    ).fetchall()
    for candidate in existing:
        if (
            candidate["signature"] not in active_signatures
            and candidate["review_status"] == "pending_review"
        ):
            connection.execute(
                """
                DELETE FROM agent_eval_candidates
                WHERE vault_scope = ? AND workspace_id = ? AND user_id = ?
                  AND signature = ?
                """,
                (*scope.values(), candidate["signature"]),
            )

    now = time.time()
    for signature, entry in grouped.items():
        candidate_id = f"eval-{signature}"
        connection.execute(
            """
            INSERT INTO agent_eval_candidates (
                id, vault_scope, workspace_id, user_id, signature,
                review_status, occurrence_count, first_seen, last_seen,
                scenario_json, synthetic_case_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'pending_review', ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(vault_scope, workspace_id, user_id, signature) DO UPDATE SET
                occurrence_count = excluded.occurrence_count,
                first_seen = excluded.first_seen,
                last_seen = excluded.last_seen,
                scenario_json = excluded.scenario_json,
                synthetic_case_json = excluded.synthetic_case_json,
                updated_at = excluded.updated_at
            """,
            (
                candidate_id,
                scope["vault_scope"], scope["workspace_id"], scope["user_id"],
                signature, entry["count"], entry["first_seen"], entry["last_seen"],
                json.dumps(entry["scenario"], ensure_ascii=False, separators=(",", ":")),
                json.dumps(entry["synthetic_case"], ensure_ascii=False, separators=(",", ":")),
                now, now,
            ),
        )


def record_quality_signal(
    scope: Dict[str, str],
    *,
    agent_id: str,
    session_id: str,
    turn_id: str,
    signal: str,
    rating: str = "",
    error_code: str = "",
    language: str = "en",
    mode: str = "analysis",
    domains: Any = (),
    route: str = "General",
    execution: str = "foreground",
    output_strategy: str = "model_synthesis",
    required_tool: str = "",
    verification_status: str = "",
    limitations: Any = (),
    tool_names: Any = (),
    duration_ms: int = 0,
) -> str:
    """Upsert one metadata-only signal and rebuild deduplicated candidates."""
    safe_scope = _scope(scope)
    normalized_signal = _bounded(signal, 32).lower()
    normalized_rating = _bounded(rating, 16).lower()
    if normalized_signal not in {"turn", "feedback", "error"}:
        raise ValueError("Unsupported agent quality signal.")
    if normalized_signal == "feedback" and normalized_rating not in {
        "up", "down", "clear"
    }:
        raise ValueError("Unsupported assistant feedback rating.")
    agent_hash = _hash_identity(safe_scope, "agent", agent_id)
    session_hash = _hash_identity(safe_scope, "session", session_id)
    turn_hash = _hash_identity(safe_scope, "turn", turn_id)
    event_key = _hash_identity(
        safe_scope,
        "event",
        (
            f"{normalized_signal}:{turn_hash}:{_bounded(error_code, 160)}"
            if normalized_signal == "error"
            else f"{normalized_signal}:{turn_hash}"
        ),
    )
    now = time.time()
    normalized_domains = _bounded_list(domains, items=12, chars=32)
    normalized_limitations = _bounded_list(limitations, items=8, chars=128)
    normalized_tools = _bounded_list(tool_names, items=16, chars=128)
    row = {
        "language": _bounded(language, 8) or "en",
        "mode": _bounded(mode, 32) or "analysis",
        "route": _bounded(route, 32) or "General",
        "execution": _bounded(execution, 32) or "foreground",
        "output_strategy": _bounded(output_strategy, 32) or "model_synthesis",
        "required_tool": _bounded(required_tool, 128),
        "verification_status": _bounded(verification_status, 32),
        "error_code": _bounded(error_code, 160),
    }
    with _database_connection() as connection:
        if normalized_signal == "feedback" and normalized_rating == "clear":
            connection.execute(
                "DELETE FROM agent_quality_events WHERE id = ?", (event_key,)
            )
        else:
            connection.execute(
                """
                INSERT INTO agent_quality_events (
                    id, vault_scope, workspace_id, user_id, agent_hash,
                    session_hash, turn_hash, signal, rating, error_code,
                    language, mode, domains_json, route, execution,
                    output_strategy, required_tool, verification_status,
                    limitations_json, tool_names_json, duration_bucket,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    rating = excluded.rating,
                    error_code = excluded.error_code,
                    language = excluded.language,
                    mode = excluded.mode,
                    domains_json = excluded.domains_json,
                    route = excluded.route,
                    execution = excluded.execution,
                    output_strategy = excluded.output_strategy,
                    required_tool = excluded.required_tool,
                    verification_status = excluded.verification_status,
                    limitations_json = excluded.limitations_json,
                    tool_names_json = excluded.tool_names_json,
                    duration_bucket = excluded.duration_bucket,
                    updated_at = excluded.updated_at
                """,
                (
                    event_key,
                    safe_scope["vault_scope"], safe_scope["workspace_id"],
                    safe_scope["user_id"], agent_hash, session_hash, turn_hash,
                    normalized_signal, normalized_rating or None,
                    row["error_code"] or None, row["language"], row["mode"],
                    json.dumps(normalized_domains, separators=(",", ":")),
                    row["route"], row["execution"], row["output_strategy"],
                    row["required_tool"] or None,
                    row["verification_status"] or None,
                    json.dumps(normalized_limitations, separators=(",", ":")),
                    json.dumps(normalized_tools, separators=(",", ":")),
                    _duration_bucket(duration_ms), now, now,
                ),
            )
        connection.execute(
            """
            DELETE FROM agent_quality_events WHERE id IN (
                SELECT id FROM agent_quality_events
                WHERE vault_scope = ? AND workspace_id = ? AND user_id = ?
                ORDER BY updated_at DESC LIMIT -1 OFFSET ?
            )
            """,
            (*safe_scope.values(), MAX_EVENTS_PER_USER),
        )
        _rebuild_candidates(connection, safe_scope)
    return event_key


def quality_dashboard(scope: Dict[str, str]) -> Dict[str, Any]:
    """Aggregate metadata-only service levels for the active user and Vault."""
    safe_scope = _scope(scope)
    with _database_connection() as connection:
        rows = connection.execute(
            """
            SELECT signal, rating, error_code, mode, verification_status,
                   duration_bucket, tool_names_json
            FROM agent_quality_events
            WHERE vault_scope = ? AND workspace_id = ? AND user_id = ?
            ORDER BY updated_at DESC LIMIT ?
            """,
            (*safe_scope.values(), MAX_EVENTS_PER_USER),
        ).fetchall()
        candidate_rows = connection.execute(
            """
            SELECT review_status, COUNT(*) AS count
            FROM agent_eval_candidates
            WHERE vault_scope = ? AND workspace_id = ? AND user_id = ?
            GROUP BY review_status
            """,
            tuple(safe_scope.values()),
        ).fetchall()

    def counts(field: str) -> Dict[str, int]:
        result: Dict[str, int] = {}
        for row in rows:
            value = str(row[field] or "unknown")[:128]
            result[value] = result.get(value, 0) + 1
        return result

    tool_counts: Dict[str, int] = {}
    for row in rows:
        try:
            names = json.loads(row["tool_names_json"] or "[]")
        except (TypeError, ValueError):
            names = []
        for name in names[:16]:
            safe_name = _bounded(name, 128)
            if safe_name:
                tool_counts[safe_name] = tool_counts.get(safe_name, 0) + 1
    ratings = {
        key: value
        for key, value in counts("rating").items()
        if key != "unknown"
    }
    return {
        "schema_version": 1,
        "event_count": len(rows),
        "completed_turns": sum(row["signal"] == "turn" for row in rows),
        "errors": sum(row["signal"] == "error" for row in rows),
        "signals": counts("signal"),
        "ratings": ratings,
        "modes": counts("mode"),
        "verification": counts("verification_status"),
        "latency_buckets": counts("duration_bucket"),
        "error_codes": {
            key: value
            for key, value in counts("error_code").items()
            if key != "unknown"
        },
        "top_tools": [
            {"tool_name": name, "uses": count}
            for name, count in sorted(
                tool_counts.items(), key=lambda item: (-item[1], item[0])
            )[:16]
        ],
        "evaluation_candidates": {
            str(row["review_status"]): int(row["count"])
            for row in candidate_rows
        },
    }


def list_evaluation_candidates(
    scope: Dict[str, str], *, limit: int = 200
) -> list[Dict[str, Any]]:
    safe_scope = _scope(scope)
    with _database_connection() as connection:
        rows = connection.execute(
            """
            SELECT * FROM agent_eval_candidates
            WHERE vault_scope = ? AND workspace_id = ? AND user_id = ?
            ORDER BY last_seen DESC LIMIT ?
            """,
            (*safe_scope.values(), max(1, min(int(limit), 500))),
        ).fetchall()
    return [{
        "id": row["id"],
        "review_status": row["review_status"],
        "occurrence_count": row["occurrence_count"],
        "first_seen": row["first_seen"],
        "last_seen": row["last_seen"],
        "scenario": json.loads(row["scenario_json"]),
        "synthetic_case": json.loads(row["synthetic_case_json"]),
    } for row in rows]


def review_evaluation_candidate(
    scope: Dict[str, str], candidate_id: str, decision: str
) -> Dict[str, Any]:
    safe_scope = _scope(scope)
    normalized_decision = _bounded(decision, 32).lower()
    if normalized_decision not in REVIEW_STATES:
        raise ValueError("Invalid evaluation candidate review decision.")
    with _database_connection() as connection:
        cursor = connection.execute(
            """
            UPDATE agent_eval_candidates SET review_status = ?, updated_at = ?
            WHERE id = ? AND vault_scope = ? AND workspace_id = ? AND user_id = ?
            """,
            (
                normalized_decision, time.time(), _bounded(candidate_id, 64),
                *safe_scope.values(),
            ),
        )
        if cursor.rowcount != 1:
            raise KeyError(candidate_id)
    return next(
        candidate
        for candidate in list_evaluation_candidates(safe_scope, limit=500)
        if candidate["id"] == candidate_id
    )


def reviewed_evaluation_cases(scope: Dict[str, str]) -> list[Dict[str, Any]]:
    """Return accepted, synthetic, corpus-compatible cases only."""
    return [
        candidate["synthetic_case"]
        for candidate in list_evaluation_candidates(scope, limit=500)
        if candidate["review_status"] == "accepted"
    ]
