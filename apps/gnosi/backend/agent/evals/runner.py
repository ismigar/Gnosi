"""Run the deterministic universal-turn evaluation corpus."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Iterable

from backend.agent.factory import build_agent_turn_plan


CASES_PATH = Path(__file__).with_name("universal_turns.json")
DEFAULT_TOOL_METADATA = [
    {"name": "inventory_context", "effects": ["read"], "confirmation": "none", "dynamic_context": True},
    {"name": "read_context_source", "effects": ["read"], "confirmation": "none", "dynamic_context": True},
    {"name": "inspect_reader_context", "effects": ["read", "personal_data"], "confirmation": "none", "dynamic_context": True},
    {"name": "start_reader_context_analysis", "effects": ["local_write", "ai_cost"], "confirmation": "explicit_request", "dynamic_context": True},
    {"name": "get_weather", "effects": ["read", "external_read"], "confirmation": "none"},
    {"name": "send_mail", "effects": ["external_write", "personal_data"], "confirmation": "always"},
    {"name": "delete_page", "effects": ["local_write", "destructive"], "confirmation": "always"},
    {"name": "search_notion", "effects": ["read", "external_read"], "confirmation": "none"},
    {"name": "web_search", "effects": ["read", "external_read"], "confirmation": "none"},
    {"name": "search_contacts", "effects": ["read", "personal_data"], "confirmation": "none"},
]


def load_cases(path: Path = CASES_PATH) -> list[dict[str, Any]]:
    """Load and minimally validate the public deterministic corpus."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list) or not payload:
        raise ValueError("Agent evaluation corpus must be a non-empty list.")
    identifiers = set()
    for case in payload:
        if not isinstance(case, dict) or not case.get("id") or not case.get("message"):
            raise ValueError("Every agent evaluation case needs an id and message.")
        if case["id"] in identifiers:
            raise ValueError(f"Duplicate agent evaluation id: {case['id']}")
        identifiers.add(case["id"])
    return payload


def _nested(payload: dict[str, Any], path: str) -> Any:
    value: Any = payload
    for part in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def evaluate_case(case: dict[str, Any]) -> dict[str, Any]:
    """Evaluate one request without constructing or calling a model."""
    plan = build_agent_turn_plan(
        case["message"],
        context_refs=case.get("context_refs") or [],
        tool_metadata=DEFAULT_TOOL_METADATA,
        authorized_tool_names=case.get("authorized_tool_names") or [],
        provider=case.get("provider") or "",
    )
    failures = []
    expected = dict(case.get("expected") or {})
    allowed = set(plan.get("allowed_tool_names") or [])
    for key, wanted in expected.items():
        if key == "allowed_contains":
            missing = sorted(set(wanted or []).difference(allowed))
            if missing:
                failures.append({"field": key, "expected": wanted, "actual": sorted(allowed), "missing": missing})
        elif key == "allowed_excludes":
            present = sorted(set(wanted or []).intersection(allowed))
            if present:
                failures.append({"field": key, "expected": wanted, "actual": sorted(allowed), "present": present})
        elif key == "domains_contains":
            actual = set(plan.get("domains") or [])
            missing = sorted(set(wanted or []).difference(actual))
            if missing:
                failures.append({"field": key, "expected": wanted, "actual": sorted(actual), "missing": missing})
        else:
            actual = _nested(plan, key)
            if actual != wanted:
                failures.append({"field": key, "expected": wanted, "actual": actual})
    return {
        "id": case["id"],
        "passed": not failures,
        "failures": failures,
        "plan": {
            "mode": plan.get("mode"),
            "domains": plan.get("domains"),
            "route": plan.get("route"),
            "execution": plan.get("execution"),
            "required_tool": plan.get("required_tool"),
            "allowed_tool_names": plan.get("allowed_tool_names"),
            "privacy": plan.get("privacy"),
        },
    }


def run_evaluations(cases: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Return score and failure details for a bounded corpus."""
    results = [evaluate_case(case) for case in cases]
    passed = sum(result["passed"] for result in results)
    total = len(results)
    return {
        "schema_version": 1,
        "suite": "universal-agent-turns",
        "passed": passed,
        "total": total,
        "score": round(passed / total, 4) if total else 0.0,
        "results": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", default="", help="Run only one case id.")
    parser.add_argument("--compact", action="store_true", help="Omit passing case details.")
    args = parser.parse_args()
    cases = load_cases()
    if args.case:
        cases = [case for case in cases if case["id"] == args.case]
        if not cases:
            raise SystemExit(f"Unknown evaluation case: {args.case}")
    report = run_evaluations(cases)
    if args.compact:
        report["results"] = [item for item in report["results"] if not item["passed"]]
    sys.stdout.write(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    return 0 if report["passed"] == report["total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
