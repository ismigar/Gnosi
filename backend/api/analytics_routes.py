from fastapi import APIRouter, Depends, HTTPException, Query
from pathlib import Path
from typing import Any, Dict, List, Optional, cast
import re
import os
import shutil
from datetime import datetime

from backend.agent.generated_tools.registry import registry
from backend.domains.analytics.schemas import (
    AnalyticsOverviewResponse,
    DirectiveAnalyticsPageResponse,
    DirectiveContentResponse,
    DirectiveContentUpdateRequest,
    DirectiveMutationResponse,
    ToolAnalyticsResponse,
    TrapAnalyticsPageResponse,
)
from backend.utils.cache import global_cache
from backend.utils.safe_io import safe_write_text
from backend.utils.errors import safe_error_detail
from backend.services.workspace_service import require_role

router = APIRouter(prefix="/api/analytics", tags=["analytics"])
GNOSI_ROOT = Path(__file__).resolve().parents[2]

# --- Helpers ---


def _get_base_dir() -> Path:
    """Return the optional private development-memory root.

    Public checkouts never discover a parent workspace implicitly. A local
    operator may expose WorkspaceTools deliberately through this read-only
    configuration value.
    """
    configured = os.environ.get("GNOSI_DEV_MEMORY_ROOT")
    return Path(configured).expanduser().resolve() if configured else GNOSI_ROOT


def _get_trap_sources(base_dir: Path) -> List[Dict[str, Any]]:
    """Return list of directories to scan for traps and directives."""
    current_path = Path(__file__).resolve()

    return [
        # 1. Agent Instructions
        {
            "dir": current_path.parents[1] / "agent" / "instructions",
            "category": "Agent",
            "pattern": "*.md",
        },
        # 2. Dev Memory Directives
        {
            "dir": base_dir / "docs" / "dev_memory" / "directives",
            "category": "Directive",
            "pattern": "*.md",
        },
        # 3. Consolidated Skills
        {"dir": GNOSI_ROOT / "pipeline" / "skills", "category": "Skill", "pattern": "**/SKILL.md"},
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
                # Default to current year for DD/MM (no hardcodejar — caducaria
                # every January 1st).
                current_year = datetime.now().year
                return datetime.strptime(f"{date_str}/{current_year}", "%d/%m/%Y")
    except Exception:
        pass
    return datetime.min


def _extract_traps_from_file(md_file: Path, category: str) -> List[Dict[str, Any]]:
    """Extract table rows containing dates from a markdown file."""
    traps = []
    # Pattern to match various date formats: YYYY-MM-DD, DD/MM/YYYY, DD/MM, etc.
    date_pattern = re.compile(r"(\d{1,4}[-/]\d{1,2}([-/]\d{2,4})?)")

    try:
        content = md_file.read_text(encoding="utf-8")
        lines = content.split("\n")

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

                        traps.append(
                            {
                                "date": date_str,
                                "trap": trap,
                                "solution": solution,
                                "source": md_file.stem.replace("_", " ").capitalize(),
                                "category": category,
                            }
                        )
    except Exception:
        pass
    return traps


# --- Endpoints ---


@router.get("/", response_model=AnalyticsOverviewResponse)
async def get_analytics() -> Dict[str, Any]:
    """Get complete analytics overview (with cache)."""

    def _fetch() -> Dict[str, Any]:
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
            "directives": {"total": directive_count, "traps_documented": total_traps},
            "errors_prevented": total_traps,
        }

    return cast(
        Dict[str, Any],
        global_cache.get_or_set("analytics_overview", _fetch, ttl=300),
    )


@router.get("/tools", response_model=ToolAnalyticsResponse)
async def get_tool_analytics() -> Dict[str, Any]:
    """Get detailed tool analytics (Consolidated internally in registry)."""
    return registry.get_stats()


