"""
Tool Loader: Dynamically loads approved tools at runtime.

Features:
- Load tools from approved/ directory
- Dynamic import using importlib
- Refresh without restart
"""
import importlib.util
import sys
from pathlib import Path
from typing import List, Optional
from langchain_core.tools import BaseTool

from .registry import registry, ToolStatus


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
        """
        Dynamically load a tool from code string.
        Uses importlib to create a module and extract the tool.

        Security: this loads tools that have already been APPROVED via the
        validator + sandbox + human review pipeline — that gate is the
        primary defense. As defense-in-depth we still strip the most obvious
        sandbox-escape primitives (`eval`, `exec`, `compile`, `type`) from
        the execution namespace. `__import__` is left in place because real
        tools need to import standard libraries.
        """
        from backend.config.logger_config import get_logger
        log = get_logger(__name__)
        try:
            # Create a temporary module
            module_name = f"generated_tool_{name}"
            spec = importlib.util.spec_from_loader(module_name, loader=None)
            if spec is None:
                return None

            module = importlib.util.module_from_spec(spec)

            log.info(f"🛠️  Loading approved generated tool: {name}")

            # Restrict builtins as defense-in-depth. Tools may still use
            # `__import__` to pull in stdlib modules (which is required for
            # most useful tools), so this is not a real sandbox — just a
            # tripwire against the most direct escapes.
            import builtins as _builtins
            unsafe_names = {"eval", "exec", "compile", "type"}
            safe_builtins = {
                k: v for k, v in vars(_builtins).items() if k not in unsafe_names
            }
            module.__dict__["__builtins__"] = safe_builtins

            # Execute the code in the module's namespace
            exec(code, module.__dict__)

            # Register the module
            sys.modules[module_name] = module

            # Find the tool function. We only accept real BaseTool instances or
            # callables explicitly marked with `__tool__ = True`. Previously
            # we accepted any callable with `.name`, which could
            # capture functions decorated with arbitrary metadata.
            for attr_name in dir(module):
                attr = getattr(module, attr_name)
                if isinstance(attr, BaseTool):
                    return attr
                if callable(attr) and getattr(attr, "__tool__", False) is True:
                    return attr

            return None

        except Exception as e:
            log.exception(f"Failed to load generated tool {name!r}: {e}")
            return None
    
    def is_loaded(self, name: str) -> bool:
        """Check if a tool is already loaded."""
        return name in self._loaded_tools


# Singleton instance
loader = ToolLoader()
