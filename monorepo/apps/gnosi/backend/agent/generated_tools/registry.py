"""
Tool Registry: Persistent storage and lookup for generated tools.

Features:
- SQLite-based persistence
- Search before create (avoid duplicates)
- Track tool status (pending/approved/rejected)
"""

import sqlite3
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from enum import Enum
from backend.config.app_config import load_params


class ToolStatus(Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


@dataclass
class ToolRecord:
    name: str
    description: str
    code: str
    status: ToolStatus
    risk_level: str
    created_at: str
    approved_at: Optional[str] = None
    rejected_at: Optional[str] = None
    rejection_reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["status"] = self.status.value
        return d


class ToolRegistry:
    """
    Persistent registry for generated tools.
    Uses SQLite for storage.
    """

    def __init__(self, db_path: Optional[Path] = None):
        if db_path is None:
            cfg = load_params(strict_env=False)
            db_path = cfg.paths["TOOLS"] / "tool_registry.sqlite"

        try:
            db_path.parent.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            print(f"⚠️ Warning: Could not create tools directory {db_path.parent}: {e}")

        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        """Initialize database schema."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tools (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    description TEXT NOT NULL,
                    code TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    risk_level TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    approved_at TEXT,
                    rejected_at TEXT,
                    rejection_reason TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tools_name ON tools(name)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tools_status ON tools(status)")
            conn.commit()

    def search_existing(
        self, description: str, threshold: float = 0.7
    ) -> Optional[ToolRecord]:
        """
        Search for an existing tool that matches the description.
        Uses simple keyword matching (can be upgraded to embeddings later).
        """
        keywords = set(description.lower().split())

        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("SELECT * FROM tools WHERE status = 'approved'")

            best_match = None
            best_score = 0.0

            for row in cursor:
                tool_keywords = set(row["description"].lower().split())
                if not tool_keywords:
                    continue

                # Jaccard similarity
                intersection = len(keywords & tool_keywords)
                union = len(keywords | tool_keywords)
                score = intersection / union if union > 0 else 0

                if score > threshold and score > best_score:
                    best_score = score
                    best_match = self._row_to_record(row)

            return best_match

    def get_by_name(self, name: str) -> Optional[ToolRecord]:
        """Get a tool by exact name."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("SELECT * FROM tools WHERE name = ?", (name,))
            row = cursor.fetchone()
            return self._row_to_record(row) if row else None

    def list_pending(self) -> List[ToolRecord]:
        """List all pending tools."""
        return self._list_by_status(ToolStatus.PENDING)

    def list_approved(self) -> List[ToolRecord]:
        """List all approved tools."""
        return self._list_by_status(ToolStatus.APPROVED)

    def _list_by_status(self, status: ToolStatus) -> List[ToolRecord]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                "SELECT * FROM tools WHERE status = ?", (status.value,)
            )
            return [self._row_to_record(row) for row in cursor]

    def create(
        self, name: str, description: str, code: str, risk_level: str
    ) -> ToolRecord:
        """Create a new tool record (status: pending)."""
        now = datetime.utcnow().isoformat()

        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO tools (name, description, code, status, risk_level, created_at)
                VALUES (?, ?, ?, 'pending', ?, ?)
            """,
                (name, description, code, risk_level, now),
            )
            conn.commit()

        return ToolRecord(
            name=name,
            description=description,
            code=code,
            status=ToolStatus.PENDING,
            risk_level=risk_level,
            created_at=now,
        )

    def approve(self, name: str) -> bool:
        """Approve a pending tool."""
        now = datetime.utcnow().isoformat()

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                """
                UPDATE tools SET status = 'approved', approved_at = ?
                WHERE name = ? AND status = 'pending'
            """,
                (now, name),
            )
            conn.commit()
            return cursor.rowcount > 0

    def reject(self, name: str, reason: str = "") -> bool:
        """Reject a pending tool."""
        now = datetime.utcnow().isoformat()

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                """
                UPDATE tools SET status = 'rejected', rejected_at = ?, rejection_reason = ?
                WHERE name = ? AND status = 'pending'
            """,
                (now, reason, name),
            )
            conn.commit()
            return cursor.rowcount > 0

    def _row_to_record(self, row: sqlite3.Row) -> ToolRecord:
        return ToolRecord(
            name=row["name"],
            description=row["description"],
            code=row["code"],
            status=ToolStatus(row["status"]),
            risk_level=row["risk_level"],
            created_at=row["created_at"],
            approved_at=row["approved_at"],
            rejected_at=row["rejected_at"],
            rejection_reason=row["rejection_reason"],
        )

    def get_stats(self) -> Dict[str, Any]:
        """Get statistics for analytics."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("""
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
                    SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
                FROM tools
            """)
            row = cursor.fetchone()

            # Get by risk level
            cursor_risk = conn.execute("""
                SELECT risk_level, COUNT(*) as count
                FROM tools
                GROUP BY risk_level
            """)
            by_risk = {row[0]: row[1] for row in cursor_risk}

            # Get recent tools (last 7 days)
            cursor_recent = conn.execute("""
                SELECT COUNT(*) FROM tools
                WHERE created_at >= datetime('now', '-7 days')
            """)
            recent_count = cursor_recent.fetchone()[0]

            return {
                "total_tools": row[0] or 0,
                "pending": row[1] or 0,
                "approved": row[2] or 0,
                "rejected": row[3] or 0,
                "by_risk_level": by_risk,
                "created_last_7_days": recent_count,
            }


# Singleton instance
registry = ToolRegistry()
