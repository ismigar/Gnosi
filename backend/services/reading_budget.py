"""Durable per-book reservations: a retry or resumed worker cannot reset spending."""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from decimal import Decimal
import json
from typing import Any, Iterator
import uuid

from backend.services import ai_usage_ledger as ledger

DEFAULT_LIMIT_USD = 0.50
_current: ContextVar[str] = ContextVar("reading_budget", default="")


class ReadingBudgetError(RuntimeError):
    """Pause before sending a request whose cost cannot be reserved safely."""


def schema(db: Any) -> None:
    db.execute("CREATE TABLE IF NOT EXISTS reading_budgets (id TEXT PRIMARY KEY, limit_usd TEXT NOT NULL)")
    db.execute("""CREATE TABLE IF NOT EXISTS reading_reservations (
        call_id TEXT PRIMARY KEY, budget_id TEXT NOT NULL, reserved_usd TEXT NOT NULL,
        reported_usd TEXT)""")


def totals(db: Any, identifier: str) -> dict[str, Any]:
    row = db.execute("SELECT limit_usd FROM reading_budgets WHERE id=?", (identifier,)).fetchone()
    if row is None:
        raise ReadingBudgetError("reading_budget_missing")
    rows = db.execute("SELECT reserved_usd,reported_usd FROM reading_reservations WHERE budget_id=?", (identifier,)).fetchall()
    spent = sum((Decimal(r["reported_usd"]) for r in rows if r["reported_usd"] is not None), Decimal(0))
    held = sum((Decimal(r["reserved_usd"]) for r in rows if r["reported_usd"] is None), Decimal(0))
    limit = Decimal(row["limit_usd"])
    return {"id": identifier, "limit_usd": float(limit), "spent_usd": float(spent),
            "reserved_usd": float(held), "remaining_usd": float(max(Decimal(0), limit-spent-held))}


def status(identifier: str) -> dict[str, Any]:
    with ledger.connect() as db:
        schema(db)
        return totals(db, identifier)


def configure(limit: float, identifier: str = "") -> str:
    amount = ledger.decimal_cost(limit)
    if amount is None or amount <= 0:
        raise ValueError("reading_budget_invalid")
    identifier = identifier or uuid.uuid4().hex
    with ledger.connect() as db:
        schema(db)
        db.execute("BEGIN IMMEDIATE")
        previous = db.execute("SELECT limit_usd FROM reading_budgets WHERE id=?", (identifier,)).fetchone()
        if previous:
            total = totals(db, identifier)
            if amount < Decimal(str(total["spent_usd"])) + Decimal(str(total["reserved_usd"])):
                raise ReadingBudgetError("reading_budget_below_committed_cost")
            # A limit increase is explicit in the user's next process request.
            db.execute("UPDATE reading_budgets SET limit_usd=? WHERE id=?", (str(amount), identifier))
        else:
            db.execute("INSERT INTO reading_budgets VALUES (?,?)", (identifier, str(amount)))
    return identifier


@contextmanager
def session(identifier: str) -> Iterator[None]:
    token = _current.set(identifier)
    try:
        yield
    finally:
        _current.reset(token)


def active() -> bool:
    return bool(_current.get())


def reserve(call_id: str, messages: Any, parameters: dict[str, Any], rates: dict[str, Any] | None, provider: str) -> None:
    identifier = _current.get()
    if not identifier:
        return
    output = parameters.get("max_completion_tokens", parameters.get("max_tokens", parameters.get("max_output_tokens")))
    if provider in {"local", "ollama", "lmstudio", "llama-cpp", "llama.cpp"}:
        amount = Decimal(0)
    else:
        if not rates or not isinstance(output, int) or isinstance(output, bool) or output <= 0:
            raise ReadingBudgetError("reading_budget_unknown_price_or_output_limit")
        cost_in, cost_out = ledger.decimal_cost(rates.get("cost_in")), ledger.decimal_cost(rates.get("cost_out"))
        if cost_in is None or cost_out is None:
            raise ReadingBudgetError("reading_budget_unknown_price_or_output_limit")
        # UTF-8 bytes conservatively bound text tokens; also count tool schemas,
        # invocation parameters and framing. Do not discount prompt caching.
        payload = json.dumps([messages, parameters], default=lambda v: v.model_dump() if hasattr(v, "model_dump") else str(v), ensure_ascii=False)
        input_bound = len(payload.encode("utf-8")) + 4096
        amount = (Decimal(input_bound)*cost_in + Decimal(output)*cost_out) / Decimal(1_000_000) * Decimal("1.10")
    with ledger.connect() as db:
        schema(db)
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM reading_reservations WHERE call_id=?", (call_id,)).fetchone():
            return
        total = totals(db, identifier)
        limit = Decimal(db.execute("SELECT limit_usd FROM reading_budgets WHERE id=?", (identifier,)).fetchone()[0])
        committed = sum((Decimal(row["reported_usd"] if row["reported_usd"] is not None else row["reserved_usd"])
                         for row in db.execute("SELECT reserved_usd,reported_usd FROM reading_reservations WHERE budget_id=?", (identifier,))), Decimal(0))
        if amount > max(Decimal(0), limit-committed):
            reason = "reading_budget_pending_cost" if total["reserved_usd"] else "reading_budget_exhausted"
            raise ReadingBudgetError(reason)
        db.execute("INSERT INTO reading_reservations VALUES (?,?,?,NULL)", (call_id, identifier, str(amount)))


def settle(db: Any, call_id: str, cost: Any) -> None:
    amount = ledger.decimal_cost(cost)
    if amount is not None:
        schema(db)
        db.execute("UPDATE reading_reservations SET reported_usd=? WHERE call_id=?", (str(amount), call_id))
