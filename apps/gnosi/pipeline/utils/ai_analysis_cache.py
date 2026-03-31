# pipeline/utils/ai_analysis_cache.py
"""
Cache system for tracking AI-analyzed notes and managing the pending queue
for the hybrid Ollama+Groq system.
"""

import json
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Any
from config.paths_config import get_paths
from config.logger_config import get_logger

log = get_logger(__name__)

paths = get_paths()
CACHE_FILE = paths["OUT_DIR"] / "ai_analysis_cache.json"
PENDING_QUEUE_FILE = paths["OUT_DIR"] / "pending_groq_queue.json"


def _load_json(path: Path) -> dict:
    """Load JSON file or return empty dict."""
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log.warning(f"Could not load {path}: {e}")
    return {}


def _save_json(path: Path, data: dict) -> None:
    """Save data to JSON file atomically."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        tmp.replace(path)
    except Exception as e:
        log.error(f"Could not save {path}: {e}")


class AIAnalysisCache:
    """
    Tracks which notes have been analyzed by AI and stores results.
    
    Structure:
    {
        "note_id": {
            "analyzed_at": "2024-01-20T00:00:00",
            "provider": "ollama|groq",
            "connections_found": 3,
            "content_hash": "abc123...",  # To detect modifications
            "success": true
        }
    }
    """
    
    def __init__(self):
        self._cache = _load_json(CACHE_FILE)
    
    def is_analyzed(self, note_id: str, content_hash: Optional[str] = None) -> bool:
        """Check if note was already analyzed (and content hasn't changed)."""
        entry = self._cache.get(note_id)
        if not entry:
            return False
        if content_hash and entry.get("content_hash") != content_hash:
            return False  # Content changed, needs re-analysis
        return entry.get("success", False)
    
    def mark_analyzed(
        self, 
        note_id: str, 
        provider: str, 
        connections_found: int,
        content_hash: Optional[str] = None,
        success: bool = True
    ) -> None:
        """Mark a note as analyzed."""
        self._cache[note_id] = {
            "analyzed_at": datetime.now().isoformat(),
            "provider": provider,
            "connections_found": connections_found,
            "content_hash": content_hash,
            "success": success
        }
        self._save()
    
    def get_stats(self) -> Dict[str, Any]:
        """Get analysis statistics."""
        total = len(self._cache)
        by_provider = {}
        for entry in self._cache.values():
            provider = entry.get("provider", "unknown")
            by_provider[provider] = by_provider.get(provider, 0) + 1
        return {"total_analyzed": total, "by_provider": by_provider}
    
    def _save(self) -> None:
        _save_json(CACHE_FILE, self._cache)


class PendingGroqQueue:
    """
    Queue for notes that failed with Ollama and need Groq processing.
    
    Structure:
    {
        "note_id": {
            "added_at": "2024-01-20T00:00:00",
            "reason": "timeout",
            "attempts": 1,
            "note_title": "..."
        }
    }
    """
    
    def __init__(self):
        self._queue = _load_json(PENDING_QUEUE_FILE)
    
    def add(self, note_id: str, reason: str, note_title: str = "") -> None:
        """Add a note to the pending queue."""
        if note_id in self._queue:
            self._queue[note_id]["attempts"] += 1
        else:
            self._queue[note_id] = {
                "added_at": datetime.now().isoformat(),
                "reason": reason,
                "attempts": 1,
                "note_title": note_title[:50]
            }
        self._save()
        log.info(f"📋 Added to Groq queue: {note_title[:30]}... (reason: {reason})")
    
    def remove(self, note_id: str) -> None:
        """Remove a note from the queue (after successful processing)."""
        if note_id in self._queue:
            del self._queue[note_id]
            self._save()
    
    def get_pending(self) -> List[str]:
        """Get list of pending note IDs."""
        return list(self._queue.keys())
    
    def get_pending_count(self) -> int:
        """Get count of pending notes."""
        return len(self._queue)
    
    def get_all(self) -> Dict[str, Any]:
        """Get all pending items with metadata."""
        return self._queue.copy()
    
    def clear(self) -> None:
        """Clear the entire queue."""
        self._queue = {}
        self._save()
    
    def _save(self) -> None:
        _save_json(PENDING_QUEUE_FILE, self._queue)


# Singleton instances
_cache_instance: Optional[AIAnalysisCache] = None
_queue_instance: Optional[PendingGroqQueue] = None


def get_analysis_cache() -> AIAnalysisCache:
    """Get the singleton cache instance."""
    global _cache_instance
    if _cache_instance is None:
        _cache_instance = AIAnalysisCache()
    return _cache_instance


def get_pending_queue() -> PendingGroqQueue:
    """Get the singleton queue instance."""
    global _queue_instance
    if _queue_instance is None:
        _queue_instance = PendingGroqQueue()
    return _queue_instance
