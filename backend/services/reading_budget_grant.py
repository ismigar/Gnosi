"""Local, non-renewing authority to resume one book within two spending ceilings."""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.services.reading_budget import BookAccount


@dataclass(frozen=True)
class Allowance:
    total: Decimal
    additional_remaining: Decimal


def schema(db: sqlite3.Connection) -> None:
    db.execute("""CREATE TABLE IF NOT EXISTS reading_book_grants (
        book_key TEXT PRIMARY KEY, total_usd TEXT NOT NULL, additional_usd TEXT NOT NULL,
        granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
    db.execute("""CREATE TABLE IF NOT EXISTS reading_book_grant_baseline (
        book_key TEXT NOT NULL, call_id TEXT NOT NULL, PRIMARY KEY(book_key, call_id))""")


def allowance(db: sqlite3.Connection, key: str, identifiers: set[str]) -> Allowance | None:
    grant = db.execute("SELECT total_usd, additional_usd FROM reading_book_grants WHERE book_key=?",
                       (key,)).fetchone()
    if not grant:
        return None
    # Settling an old hold may restore lifetime headroom, but cannot refill the supplement.
    rows = db.execute("""SELECT COALESCE(r.reported_usd, r.reserved_usd) FROM reading_reservations r
        WHERE r.budget_id IN (SELECT value FROM json_each(?))
        AND NOT EXISTS (SELECT 1 FROM reading_book_grant_baseline b
                        WHERE b.book_key=? AND b.call_id=r.call_id)""",
                      (json.dumps(sorted(identifiers)), key))
    used = sum((Decimal(row[0]) for row in rows), Decimal(0))
    return Allowance(Decimal(grant[0]), max(Decimal(0), Decimal(grant[1]) - used))


def authorize(book: BookAccount, budget_id: str, *, total_usd: Decimal, additional_usd: Decimal) -> None:
    """Register the operator's fixed approval for an existing book. Replaying it never adds funds."""
    from backend.services import ai_usage_ledger as ledger, reading_budget as budget

    if (not total_usd.is_finite() or not additional_usd.is_finite() or
            total_usd <= Decimal(str(budget.BOOK_LIMIT_USD)) or not 0 < additional_usd <= total_usd):
        raise ValueError("reading_budget_invalid")
    if not book.key or budget_id not in book.history:
        raise budget.ReadingBudgetError("reading_budget_book_mismatch")
    with ledger.connect() as db:
        budget.schema(db)
        db.execute("BEGIN IMMEDIATE")
        budget._attach_book(db, budget_id, book)
        existing = db.execute("SELECT total_usd, additional_usd FROM reading_book_grants WHERE book_key=?",
                              (book.key,)).fetchone()
        if existing:
            if (Decimal(existing[0]), Decimal(existing[1])) != (total_usd, additional_usd):
                raise budget.ReadingBudgetError("reading_budget_grant_already_exists")
            return
        identifiers = budget._members(db, book.key)
        spent, held = budget._usage(db, identifiers)
        if total_usd <= spent + held:
            raise budget.ReadingBudgetError("reading_budget_below_committed_cost")
        db.execute("INSERT INTO reading_book_grants (book_key,total_usd,additional_usd) VALUES (?,?,?)",
                   (book.key, str(total_usd), str(additional_usd)))
        db.execute("""INSERT INTO reading_book_grant_baseline (book_key,call_id)
            SELECT ?,call_id FROM reading_reservations WHERE budget_id IN (SELECT value FROM json_each(?))""",
                   (book.key, json.dumps(sorted(identifiers))))
        db.execute("UPDATE reading_budgets SET limit_usd=? WHERE id=?", (str(total_usd), budget_id))


def extend(book: BookAccount, budget_id: str, *, additional_usd: Decimal) -> dict[str, object]:
    """Explicitly extend an existing book's authorized spending limit by ``additional_usd``."""
    from backend.services import ai_usage_ledger as ledger, reading_budget as budget

    if not additional_usd.is_finite() or additional_usd <= 0:
        raise ValueError("reading_budget_invalid")
    if not book.key or budget_id not in book.history:
        raise budget.ReadingBudgetError("reading_budget_book_mismatch")
    with ledger.connect() as db:
        budget.schema(db)
        db.execute("BEGIN IMMEDIATE")
        budget._attach_book(db, budget_id, book)
        identifiers = budget._members(db, book.key)
        spent, held = budget._usage(db, identifiers)
        existing = db.execute(
            "SELECT total_usd, additional_usd FROM reading_book_grants WHERE book_key=?",
            (book.key,),
        ).fetchone()
        base_total = max(
            Decimal(existing[0]) if existing else Decimal(str(budget.BOOK_LIMIT_USD)),
            spent + held,
        )
        new_total = base_total + additional_usd
        if existing:
            db.execute(
                "UPDATE reading_book_grants SET total_usd=?, additional_usd=?, granted_at=CURRENT_TIMESTAMP WHERE book_key=?",
                (str(new_total), str(additional_usd), book.key),
            )
        else:
            db.execute(
                "INSERT INTO reading_book_grants (book_key,total_usd,additional_usd) VALUES (?,?,?)",
                (book.key, str(new_total), str(additional_usd)),
            )
        db.execute(
            """INSERT OR IGNORE INTO reading_book_grant_baseline (book_key,call_id)
            SELECT ?,call_id FROM reading_reservations WHERE budget_id IN (SELECT value FROM json_each(?))""",
            (book.key, json.dumps(sorted(identifiers))),
        )
        db.execute("UPDATE reading_budgets SET limit_usd=? WHERE id=?", (str(new_total), budget_id))
        return budget.totals(db, budget_id)


def main() -> None:
    """Grant a local operator-approved resume to the named, existing checkpoint."""
    import argparse
    from backend.domains.llm_wiki import legacy_ports
    from backend.services import llm_wiki_storage, reading_budget

    parser = argparse.ArgumentParser(description=main.__doc__)
    parser.add_argument("--source-table", required=True)
    parser.add_argument("--resource", required=True)
    parser.add_argument("--expected-job", required=True)
    parser.add_argument("--total-usd", required=True, type=Decimal)
    parser.add_argument("--additional-usd", required=True, type=Decimal)
    args = parser.parse_args()
    previous = llm_wiki_storage.get_job_status(args.resource, args.source_table)
    if (previous.get("job_id") != args.expected_job or previous.get("resource_id") != args.resource
            or previous.get("source_table_id") != args.source_table or previous.get("phase") not in {"partial", "error"}):
        parser.error("The current resumable book does not match the expected checkpoint.")
    book = reading_budget.book_account(legacy_ports.path_for("VAULT"), args.source_table, args.resource)
    authorize(book, str(previous.get("budget_id") or ""), total_usd=args.total_usd, additional_usd=args.additional_usd)


if __name__ == "__main__":
    main()
