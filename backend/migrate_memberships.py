import sqlite3
from pathlib import Path

from backend.config.logger_config import get_logger


log = get_logger(__name__)

def migrate_db():
    # Determining the corrected DB path
    db_path = Path(__file__).resolve().parent / "data" / "management.sqlite"

    if not db_path.exists():
        log.info("Management database not found; membership migration skipped")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Add permissions column if it doesn't exist
        # Note: SQLite doesn't support JSON directly in older versions, but as TEXT it's safe.
        cursor.execute("ALTER TABLE memberships ADD COLUMN permissions TEXT DEFAULT '{\"capabilities\": [\"read\"]}'")

    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            log.info("Membership permissions column already exists")
        else:
            raise
    conn.commit()
    conn.close()

if __name__ == "__main__":
    migrate_db()
