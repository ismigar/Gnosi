"""Public response contracts for workspace membership administration."""

from pydantic import BaseModel, ConfigDict


class WorkspaceMemberOperationResponse(BaseModel):
    """Stable JSON envelope returned by workspace member mutations."""

    status: str
    message: str

    model_config = ConfigDict(extra="allow")


class WorkspaceMemberVaultResponse(BaseModel):
    """Vault summary exposed by the workspace member-access panel."""

    id: str
    name: str

    model_config = ConfigDict(extra="allow")
