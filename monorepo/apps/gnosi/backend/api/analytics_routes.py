from fastapi import APIRouter, HTTPException, Query, Body
from pathlib import Path
from typing import Dict, Any, List, Optional
import re
import os
from datetime import datetime

from backend.agent.generated_tools.registry import registry

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

# --- Helpers ---

def _get_base_dir() -> Path:
    """Find monorepo root. Priority to absolute path for Docker stability."""
    # Priority 1: Direct absolute path (works in Docker thanks to volume mount)
    host_root = Path("/Users/ismaelgarciafernandez/Projectes")
    if host_root.exists():
        return host_root
        
    # Priority 2: Walk up from current file (works for local dev without Docker)
    current_path = Path(__file__).resolve().parent
    base_dir = current_path
    for _ in range(10):
        if (base_dir / "monorepo").exists() and (base_dir / "docs").exists():
            return base_dir
        if base_dir.parent == base_dir:
            break
        base_dir = base_dir.parent
        
    # Fallback
    try:
        return Path(__file__).resolve().parents[5]
    except IndexError:
        return Path(__file__).resolve().parent

def _get_trap_sources(base_dir: Path) -> List[Dict[str, Any]]:
    """Return list of directories to scan for traps and directives."""
    current_path = Path(__file__).resolve()
    return [
        # 1. Agent Instructions
        {
            "dir": current_path.parents[1] / "agent" / "instructions",
            "category": "Agent",
            "pattern": "*.md"
        },
        # 2. Dev Memory Directives
        {
            "dir": base_dir / "docs" / "dev_memory" / "directives",
            "category": "Directive",
            "pattern": "*.md"
        },
        # 3. Consolidated Skills
        {
            "dir": base_dir / "monorepo" / "apps" / "gnosi" / "pipeline" / "skills",
            "category": "Skill",
            "pattern": "**/SKILL.md"
        }
    ]

def _parse_date(date_str: str) -> datetime:
    """Parse various date formats into datetime objects for sorting."""
    try:
        # Handle YYYY-MM-DD
        if "-" in date_str and len(date_str.split("-")[0]) == 4:
            return datetime.strptime(date_str, "%Y-%m-%d")
        
        # Handle DD/MM/YYYY or DD/MM
        if "/" in date_str:
            parts = date_str.split("/")
            if len(parts) == 3:
                if len(parts[2]) == 2:
                    return datetime.strptime(date_str, "%d/%m/%y")
                return datetime.strptime(date_str, "%d/%m/%Y")
            if len(parts) == 2:
                # Default to current year for DD/MM
                return datetime.strptime(f"{date_str}/2026", "%d/%m/%Y")
    except Exception:
        pass
    return datetime.min

def _extract_traps_from_file(md_file: Path, category: str) -> List[Dict[str, Any]]:
    """Extract table rows containing dates from a markdown file."""
    traps = []
    # Pattern to match various date formats: YYYY-MM-DD, DD/MM/YYYY, DD/MM, etc.
    date_pattern = re.compile(r'(\d{1,4}[-/]\d{1,2}([-/]\d{2,4})?)')
    
    try:
        content = md_file.read_text(encoding='utf-8')
        lines = content.split('\n')
        
        for line in lines:
            if "|" in line:
                date_match = date_pattern.search(line)
                if date_match:
                    parts = [p.strip() for p in line.split("|") if p.strip()]
                    if len(parts) >= 3:
                        date_str = parts[0]
                        # Skip header rows
                        if any(x in date_str for x in ["Date", "Data"]):
                            continue
                            
                        if len(parts) == 3:
                            trap = parts[1]
                            solution = parts[2]
                        else:
                            trap = parts[1]
                            solution = parts[-1] 
                        
                        # Unify date format to dd/mm/yyyy
                        dt = _parse_date(date_str)
                        if dt != datetime.min:
                            date_str = dt.strftime("%d/%m/%Y")
                        
                        traps.append({
                            "date": date_str,
                            "trap": trap,
                            "solution": solution,
                            "source": md_file.stem.replace("_", " ").capitalize(),
                            "category": category
                        })
    except Exception:
        pass
    return traps

# --- Endpoints ---

