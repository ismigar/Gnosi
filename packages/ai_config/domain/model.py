from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class ModelCompat(BaseModel):
    context: List[str]
    reasoning: List[str]
    tools: List[str]
    transport: List[str]


class Model(BaseModel):
    id: str
    name: str
    provider_id: Optional[str] = None
    compat: ModelCompat
    meta: Optional[Dict[str, Any]] = None
