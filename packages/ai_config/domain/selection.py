from typing import Dict, List, Optional

from pydantic import BaseModel


class SelectionResult(BaseModel):
    provider: str
    model: str
    fallback_used: bool
    reason: Optional[str] = None
    allowlist: Optional[List[str]] = None
    attempted: Optional[List[Dict[str, str]]] = None
