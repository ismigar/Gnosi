"""Mutable request-local state for one agent event stream."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from backend.agent.model_router import model_cost_rates


@dataclass
class AgentStreamState:
    request_started_at: float
    workflow_ready_at: float
    llm_selection: Dict[str, Any]
    turn_plan: Dict[str, Any]
    trace_id: str
    answer_count: int = 0
    total_in_tok: int = 0
    total_out_tok: int = 0
    usage_recorded: bool = False
    metrics_emitted: bool = False
    model_calls: int = 0
    tool_calls_count: int = 0
    last_phase: str = ""
    deadline_warned: bool = False
    stream_failed: bool = False
    phase_ms: Dict[str, float] = field(
        default_factory=lambda: {"routing": 0.0, "model": 0.0, "tools": 0.0}
    )
    active_tool_names: set[str] = field(default_factory=set)
    used_tool_names: set[str] = field(default_factory=set)
    quality_plan: Dict[str, Any] = field(init=False)
    quality_verification: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.quality_plan = dict(self.turn_plan)

    @staticmethod
    def phase_for_node(node_name: str) -> str:
        if node_name in {"brain_tools", "coder_tools"}:
            return "tools"
        if node_name in {"brain", "coder", "general"}:
            return "model"
        return "routing"

    def phase_event(self, phase: str) -> Optional[str]:
        normalized = str(phase or "routing").strip().lower()
        if normalized == self.last_phase:
            return None
        self.last_phase = normalized
        return json.dumps({"type": "phase", "trace_id": self.trace_id, "phase": normalized}) + "\n"

    def metrics_payload(self) -> Dict[str, Any]:
        total_ms = max(0, int((time.monotonic() - self.request_started_at) * 1000))
        setup_ms = max(0, int((self.workflow_ready_at - self.request_started_at) * 1000))
        routing_ms = max(0, int(self.phase_ms["routing"]))
        model_ms = max(0, int(self.phase_ms["model"]))
        tools_ms = max(0, int(self.phase_ms["tools"]))
        other_ms = max(0, total_ms - setup_ms - routing_ms - model_ms - tools_ms)
        input_rate, output_rate = model_cost_rates(
            str((self.llm_selection or {}).get("provider") or ""),
            str((self.llm_selection or {}).get("model") or ""),
        )
        budgets = self.turn_plan.get("budgets") or {}
        return {
            "type": "turn_metrics",
            "trace_id": self.trace_id,
            "setup_ms": setup_ms,
            "routing_ms": routing_ms,
            "model_ms": model_ms,
            "tools_ms": tools_ms,
            "other_ms": other_ms,
            "total_ms": total_ms,
            "input_tokens": self.total_in_tok,
            "output_tokens": self.total_out_tok,
            "estimated_cost_usd": round(
                (self.total_in_tok * input_rate + self.total_out_tok * output_rate) / 1_000_000,
                6,
            ),
            "model_calls": self.model_calls,
            "tool_calls": self.tool_calls_count,
            "budget": dict(budgets),
            "budget_exhausted": {
                "model_calls": bool(
                    budgets.get("max_model_calls")
                    and self.model_calls >= int(budgets["max_model_calls"])
                ),
                "tool_calls": bool(
                    budgets.get("max_tool_calls")
                    and self.tool_calls_count >= int(budgets["max_tool_calls"])
                ),
            },
        }
