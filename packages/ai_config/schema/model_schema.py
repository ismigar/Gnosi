from pydantic import BaseModel
from typing import List, Dict, Optional, Any

class ModelCompatSchema(BaseModel):
    context: List[str]
    reasoning: List[str]
    tools: List[str]
    transport: List[str]

class ModelSchema(BaseModel):
    id: str
    name: str
    provider_id: Optional[str] = None
    compat: ModelCompatSchema
    meta: Optional[Dict[str, Any]] = None
