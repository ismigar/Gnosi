from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from .provider import Provider
from .model import Model


class Catalog(BaseModel):
    providers: List[Provider]
    models: List[Model]
    mode: Optional[str] = None
    defaults: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
