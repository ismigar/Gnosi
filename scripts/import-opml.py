import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

GNOSI_ROOT = Path(__file__).resolve().parents[1]
if str(GNOSI_ROOT) not in sys.path:
    sys.path.insert(0, str(GNOSI_ROOT))

from backend.data.db import SessionLocal
from backend.models.reader import FeedSource

db = SessionLocal()
try:
    # OPML path: 1st argument or, by default, ~/Downloads (do not hardcode a user)
    opml_path = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Downloads/Feeds.opml")
    tree = ET.parse(opml_path)
    imported = 0
    for outline in tree.findall('.//outline'):
        if 'xmlUrl' in outline.attrib:
            url = outline.attrib.get('xmlUrl')
            title = outline.attrib.get('title', outline.attrib.get('text', 'Unknown'))
            if not db.query(FeedSource).filter(FeedSource.url == url).first():
                db.add(FeedSource(name=title, url=url, category="Uncategorized", type="rss"))
                imported += 1
    db.commit()
    print(f"Imported {imported} feeds successfully.")
except Exception as e:
    print(f"Error: {e}")
finally:
    db.close()
