from typing import Literal, Optional, Union

from pydantic import BaseModel


class SecretRef(BaseModel):
    type: Literal['env', 'file', 'exec']
    name: Optional[str] = None
    path: Optional[str] = None
    command: Optional[str] = None


class AuthSource(BaseModel):
    mode: Literal['api_key', 'oauth', 'secret_ref']
    value: Optional[str] = None
    token: Optional[str] = None
    ref: Optional[Union[str, SecretRef]] = None
    from_source: Optional[Literal['config', 'env', 'profile', 'ref']] = None
    redacted: Optional[bool] = None
