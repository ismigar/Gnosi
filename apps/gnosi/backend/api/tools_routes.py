"""
API Routes for Generated Tools Management.
Provides endpoints for the Dashboard to approve/reject pending tools.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from backend.agent.generated_tools.registry import registry, ToolStatus
from backend.agent.generated_tools.loader import loader

router = APIRouter(prefix="/api/tools", tags=["tools"])


class ToolResponse(BaseModel):
    name: str
    description: str
    code: str
    status: str
    risk_level: str
    created_at: str
    approved_at: Optional[str] = None
    rejected_at: Optional[str] = None
    rejection_reason: Optional[str] = None


class ApproveRequest(BaseModel):
    name: str


class RejectRequest(BaseModel):
    name: str
    reason: Optional[str] = ""


@router.get("/pending", response_model=List[ToolResponse])
async def get_pending_tools():
    """Get all tools pending approval."""
    pending = registry.list_pending()
    return [
        ToolResponse(
            name=t.name,
            description=t.description,
            code=t.code,
            status=t.status.value,
            risk_level=t.risk_level,
            created_at=t.created_at,
            approved_at=t.approved_at,
            rejected_at=t.rejected_at,
            rejection_reason=t.rejection_reason
        )
        for t in pending
    ]


@router.get("/approved", response_model=List[ToolResponse])
async def get_approved_tools():
    """Get all approved tools."""
    approved = registry.list_approved()
    return [
        ToolResponse(
            name=t.name,
            description=t.description,
            code=t.code,
            status=t.status.value,
            risk_level=t.risk_level,
            created_at=t.created_at,
            approved_at=t.approved_at,
            rejected_at=t.rejected_at,
            rejection_reason=t.rejection_reason
        )
        for t in approved
    ]


@router.post("/approve")
async def approve_tool(request: ApproveRequest):
    """
    Approve a pending tool.
    Moves it from pending to approved status.
    """
    success = registry.approve(request.name)
    
    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"Tool '{request.name}' not found or not pending"
        )
    
    # Move file from pending to approved
    from pathlib import Path
    base_dir = Path(__file__).parent.parent / "agent" / "generated_tools"
    pending_file = base_dir / "pending" / f"{request.name}.py"
    approved_file = base_dir / "approved" / f"{request.name}.py"
    
    if pending_file.exists():
        pending_file.rename(approved_file)
    
    # Refresh loaded tools
    loader.refresh()
    
    return {"status": "approved", "name": request.name}


@router.post("/reject")
async def reject_tool(request: RejectRequest):
    """
    Reject a pending tool.
    Moves it from pending to rejected status.
    """
    success = registry.reject(request.name, request.reason or "")
    
    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"Tool '{request.name}' not found or not pending"
        )
    
    # Move file from pending to rejected
    from pathlib import Path
    base_dir = Path(__file__).parent.parent / "agent" / "generated_tools"
    pending_file = base_dir / "pending" / f"{request.name}.py"
    rejected_file = base_dir / "rejected" / f"{request.name}.py"
    
    if pending_file.exists():
        pending_file.rename(rejected_file)
    
    return {"status": "rejected", "name": request.name, "reason": request.reason}


@router.get("/{name}", response_model=ToolResponse)
async def get_tool(name: str):
    """Get a specific tool by name."""
    tool = registry.get_by_name(name)
    
    if not tool:
        raise HTTPException(status_code=404, detail=f"Tool '{name}' not found")
    
    return ToolResponse(
        name=tool.name,
        description=tool.description,
        code=tool.code,
        status=tool.status.value,
        risk_level=tool.risk_level,
        created_at=tool.created_at,
        approved_at=tool.approved_at,
        rejected_at=tool.rejected_at,
        rejection_reason=tool.rejection_reason
    )
