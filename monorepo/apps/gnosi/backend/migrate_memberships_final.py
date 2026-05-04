import sqlite3
import os
from pathlib import Path
from backend.data.management_db import _get_mgmt_db_path

def migrate_db():
    # Determinació de la ruta de la DB dinàmica
    db_path = _get_mgmt_db_path()

    if not db_path.exists():

        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Afegir columna permissions si no existeix
        cursor.execute("ALTER TABLE memberships ADD COLUMN permissions TEXT DEFAULT '{\"capabilities\": [\"read\"]}'")

    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):

        else:

    conn.commit()
    conn.close()

if __name__ == "__main__":
    migrate_db()
