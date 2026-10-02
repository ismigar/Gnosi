"""Expose this standalone package independently of optional SDK test collection."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
