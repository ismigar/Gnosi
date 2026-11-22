"""Mutable request-local state for one agent event stream."""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from backend.agent.model_router import model_cost_rates
from backend.services.agent_chat_timing import ChatTiming


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
    team_usage: Dict[str, Any] | None = None
    chat_timing: ChatTiming | None = None
    response_ms: int | None = None
    team_reply_streamed: bool = False
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

    def phase_event(self, phase: str) -> Optional[str]:
        normalized = str(phase or "routing").strip().lower()
        if normalized == self.last_phase:
            return None
        self.last_phase = normalized
        return json.dumps({"type": "phase", "trace_id": self.trace_id, "phase": normalized}) + "\n"

    def phase_timings(self) -> dict[str, int]:
        total_ms = max(0, int((time.monotonic() - self.request_started_at) * 1000))
        if self.chat_timing is not None:
            end_ms = self.chat_timing.direct_reply_ms
            if self.llm_selection.get("mode") == "team":
                end_ms = self.response_ms if self.response_ms is not None else total_ms
            elif self.response_ms is None:
                end_ms = total_ms
            if end_ms is not None:
                return {"total_ms": total_ms, **self.chat_timing.phases(end_ms, total_ms)}
        setup_ms = max(0, int((self.workflow_ready_at - self.request_started_at) * 1000))
        routing_ms = max(0, int(self.phase_ms["routing"]))
        model_ms = max(0, int(self.phase_ms["model"]))
        tools_ms = max(0, int(self.phase_ms["tools"]))
        other_ms = max(0, total_ms - setup_ms - routing_ms - model_ms - tools_ms)
        return {"setup_ms": setup_ms, "routing_ms": routing_ms, "model_ms": model_ms,
                "tools_ms": tools_ms, "other_ms": other_ms, "total_ms": total_ms}

    def metrics_payload(self) -> Dict[str, Any]:
        budgets = self.turn_plan.get("budgets") or {}
        timings = {
            "type": "turn_metrics",
            "trace_id": self.trace_id,
            **self.phase_timings(),
            **({"response_ms": self.response_ms} if self.response_ms is not None else {}),
            **({"team_usage": self.team_usage} if self.team_usage is not None else {}),
            "budget": dict(budgets),
        }
        if self.team_reply_streamed and (self.team_usage is None or "model_calls" not in self.team_usage):
            return timings
        if self.team_usage is not None:
            cost = self.team_usage.get("estimated_cost_usd")
        elif not (self.total_in_tok or self.total_out_tok):
            cost = 0.0
        else:
            try:
                input_rate, output_rate = model_cost_rates(
                    str(self.llm_selection.get("provider") or ""), str(self.llm_selection.get("model") or ""),
                )
                cost = round((self.total_in_tok * input_rate + self.total_out_tok * output_rate) / 1_000_000, 6)
            except Exception:
                logging.getLogger(__name__).exception("The model price is unavailable")
                cost = None
        return {
            **timings,
            "input_tokens": self.total_in_tok,
            "output_tokens": self.total_out_tok,
            "estimated_cost_usd": cost,
            "model_calls": self.model_calls,
            "tool_calls": self.tool_calls_count,
            "budget_exhausted": {
                "model_calls": bool(budgets.get("max_model_calls") and self.model_calls >= int(budgets["max_model_calls"])),
                "tool_calls": bool(budgets.get("max_tool_calls") and self.tool_calls_count >= int(budgets["max_tool_calls"])),
            },
        }

    def mark_response(self) -> None:
        if self.response_ms is None:
            ready = self.chat_timing.direct_reply_ms if self.chat_timing else None
            self.response_ms = ready if ready is not None else max(0, int((time.monotonic() - self.request_started_at) * 1000))

    def apply_team_usage(self, usage: Dict[str, Any]) -> None:
        self.team_usage = usage
        if "model_calls" in usage:
            self.total_in_tok = int(usage["input_tokens"])
            self.total_out_tok = int(usage["output_tokens"])
            self.model_calls = int(usage["model_calls"])
            self.tool_calls_count = int(usage["tool_calls"])
