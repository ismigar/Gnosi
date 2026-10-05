"""Contracts for explicit, bounded and reusable bot-function checks."""
from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field
from backend.services.agent_task_cases import TaskId, VERSION, MODE
from backend.services.agent_work_samples import SuiteKind


class TaskEvaluationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    agent_id: str = Field(min_length=1, max_length=128)
    provider: str = Field(min_length=1, max_length=64)
    model: str = Field(min_length=1, max_length=192)
    tasks: list[TaskId] = Field(min_length=1, max_length=12)
    budget_usd: float = Field(default=0.05, gt=0, le=1, allow_inf_nan=False)
    authorize_model_calls: bool = False
    retest: bool = False
    suite: SuiteKind = 'basic'


class TaskCaseResult(BaseModel):
    id: str
    metric: str
    tasks: list[TaskId]
    passed: bool
    failure: str = ''
    checked_at: str
    latency_ms: int
    cost_usd: float | None = None
    cost_source: Literal['reported', 'estimated', 'unknown'] = 'unknown'
    reused_from: str = ''
    output: str = ''
    task_prompt: str = ''
    expected: Any = None
    requires_review: bool = False
    review: Literal['pending', 'accepted', 'rejected', 'not_required'] = 'not_required'
    review_note: str = ''
    reviewed_at: str = ''


class TaskEvaluationReport(BaseModel):
    id: str
    agent_id: str
    provider: str
    model: str
    version: str = VERSION
    mode: str = MODE
    created_at: str
    tasks: list[TaskId]
    cases: list[TaskCaseResult] = Field(default_factory=list)
    model_calls: int = 0
    reused_cases: int = 0
    budget_usd: float
    reserved_usd: float = 0
    cost_usd: float | None = None
    status: Literal['completed', 'stopped'] = 'completed'
    stop_reason: str = ''


class TaskEvaluationPlan(BaseModel):
    version: str = VERSION
    mode: str = MODE
    case_ids: list[str]
    reused_cases: list[TaskCaseResult]
    pending_ids: list[str]
    maximum_cost_usd: float | None
    can_run: bool
    reason: str = ''


class TaskCriterion(BaseModel):
    id: str
    metric: str
    tasks: list[TaskId]
    title: str = ''
    source: str = ''
    prompt: str = ''
    expected: Any = None
    requires_review: bool = False


class TaskEvaluationSuite(BaseModel):
    version: str = VERSION
    mode: str = MODE
    max_age_days: int = 30
    max_output_tokens: int = 512
    criteria: list[TaskCriterion]
    kind: SuiteKind = 'basic'


class TaskReviewRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    case_id: str = Field(min_length=1, max_length=128)
    verdict: Literal['accepted', 'rejected']
    note: str = Field(default='', max_length=2000)
