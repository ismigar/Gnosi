"""
Tool Loader: Dynamically loads approved tools at runtime.

Features:
- Load tools from approved/ directory
- Execute approved tools through a child-process proxy
- Refresh without restart
"""
from pathlib import Path
from typing import List, Optional
from langchain_core.tools import BaseTool

from .registry import registry, ToolStatus
from .validator import ToolValidator
from .sandbox_runner import SandboxedGeneratedTool, run_process, schema_model


class ToolLoader:
    """
    Dynamically loads approved tools from the registry and file system.
    """
    
    def __init__(self):
        from backend.config.app_config import load_params
        cfg = load_params(strict_env=False)
        
        # Priority: Vault-based approved tools > Local approved tools
        tools_base = cfg.paths.get("AGENT_TOOLS")
        if tools_base:
            self.approved_dir = tools_base / "approved"
        else:
            self.approved_dir = Path(__file__).parent / "approved"
            
        self.approved_dir.mkdir(parents=True, exist_ok=True)
        self._loaded_tools: dict = {}
        self._validator = ToolValidator()
    
    def load_all_approved(self) -> List[BaseTool]:
        """
        Load all approved tools from the registry.
        Returns list of LangChain tool objects.
        """
        tools = []
        approved_records = registry.list_approved()
        
        for record in approved_records:
            tool = self._load_tool(record.name, record.code)
            if tool:
                tools.append(tool)
                self._loaded_tools[record.name] = tool
        
        return tools
    
    def get_loaded_tool(self, name: str) -> Optional[BaseTool]:
        """Get a specific loaded tool by name."""
        return self._loaded_tools.get(name)
    
    def refresh(self) -> List[BaseTool]:
        """Reload all approved tools (useful after new approvals)."""
        self._loaded_tools.clear()
        return self.load_all_approved()

    def load_approved_record(self, record) -> Optional[BaseTool]:
        """Load one approved record lazily when an assigned skill invokes it."""

        existing = self._loaded_tools.get(record.name)
        if existing is not None:
            return existing
        tool = self._load_tool(record.name, record.code)
        if tool is not None:
            self._loaded_tools[record.name] = tool
        return tool
    
    def _load_tool(self, name: str, code: str) -> Optional[BaseTool]:
        """Load a validated tool as a subprocess-backed LangChain proxy."""
        from backend.config.logger_config import get_logger
        log = get_logger(__name__)
        try:
            validation = self._validator.validate(str(code or ""), name)
            if not validation.is_valid:
                log.error("Approved generated tool %r failed load-time validation", name)
                return None
            described = run_process(str(code or ""), action="describe", timeout_seconds=10)
            input_schema = described.get("input_schema") if isinstance(described.get("input_schema"), dict) else {}
            return SandboxedGeneratedTool(
                name=str(described.get("name") or name)[:128],
                description=str(described.get("description") or "")[:2_000],
                code=str(code or ""),
                args_schema=schema_model(input_schema, name),
            )

        except Exception as e:
            log.exception(f"Failed to load generated tool {name!r}: {e}")
            return None
    
    def is_loaded(self, name: str) -> bool:
        """Check if a tool is already loaded."""
        return name in self._loaded_tools


# Singleton instance
loader = ToolLoader()
