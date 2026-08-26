from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel


class SecretRefSchema(BaseModel):
    type: Literal['env', 'file', 'exec']
    name: Optional[str] = None
    path: Optional[str] = None
    command: Optional[str] = None


class AuthSourceSchema(BaseModel):
    mode: Literal['api_key', 'oauth', 'secret_ref']
    value: Optional[str] = None
    token: Optional[str] = None
    ref: Optional[Union[str, SecretRefSchema]] = None


class ProviderSchema(BaseModel):
    id: str
    name: str
    type: str
    models: Optional[List[str]] = None
    auth: AuthSourceSchema
    auth_env_var: Optional[str] = None
    profile_key: Optional[str] = None
    priority: Optional[int] = None
    meta: Optional[Dict[str, Any]] = None
