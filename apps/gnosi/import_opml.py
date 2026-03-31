import xml.etree.ElementTree as ET
from backend.data.db import SessionLocal
from backend.models.reader import FeedSource

db = SessionLocal()
try:
    tree = ET.parse('/Users/ismaelgarciafernandez/Downloads/Feeds.opml')
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
