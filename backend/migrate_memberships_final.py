import sqlite3

from backend.config.logger_config import get_logger
from backend.data.management_db import _get_mgmt_db_path


log = get_logger(__name__)

def migrate_db():
    # Determining the dynamic DB path
    db_path = _get_mgmt_db_path()

    if not db_path.exists():
        log.info("Management database not found; membership migration skipped")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Add permissions column if it doesn't exist
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
