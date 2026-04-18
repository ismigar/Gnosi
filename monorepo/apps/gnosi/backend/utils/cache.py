import time
from typing import Any, Dict, Optional, Callable

class SimpleCache:
    """A simple in-memory cache with TTL (Time To Live)."""
    
    def __init__(self, default_ttl: int = 300):
        self._cache: Dict[str, Dict[str, Any]] = {}
        self.default_ttl = default_ttl

    def get(self, key: str) -> Optional[Any]:
        if key not in self._cache:
            return None
        
        entry = self._cache[key]
        if time.time() > entry["expiry"]:
            del self._cache[key]
            return None
            
        return entry["value"]

    def set(self, key: str, value: Any, ttl: Optional[int] = None):
        expiry = time.time() + (ttl if ttl is not None else self.default_ttl)
        self._cache[key] = {
            "value": value,
            "expiry": expiry
        }

    def clear(self):
        self._cache.clear()

    def get_or_set(self, key: str, func: Callable, ttl: Optional[int] = None) -> Any:
        value = self.get(key)
        if value is not None:
            return value
        
        value = func()
        self.set(key, value, ttl)
        return value

# Global instance for shared use
global_cache = SimpleCache()
