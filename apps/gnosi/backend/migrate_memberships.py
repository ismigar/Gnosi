import sqlite3
import os
from pathlib import Path

def migrate_db():
    # Determinació de la ruta de la DB corregida
    db_path = Path(__file__).resolve().parent / "data" / "management.sqlite"

    if not db_path.exists():

        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Afegir columna permissions si no existeix
        # Nota: SQLite no suporta JSON directament en versions antigues, però com a TEXT és segur.
        cursor.execute("ALTER TABLE memberships ADD COLUMN permissions TEXT DEFAULT '{\"capabilities\": [\"read\"]}'")

    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):

        else:

    conn.commit()
    conn.close()

if __name__ == "__main__":
    migrate_db()