@router.get("/")
async def get_analytics() -> Dict[str, Any]:
    """Get complete analytics overview."""
    # 1. Tool statistics (Consolidated internally in registry)
    tool_stats = registry.get_stats()
    
    # 2. Trap & Directive statistics
    base_dir = _get_base_dir()
    sources = _get_trap_sources(base_dir)
    
    total_traps = 0
    directive_count = 0
    
    for src in sources:
        target_dir = src["dir"]
        if not target_dir or not target_dir.exists():
            continue
            
        for md_file in target_dir.glob(src["pattern"]):
            directive_count += 1
            traps = _extract_traps_from_file(md_file, src["category"])
            total_traps += len(traps)
    
    return {
        "tools": tool_stats,
        "directives": {
            "total": directive_count,
            "traps_documented": total_traps
        },
        "errors_prevented": total_traps,
    }

@router.get("/tools")
async def get_tool_analytics() -> Dict[str, Any]:
    """Get detailed tool analytics (Consolidated internally in registry)."""
    return registry.get_stats()

@router.get("/directives")
async def get_directive_analytics() -> Dict[str, Any]:
    """Get directive analytics from all sources."""
    base_dir = _get_base_dir()
    sources = _get_trap_sources(base_dir)
    
    directives = []
    for src in sources:
        target_dir = src["dir"]
        if not target_dir or not target_dir.exists():
            continue
            
        for md_file in target_dir.glob(src["pattern"]):
            content = md_file.read_text(encoding='utf-8', errors='ignore')
            traps = _extract_traps_from_file(md_file, src["category"])
            
            # Use folder name for Skills, filename for others
            name = md_file.parent.name if src["category"] == "Skill" else md_file.stem
            
            directives.append({
                "name": name.replace("_", " ").capitalize(),
                "category": src["category"],
                "size_bytes": len(content),
                "trap_count": len(traps),
                "path": str(md_file.resolve())
            })
    
    # Sort by trap count descending
    directives.sort(key=lambda x: x["trap_count"], reverse=True)
    
    return {
        "directives": directives,
        "total": len(directives)
    }

@router.get("/traps")
async def get_traps() -> Dict[str, Any]:
    """Get all documented traps sorted by date."""
    base_dir = _get_base_dir()
    sources = _get_trap_sources(base_dir)
    
    all_traps = []
    for src in sources:
        target_dir = src["dir"]
        if not target_dir or not target_dir.exists():
            continue
            
        for md_file in target_dir.glob(src["pattern"]):
            file_traps = _extract_traps_from_file(md_file, src["category"])
            
            # Enhacing source name if it's a SKILL.md
            if src["category"] == "Skill":
                skill_name = md_file.parent.name.replace("_", " ").capitalize()
                for t in file_traps:
                    t["source"] = skill_name
                    
            all_traps.extend(file_traps)
                
    # Sort by date descending
    all_traps.sort(key=lambda x: _parse_date(x["date"]), reverse=True)
    
# --- Directive Management ---

def _validate_path(path_str: str) -> Path:
    """Validate that the given path is within one of the approved directive sources."""
    path = Path(path_str).resolve()
    base_dir = _get_base_dir()
    sources = _get_trap_sources(base_dir)
    
    is_valid = False
    for src in sources:
        src_dir = src["dir"].resolve()
        # Check if the path is a child of the source directory
        if path.is_relative_to(src_dir):
            is_valid = True
            break
            
    if not is_valid:
        raise HTTPException(status_code=403, detail="Access denied: Path outside of allowed directive directories.")
        
    if not path.exists():
        raise HTTPException(status_code=404, detail="Directive file not found.")
        
    return path

@router.get("/directives/content")
async def get_directive_content(path: str = Query(...)) -> Dict[str, Any]:
    """Read directive content."""
    file_path = _validate_path(path)
    try:
        content = file_path.read_text(encoding='utf-8')
        return {
            "path": path,
            "content": content
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading directive: {str(e)}")

@router.post("/directives/content")
async def save_directive_content(
    path: str = Body(...),
    content: str = Body(...)
) -> Dict[str, Any]:
    """Update directive content."""
    file_path = _validate_path(path)
    try:
        file_path.write_text(content, encoding='utf-8')
        return {"message": "Directive updated successfully", "path": path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving directive: {str(e)}")

@router.delete("/directives")
async def delete_directive(path: str = Query(...)) -> Dict[str, Any]:
    """Delete a directive file."""
    file_path = _validate_path(path)
    try:
        # Prevent deleting critical SKILL.md files entirely if possible?
        # For now, allow it but maybe the user will be careful.
        file_path.unlink()
        return {"message": "Directive deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting directive: {str(e)}")
