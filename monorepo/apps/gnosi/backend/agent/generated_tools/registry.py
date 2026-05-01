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
    path: Optional[str] = None

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
        self._db_path_override = db_path
        self._initialized = False

    def _ensure_init(self):
        if self._initialized:
            return

        db_path = self._db_path_override
        if db_path is None:
            cfg = load_params(strict_env=False)
            # CRITICAL: this SQLite file MUST live on local-only storage,
            # never on OneDrive. The generated tool *.py files can stay on
            # the cloud-synced AGENT_TOOLS folder (they're plain text and
            # benefit from sync between devices), but the registry DB needs
            # POSIX semantics that FUSE-mounted clouds don't honour.
            db_path = cfg.paths.get("TOOL_REGISTRY_DB")
            if not db_path:
                # Fallback when LOCAL_DATA isn't configured for some reason.
                project_root = Path(__file__).resolve().parents[4]
                db_path = project_root / "data" / "tool_registry.sqlite"

        try:
            db_path.parent.mkdir(parents=True, exist_ok=True)
            self.db_path = db_path
            self._init_db_schema()
            self._initialized = True
        except Exception as e:
            from backend.config.logger_config import get_logger
            get_logger(__name__).warning(
                f"Could not init tool_registry SQLite at {db_path}: {e}; falling back to in-memory."
            )
            self.db_path = ":memory:"
            self._init_db_schema()
            self._initialized = True

    def _init_db_schema(self):
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
        self._ensure_init()
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
        self._ensure_init()
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("SELECT * FROM tools WHERE name = ?", (name,))
            row = cursor.fetchone()
            return self._row_to_record(row) if row else None

    def list_pending(self) -> List[ToolRecord]:
        """List all pending tools."""
        self._ensure_init()
        return self._list_by_status(ToolStatus.PENDING)

    def list_approved(self) -> List[ToolRecord]:
        """List all approved tools, including those from filesystem."""
        self._ensure_init()
        db_approved = self._list_by_status(ToolStatus.APPROVED)
        fs_skills = self._get_filesystem_skills()
        return db_approved + fs_skills

    def _list_by_status(self, status: ToolStatus) -> List[ToolRecord]:
        self._ensure_init()
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
        self._ensure_init()
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
        self._ensure_init()
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
        self._ensure_init()
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

    def _get_filesystem_skills(self) -> List[ToolRecord]:
        """Scan filesystem for consolidated skills."""
        cfg = load_params(strict_env=False)
        project_dir = cfg.paths.get("PROJECT_DIR")
        if not project_dir:
            return []
            
        # Standard locations for skills (inside the gnosi app)
        skill_dirs = [
            project_dir / "pipeline" / "skills",
            project_dir / "pipeline" / "private_skills"
        ]
        
        records = []
        for s_dir in skill_dirs:
            if not s_dir.exists():
                continue
                
            for item in s_dir.iterdir():
                if item.is_dir() and not item.name.startswith("__"):
                    # Basic metadata
                    name = item.name.replace("_", " ").capitalize()
                    description = "Consolidated System Skill"
                    created_at = datetime.fromtimestamp(item.stat().st_mtime).isoformat()
                    
                    # Try to extract better metadata from SKILL.md
                    skill_md = item / "SKILL.md"
                    if skill_md.exists():
                        try:
                            content = skill_md.read_text(encoding='utf-8')
                            lines = [l.strip() for l in content.split('\n') if l.strip()]
                            if lines:
                                if lines[0].startswith("# SKILL:"):
                                    name = lines[0].replace("# SKILL:", "").strip()
                                if len(lines) > 1:
                                    description = lines[1]
                            created_at = datetime.fromtimestamp(skill_md.stat().st_mtime).isoformat()
                        except Exception:
                            pass
                            
                    records.append(ToolRecord(
                        name=name,
                        description=description,
                        code=f"# Consolidated skill in {item.name}",
                        status=ToolStatus.APPROVED,
                        risk_level="low",
                        created_at=created_at,
                        approved_at=created_at,
                        path=str((item / "SKILL.md").resolve())
                    ))
        return records

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
            path=row["path"] if "path" in row.keys() else None
        )

    def get_stats(self) -> Dict[str, Any]:
        """Get statistics for analytics, unifiying DB and Filesystem."""
        self._ensure_init()
        fs_skills = self._get_filesystem_skills()
        
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

            # Get recent tools (last 7 days) from DB
            cursor_recent = conn.execute("""
                SELECT COUNT(*) FROM tools
                WHERE datetime(created_at) >= datetime('now', '-7 days')
            """)
            db_recent_count = cursor_recent.fetchone()[0] or 0
            
            # Count recent skills from filesystem
            from datetime import timedelta
            seven_days_ago = datetime.now() - timedelta(days=7)
            fs_recent_count = sum(1 for s in fs_skills if datetime.fromisoformat(s.created_at) >= seven_days_ago)

            total_approved = (row[2] or 0) + len(fs_skills)
            total_tools = (row[0] or 0) + len(fs_skills)

            return {
                "total_tools": total_tools,
                "pending": row[1] or 0,
                "approved": total_approved,
                "rejected": row[3] or 0,
                "by_risk_level": by_risk,
                "created_last_7_days": db_recent_count + fs_recent_count,
                "internal_skills": len(fs_skills)
            }


# Singleton instance
registry = ToolRegistry()