@router.get("/directives", response_model=DirectiveAnalyticsPageResponse)
async def get_directive_analytics(limit: int = 50, offset: int = 0) -> Dict[str, Any]:
    """Get directive analytics from all sources (with cache)."""

    def _fetch() -> List[Dict[str, Any]]:
        base_dir = _get_base_dir()
        sources = _get_trap_sources(base_dir)

        directives = []
        for src in sources:
            target_dir = src["dir"]
            if not target_dir or not target_dir.exists():
                continue

            for md_file in target_dir.glob(src["pattern"]):
                content = md_file.read_text(encoding="utf-8", errors="ignore")
                traps = _extract_traps_from_file(md_file, src["category"])

                # Use folder name for Skills, filename for others
                name = md_file.parent.name if src["category"] == "Skill" else md_file.stem

                directives.append(
                    {
                        "name": name.replace("_", " ").capitalize(),
                        "category": src["category"],
                        "size_bytes": len(content),
                        "trap_count": len(traps),
                        "path": str(md_file.resolve()),
                    }
                )

        # Sort by trap count descending
        directives.sort(key=lambda x: x["trap_count"], reverse=True)
        return directives

    all_directives = global_cache.get_or_set("analytics_directives", _fetch, ttl=600)
    total = len(all_directives)
    items = all_directives[offset : offset + limit]

    return {
        "directives": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": total > offset + limit,
    }


@router.get("/traps", response_model=TrapAnalyticsPageResponse)
async def get_traps(limit: int = 50, offset: int = 0) -> Dict[str, Any]:
    """Get all documented traps sorted by date (with cache)."""

    def _fetch() -> List[Dict[str, Any]]:
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
        return all_traps

    all_data = global_cache.get_or_set("analytics_traps", _fetch, ttl=600)
    total = len(all_data)
    items = all_data[offset : offset + limit]

    return {
        "traps": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": total > offset + limit,
    }


# --- Directive Management ---


def _validate_path(path_str: str, allow_missing: bool = False) -> Path:
    """Validate that the given path is within one of the approved directive sources."""
    # Ensure path is a Path object and resolve it
    try:
        path = Path(path_str).resolve()
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=safe_error_detail(e, "validate path format"),
        )

    base_dir = _get_base_dir()
    sources = _get_trap_sources(base_dir)

    is_valid = False
    valid_dirs = []

    for src in sources:
        src_dir = src["dir"].resolve()
        valid_dirs.append(str(src_dir))
        # Strict containment check via path semantics. Removed the previous
        # `str.startswith` OR fallback because that lets `<src>-attacker/...`
        # slip through (sibling directory whose name starts the same way).
        if path.is_relative_to(src_dir):
            is_valid = True
            break

    if not is_valid:
        print(f"PATH VALIDATION FAILED: {path} is not in {valid_dirs}")
        raise HTTPException(
            status_code=403, detail=f"Access denied: Path outside of allowed directories."
        )

    if not allow_missing and not path.exists():
        raise HTTPException(status_code=404, detail="File not found.")

    return path


@router.get("/directives/content", response_model=DirectiveContentResponse)
async def get_directive_content(path: str = Query(...)) -> Dict[str, Any]:
    """Read directive content. Returns empty if it's a new SKILL.md."""
    # Allow missing SKILL.md files to support creating documentation for existing skills
    allow_missing = path.endswith("SKILL.md")
    file_path = _validate_path(path, allow_missing=allow_missing)

    try:
        if not file_path.exists():
            return {"path": path, "content": ""}

        content = file_path.read_text(encoding="utf-8")
        return {"path": path, "content": content}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "GET /directives/content"),
        )


@router.post(
    "/directives/content",
    response_model=DirectiveMutationResponse,
    dependencies=[Depends(require_role("editor"))],
)
async def save_directive_content(
    payload: DirectiveContentUpdateRequest,
) -> Dict[str, Any]:
    """Update directive content."""
    file_path = _validate_path(payload.path, allow_missing=True)
    try:
        safe_write_text(file_path, payload.content)
        return {"message": "Updated successfully", "path": payload.path}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /directives/content"),
        )


@router.delete(
    "/directives",
    response_model=DirectiveMutationResponse,
    dependencies=[Depends(require_role("admin"))],
)
async def delete_directive(path: str = Query(...)) -> Dict[str, Any]:
    """Delete a directive file or an entire skill folder."""
    # Allow missing to support deleting skill folders even if SKILL.md isn't there yet
    file_path = _validate_path(path, allow_missing=True)
    try:
        # If it's a SKILL.md targeting a skill folder
        if path.endswith("SKILL.md") and file_path.parent.name != "directives":
            skill_dir = file_path.parent
            if skill_dir.exists() and skill_dir.is_dir():
                shutil.rmtree(skill_dir)
                return {"message": "Skill folder deleted successfully"}

        # Standard directive file deletion (must exist to be unlinked)
        if file_path.exists():
            file_path.unlink()

        return {"message": "Deleted successfully"}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "DELETE /directives"),
        )
