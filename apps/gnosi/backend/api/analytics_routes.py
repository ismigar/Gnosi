"""
Analytics Routes: API endpoints for metrics and statistics.
"""
from fastapi import APIRouter
from pathlib import Path
from typing import Dict, Any

from backend.agent.generated_tools.registry import registry
from backend.agent.generated_tools.learning_loop import LearningLoop

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("")
async def get_analytics() -> Dict[str, Any]:
    """Get complete analytics overview."""
    # Tool statistics
    tool_stats = registry.get_stats()
    
    # Directive statistics
    instructions_dir = Path(__file__).parent.parent / "agent" / "instructions"
    if not instructions_dir.exists():
        instructions_dir = Path(__file__).parent.parent.parent / "backend" / "instructions"
    
    directive_count = 0
    trap_count = 0
    
    if instructions_dir.exists():
        for md_file in instructions_dir.glob("*.md"):
            directive_count += 1
            content = md_file.read_text()
            # Count traps (table rows with dates)
            import re
            traps = re.findall(r'\| \d{4}-\d{2}-\d{2} \|', content)
            trap_count += len(traps)
    
    return {
        "tools": tool_stats,
        "directives": {
            "total": directive_count,
            "traps_documented": trap_count
        },
        "errors_prevented": trap_count,  # Each trap is a potentially avoided error
    }


@router.get("/tools")
async def get_tool_analytics() -> Dict[str, Any]:
    """Get detailed tool analytics."""
    return registry.get_stats()


@router.get("/directives")
async def get_directive_analytics() -> Dict[str, Any]:
    """Get directive analytics."""
    instructions_dir = Path(__file__).parent.parent / "agent" / "instructions"
    if not instructions_dir.exists():
        instructions_dir = Path(__file__).parent.parent.parent / "backend" / "instructions"
    
    directives = []
    if instructions_dir.exists():
        for md_file in instructions_dir.glob("*.md"):
            content = md_file.read_text()
            import re
            traps = re.findall(r'\| \d{4}-\d{2}-\d{2} \|', content)
            directives.append({
                "name": md_file.stem,
                "size_bytes": len(content),
                "trap_count": len(traps)
            })
    
    return {
        "directives": directives,
        "total": len(directives)
    }
