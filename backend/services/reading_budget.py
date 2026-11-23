"""Durable per-book reservations: a retry or resumed worker cannot reset spending."""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
import json
from typing import Any, Iterator
import uuid

from backend.services import ai_usage_ledger as ledger
from backend.services import reading_budget_grant as grants

DEFAULT_LIMIT_USD = 0.50  # Separate limit for note migration.
BOOK_LIMIT_USD = 5.0
_current: ContextVar[str] = ContextVar("reading_budget", default="")
_attempts: ContextVar[tuple[list[str], ...]] = ContextVar("reading_request_attempts", default=())


class ReadingBudgetError(RuntimeError):
    """Pause before sending a request whose cost cannot be reserved safely."""


def schema(db: Any) -> None:
    db.execute("CREATE TABLE IF NOT EXISTS reading_budgets (id TEXT PRIMARY KEY, limit_usd TEXT NOT NULL)")
    db.execute("""CREATE TABLE IF NOT EXISTS reading_reservations (
        call_id TEXT PRIMARY KEY, budget_id TEXT NOT NULL, reserved_usd TEXT NOT NULL,
        reported_usd TEXT)""")
    db.execute("CREATE TABLE IF NOT EXISTS reading_budget_books (budget_id TEXT PRIMARY KEY, book_key TEXT NOT NULL)")
    db.execute("CREATE INDEX IF NOT EXISTS reading_budget_books_key ON reading_budget_books(book_key)")
    grants.schema(db)
    db.execute("CREATE INDEX IF NOT EXISTS reading_reservations_budget ON reading_reservations(budget_id)")


@dataclass(frozen=True)
class BookAccount:
    key: str
    history: tuple[str, ...]


def _book_key(vault_root: str | Path, table_id: str, resource_id: str) -> str:
    from backend.domains.llm_wiki.contextual_reading import fingerprint
    return fingerprint([str(Path(vault_root).resolve()), table_id, resource_id])


def book_account(vault_root: str | Path, table_id: str, resource_id: str) -> BookAccount:
    from backend.services import llm_wiki_storage
    key = _book_key(vault_root, table_id, resource_id)
    return BookAccount(key, llm_wiki_storage.resource_budget_ids(table_id, resource_id))


def _members(db: Any, book_key: str) -> set[str]:
    return {r[0] for r in db.execute("SELECT budget_id FROM reading_budget_books WHERE book_key=?", (book_key,))}


def _usage(db: Any, identifiers: set[str]) -> tuple[Decimal, Decimal]:
    rows = db.execute("""SELECT reported_usd, reserved_usd FROM reading_reservations
        WHERE budget_id IN (SELECT value FROM json_each(?))""", (json.dumps(sorted(identifiers)),))
    spent, held = Decimal(0), Decimal(0)
    for reported, reserved in rows:
        if reported is None:
            held += Decimal(reserved)
        else:
            spent += Decimal(reported)
    return spent, held


@dataclass(frozen=True)
class _Balance:
    limit: Decimal
    spent: Decimal
    held: Decimal
    allowance: grants.Allowance | None

    @property
    def remaining(self) -> Decimal:
        room = self.limit - self.spent - self.held
        if self.allowance:
            room = min(room, self.allowance.additional_remaining)
        return max(Decimal(0), room)


def _balance(db: Any, identifier: str, account: BookAccount | None = None) -> _Balance:
    current = db.execute("""SELECT b.limit_usd, m.book_key FROM reading_budgets b
        LEFT JOIN reading_budget_books m ON m.budget_id=b.id WHERE b.id=?""", (identifier,)).fetchone()
    if not current:
        raise ReadingBudgetError("reading_budget_missing")
    limit = Decimal(current[0])
    key = account.key if account else current[1]
    identifiers = {identifier}
    if key:
        identifiers.update(_members(db, key))
    if account:
        identifiers.update(account.history)
    allowance = grants.allowance(db, key, identifiers) if key else None
    if key:
        limit = min(limit, allowance.total if allowance else Decimal(str(BOOK_LIMIT_USD)))
    spent, held = _usage(db, identifiers)
    return _Balance(limit, spent, held, allowance)


def totals(db: Any, identifier: str, account: BookAccount | None = None) -> dict[str, Any]:
    balance = _balance(db, identifier, account)
    result: dict[str, Any] = {"id": identifier, "limit_usd": float(balance.limit), "spent_usd": float(balance.spent),
                              "reserved_usd": float(balance.held), "remaining_usd": float(balance.remaining)}
    if balance.allowance:
        result.update(authorized_limit_usd=float(balance.allowance.total),
                      additional_remaining_usd=float(balance.allowance.additional_remaining))
    return result


def status(identifier: str, account: BookAccount | None = None) -> dict[str, Any]:
    with ledger.connect() as db:
        schema(db)
        return totals(db, identifier, account)


