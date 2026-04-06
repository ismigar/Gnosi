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
        self.base_dir = Path(__file__).parent
        self.approved_dir = self.base_dir / "approved"
        self.approved_dir.mkdir(exist_ok=True)
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
    
    def _load_tool(self, name: str, code: str) -> Optional[BaseTool]:
        """
        Dynamically load a tool from code string.
        Uses importlib to create a module and extract the tool.
        """
        try:
            # Create a temporary module
            module_name = f"generated_tool_{name}"
            spec = importlib.util.spec_from_loader(module_name, loader=None)
            if spec is None:
                return None
                
            module = importlib.util.module_from_spec(spec)
            
            # Execute the code in the module's namespace
            exec(code, module.__dict__)
            
            # Register the module
            sys.modules[module_name] = module
            
            # Find the tool function (decorated with @tool)
            for attr_name in dir(module):
                attr = getattr(module, attr_name)
                if isinstance(attr, BaseTool):
                    return attr
                # Also check for StructuredTool or functions with __tool__ marker
                if callable(attr) and hasattr(attr, 'name'):
                    return attr
            
            return None
            
        except Exception as e:
            print(f"Error loading tool {name}: {e}")
            return None
    
    def is_loaded(self, name: str) -> bool:
        """Check if a tool is already loaded."""
        return name in self._loaded_tools


# Singleton instance
loader = ToolLoader()
