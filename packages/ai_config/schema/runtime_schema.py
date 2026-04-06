from typing import Dict, List, Optional

from pydantic import BaseModel, Field

from .provider_schema import ProviderSchema
from .model_schema import ModelSchema


class ContextDefaultSchema(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    fallback: Optional[str] = None


class DefaultsSchema(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    by_context: Dict[str, ContextDefaultSchema] = Field(default_factory=dict)


class RuntimeConfigSchema(BaseModel):
    mode: str = "replace"
    providers: List[ProviderSchema] = Field(default_factory=list)
    models: List[ModelSchema] = Field(default_factory=list)
    profiles: Dict[str, Dict[str, str]] = Field(default_factory=dict)
    allowlist: List[str] = Field(default_factory=list)
    defaults: DefaultsSchema = Field(default_factory=DefaultsSchema)
