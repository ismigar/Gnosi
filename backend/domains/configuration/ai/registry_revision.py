"""Optimistic revision for model and budget edits from independent clients."""
from hashlib import sha256
import json
from typing import Any


def registry_revision(ai_config: dict[str, Any]) -> str:
    snapshot = {key: ai_config.get(key) for key in ("models", "budget")}
    return sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
