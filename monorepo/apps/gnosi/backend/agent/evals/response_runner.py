"""Run deterministic final-response quality evaluations without a model."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Iterable

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from backend.agent.turn_contract import verify_response


CASES_PATH = Path(__file__).with_name("response_quality.json")


def load_response_cases(path: Path = CASES_PATH) -> list[dict[str, Any]]:
    """Load and validate the provider-free response corpus."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list) or not payload:
        raise ValueError("Response evaluation corpus must be a non-empty list.")
    identifiers = [str(case.get("id") or "") for case in payload if isinstance(case, dict)]
    if len(identifiers) != len(payload) or any(not value for value in identifiers):
        raise ValueError("Every response evaluation case needs an id.")
    if len(set(identifiers)) != len(identifiers):
        raise ValueError("Response evaluation ids must be unique.")
    return payload


def _nested(payload: dict[str, Any], path: str) -> Any:
    value: Any = payload
    for part in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def evaluate_response_case(case: dict[str, Any]) -> dict[str, Any]:
    """Verify one synthetic answer and compare its public quality metadata."""
    messages: list[Any] = [HumanMessage(content="Synthetic private-free request")]
    for index, tool in enumerate(case.get("tools") or []):
        messages.append(ToolMessage(
            content=json.dumps(tool.get("payload") or {}, ensure_ascii=False),
            name=str(tool.get("name") or f"tool-{index + 1}"),
            tool_call_id=f"call-{index + 1}",
            status=str(tool.get("status") or "success"),
        ))
    result = verify_response(
        AIMessage(content=str(case.get("response") or "")),
        messages=messages,
        plan=case.get("plan") or {},
    )
    metadata = dict(result.additional_kwargs or {})
    public = {
        "verification": metadata.get("gnosi_verification") or {},
        "citations": metadata.get("gnosi_citations") or {},
        "quality": metadata.get("gnosi_quality") or {},
        "conflicts": metadata.get("gnosi_conflicts") or {},
    }
    failures = []
    for field, expected in (case.get("expected") or {}).items():
        actual = _nested(public, field)
        if actual != expected:
            failures.append({"field": field, "expected": expected, "actual": actual})
    return {"id": case["id"], "passed": not failures, "failures": failures, **public}


def run_response_evaluations(cases: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Return an exact score for the final-response corpus."""
    results = [evaluate_response_case(case) for case in cases]
    passed = sum(result["passed"] for result in results)
    return {
        "schema_version": 1,
        "suite": "universal-agent-responses",
        "passed": passed,
        "total": len(results),
        "score": round(passed / len(results), 4) if results else 0.0,
        "results": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-score", type=float, default=1.0)
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args()
    report = run_response_evaluations(load_response_cases())
    if args.compact:
        report["results"] = [item for item in report["results"] if not item["passed"]]
    sys.stdout.write(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    return 0 if report["score"] >= max(0.0, min(args.min_score, 1.0)) else 1


if __name__ == "__main__":
    raise SystemExit(main())
