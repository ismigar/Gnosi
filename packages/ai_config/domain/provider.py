from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from .auth import AuthSource


class Provider(BaseModel):
    id: str
    name: str
    type: str
    models: Optional[List[str]] = None
    auth: AuthSource
    auth_env_var: Optional[str] = None
    profile_key: Optional[str] = None
    priority: Optional[int] = None
    meta: Optional[Dict[str, Any]] = None
