import sys
import os
from pathlib import Path

# Add backend to path
GNOSI_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = GNOSI_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(BACKEND_DIR.parent) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR.parent))

from backend.services.feed_ingester import fetch_and_store_feeds
from backend.config.logger_config import setup_logging

setup_logging()
count = fetch_and_store_feeds()
print(f"Added {count} new articles.")