def book_status(identifier: str, vault_root: str | Path, table_id: str, resource_id: str) -> dict[str, Any] | None:
    with ledger.connect() as db:
        schema(db)
        linked = db.execute("SELECT book_key FROM reading_budget_books WHERE budget_id=?", (identifier,)).fetchone()
        if linked:
            if linked[0] != _book_key(vault_root, table_id, resource_id):
                raise ReadingBudgetError("reading_budget_book_mismatch")
            return totals(db, identifier)
        account = book_account(vault_root, table_id, resource_id)
        if not identifier:
            # A crash can persist the job before its budget ID. The latest
            # ledger row supplies its limit; every book member contributes usage.
            members = set(account.history) | _members(db, account.key)
            row = db.execute("""SELECT id FROM reading_budgets WHERE id IN
                (SELECT value FROM json_each(?)) ORDER BY rowid DESC LIMIT 1""",
                (json.dumps(sorted(members)),)).fetchone()
            if not row:
                return None
            identifier = row[0]
        return totals(db, identifier, account)


def _attach_book(db: Any, identifier: str, account: BookAccount) -> None:
    for member in {identifier, *account.history}:
        row = db.execute("SELECT id FROM reading_budgets WHERE id=?", (member,)).fetchone()
        if not row:
            raise ReadingBudgetError("reading_budget_missing")
        db.execute("INSERT OR IGNORE INTO reading_budget_books VALUES (?,?)", (member, account.key))
        mapped, = db.execute("SELECT book_key FROM reading_budget_books WHERE budget_id=?", (member,)).fetchone()
        if mapped != account.key:
            raise ReadingBudgetError("reading_budget_book_mismatch")


def configure(limit: float, identifier: str = "", *, book: BookAccount | None = None) -> str:
    amount = ledger.decimal_cost(limit)
    if amount is None or amount <= 0:
        raise ValueError("reading_budget_invalid")
    identifier = identifier or uuid.uuid4().hex
    with ledger.connect() as db:
        schema(db)
        db.execute("BEGIN IMMEDIATE")
        db.execute("INSERT OR IGNORE INTO reading_budgets VALUES (?, ?)", (identifier, str(amount)))
        if book:
            _attach_book(db, identifier, book)
        balance = _balance(db, identifier)
        if book and amount > (balance.allowance.total if balance.allowance else Decimal(str(BOOK_LIMIT_USD))):
            raise ReadingBudgetError("reading_budget_exceeds_book_limit")
        if amount < balance.spent + balance.held:
            raise ReadingBudgetError("reading_budget_below_committed_cost")
        db.execute("UPDATE reading_budgets SET limit_usd=? WHERE id=?", (str(amount), identifier))
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


@contextmanager
def attempted_requests() -> Iterator[list[str]]:
    """Keep possible paid requests visible to nested and copied retry contexts."""
    requests: list[str] = []
    token = _attempts.set((*_attempts.get(), requests))
    try:
        yield requests
    finally:
        _attempts.reset(token)


def _record_attempt(call_id: str, amount: Decimal) -> None:
    if amount > 0:
        for requests in _attempts.get():
            requests.append(call_id)


def reserve(call_id: str, messages: Any, parameters: dict[str, Any], rates: dict[str, Any] | None,
            provider: str, model: str = "") -> None:
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
        from backend.services.openai_usage_pricing import LONG_INPUT, reading_model
        direct_model = reading_model(provider, model)
        if direct_model:
            options = parameters.get("prompt_cache_options") or {}
            # Reserve cache writes as well as ordinary input; never assume hits.
            # The explicitly bound native tier determines the quoted tariff.
            cost_in *= Decimal("2.5") if options.get("ttl") == "12h" else Decimal("1.25")
            if input_bound > LONG_INPUT:
                cost_in *= 2
                cost_out *= Decimal("1.5")
            if parameters.get("service_tier") == "flex" and direct_model == "gpt-6.1-sol":
                # Native Flex is explicitly bound, with no automatic Standard
                # fallback. Reserve its published tariff, including every write.
                # A body override must never invalidate the priced request.
                if parameters.get("extra_body"):
                    raise ReadingBudgetError("reading_budget_body_override")
                cost_in *= Decimal("0.5")
                cost_out *= Decimal("0.5")
        amount = (Decimal(input_bound)*cost_in + Decimal(output)*cost_out) / Decimal(1_000_000) * Decimal("1.10")
    with ledger.connect() as db:
        schema(db)
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM reading_reservations WHERE call_id=?", (call_id,)).fetchone():
            _record_attempt(call_id, amount)
            return
        balance = _balance(db, identifier)
        if amount > balance.remaining:
            reason = "reading_budget_pending_cost" if balance.held else "reading_budget_exhausted"
            raise ReadingBudgetError(reason)
        db.execute("INSERT INTO reading_reservations VALUES (?,?,?,NULL)", (call_id, identifier, str(amount)))
        _record_attempt(call_id, amount)


def settle(db: Any, call_id: str, cost: Any) -> None:
    amount = ledger.decimal_cost(cost)
    if amount is not None:
        schema(db)
        db.execute("UPDATE reading_reservations SET reported_usd=? WHERE call_id=?", (str(amount), call_id))


def refine_reservation(db: Any, call_id: str, upper_bound: Any) -> None:
    """Replace a maximum-output hold with a conservative terminal-usage bound."""
    amount = ledger.decimal_cost(upper_bound)
    if amount is None or amount <= 0:
        return
    schema(db)
    row = db.execute("SELECT reserved_usd,reported_usd FROM reading_reservations WHERE call_id=?", (call_id,)).fetchone()
    if row is not None and row["reported_usd"] is None and amount != Decimal(row["reserved_usd"]):
        db.execute("UPDATE reading_reservations SET reserved_usd=? WHERE call_id=?", (str(amount), call_id))
