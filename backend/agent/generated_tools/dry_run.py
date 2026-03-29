"""
Dry-Run Wrapper: Preview external operations before execution.

For EXTERNAL_WRITE tools, this wrapper:
1. Intercepts the call
2. Shows what WOULD happen (preview)
3. Requires confirmation before actual execution
"""
from typing import Callable, Any, Dict, Optional
from functools import wraps
from dataclasses import dataclass
import json

from .validator import RiskLevel


@dataclass
class DryRunResult:
    """Result of a dry-run preview."""
    tool_name: str
    arguments: Dict[str, Any]
    preview: str
    risk_level: str
    requires_confirmation: bool


class DryRunManager:
    """
    Manages dry-run previews for external write operations.
    Stores pending confirmations and executes after user approval.
    """
    
    def __init__(self):
        self._pending_executions: Dict[str, Dict] = {}
    
    def create_preview(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        risk_level: RiskLevel
    ) -> DryRunResult:
        """
        Create a preview of what the tool would do.
        """
        # Generate human-readable preview
        preview = self._generate_preview(tool_name, arguments)
        
        requires_confirmation = risk_level == RiskLevel.EXTERNAL_WRITE
        
        if requires_confirmation:
            # Store for later execution
            execution_id = f"{tool_name}_{hash(json.dumps(arguments, default=str)) % 10000}"
            self._pending_executions[execution_id] = {
                "tool_name": tool_name,
                "arguments": arguments,
                "preview": preview,
            }
        
        return DryRunResult(
            tool_name=tool_name,
            arguments=arguments,
            preview=preview,
            risk_level=risk_level.value,
            requires_confirmation=requires_confirmation
        )
    
    def _generate_preview(self, tool_name: str, arguments: Dict[str, Any]) -> str:
        """Generate a human-readable preview of the operation."""
        
        # Common patterns for Notion operations
        if "notion" in tool_name.lower() or "page" in tool_name.lower():
            if "create" in tool_name.lower():
                return f"🆕 Crearà una nova pàgina a Notion amb: {json.dumps(arguments, indent=2, default=str)[:200]}..."
            elif "update" in tool_name.lower() or "patch" in tool_name.lower():
                page_id = arguments.get("page_id", arguments.get("id", "desconegut"))
                return f"✏️ Modificarà la pàgina {page_id} amb els canvis especificats"
            elif "delete" in tool_name.lower():
                page_id = arguments.get("page_id", arguments.get("id", "desconegut"))
                return f"🗑️ ELIMINARÀ la pàgina {page_id} - ACCIÓ IRREVERSIBLE"
        
        # Common patterns for n8n operations
        if "n8n" in tool_name.lower() or "workflow" in tool_name.lower():
            if "create" in tool_name.lower():
                return f"🔧 Crearà un nou workflow a n8n: {arguments.get('name', 'sense nom')}"
            elif "update" in tool_name.lower():
                return f"✏️ Modificarà el workflow {arguments.get('id', 'desconegut')}"
            elif "activate" in tool_name.lower():
                return f"▶️ Activarà el workflow {arguments.get('id', 'desconegut')}"
        
        # Generic fallback
        return f"⚠️ Executarà '{tool_name}' amb arguments: {json.dumps(arguments, default=str)[:150]}..."
    
    def get_pending(self, execution_id: str) -> Optional[Dict]:
        """Get a pending execution by ID."""
        return self._pending_executions.get(execution_id)
    
    def confirm_execution(self, execution_id: str) -> bool:
        """
        Confirm a pending execution.
        Returns True if found and removed from pending.
        """
        if execution_id in self._pending_executions:
            del self._pending_executions[execution_id]
            return True
        return False
    
    def cancel_execution(self, execution_id: str) -> bool:
        """Cancel a pending execution."""
        return self.confirm_execution(execution_id)  # Same action: remove from pending
    
    def list_pending(self) -> Dict[str, Dict]:
        """List all pending executions."""
        return self._pending_executions.copy()


def dry_run_protect(risk_level: RiskLevel):
    """
    Decorator that wraps a tool function with dry-run protection.
    For EXTERNAL_WRITE tools, returns a preview instead of executing.
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            if risk_level == RiskLevel.EXTERNAL_WRITE:
                # Return preview instead of executing
                preview = dry_run_manager.create_preview(
                    tool_name=func.__name__,
                    arguments=kwargs,
                    risk_level=risk_level
                )
                return (
                    f"⚠️ ACCIÓ DE RISC: Requereix confirmació.\n"
                    f"Previsualització:\n{preview.preview}\n\n"
                    f"Per confirmar, aprova l'acció al Dashboard."
                )
            else:
                # Execute directly for safe operations
                return func(*args, **kwargs)
        return wrapper
    return decorator


# Singleton instance
dry_run_manager = DryRunManager()
