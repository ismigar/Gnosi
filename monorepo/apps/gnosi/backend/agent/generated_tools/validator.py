"""
Tool Validator: Validates auto-generated tool code for security.

Security Layers:
1. AST analysis for forbidden patterns
2. Whitelist of allowed imports
3. Detection of dangerous operations
"""
import ast
import re
from typing import List, Tuple
from dataclasses import dataclass
from enum import Enum


class RiskLevel(Enum):
    READ = "READ"                    # 🟢 Safe - read only
    LOCAL_WRITE = "LOCAL_WRITE"      # 🟡 Local filesystem writes
    EXTERNAL_READ = "EXTERNAL_READ"  # 🟠 External API reads
    EXTERNAL_WRITE = "EXTERNAL_WRITE" # 🔴 External API writes - REQUIRES APPROVAL


@dataclass
class ValidationResult:
    is_valid: bool
    errors: List[str]
    warnings: List[str]
    risk_level: RiskLevel
    

# Whitelist of allowed imports
ALLOWED_IMPORTS = {
    # Standard library (safe)
    "json", "datetime", "re", "typing", "pathlib", "os.path",
    "collections", "itertools", "functools", "dataclasses", "enum",
    # LangChain (required for tools)
    "langchain_core.tools",
    "langchain_core",
    # Project internals (controlled)
    "backend.agent.memory",
    "backend.mcp.client",
}

# Forbidden patterns in code
FORBIDDEN_PATTERNS = [
    (r"subprocess\.", "subprocess is forbidden - security risk"),
    (r"os\.system\(", "os.system is forbidden - security risk"),
    (r"os\.popen\(", "os.popen is forbidden - security risk"),
    (r"eval\(", "eval is forbidden - arbitrary code execution"),
    (r"exec\(", "exec is forbidden - arbitrary code execution"),
    (r"__import__\(", "__import__ is forbidden - dynamic imports not allowed"),
    (r"open\(.+['\"]w['\"]", "Direct file writing is restricted"),
    (r"requests\.", "Direct HTTP requests forbidden - use MCP client"),
    (r"urllib\.", "Direct HTTP requests forbidden - use MCP client"),
    (r"httpx\.", "Direct HTTP requests forbidden - use MCP client"),
    (r"aiohttp\.", "Direct HTTP requests forbidden - use MCP client"),
]

# AST-based detection (not regex): the patterns above were trivially bypassed
# by reassigning the name (`f = eval; f(x)`), with aliases (`imp = __import__`), or with
# modes the regex didn't cover (`open(p, "wb")`). The AST looks at the referenced NAME,
# not the call syntax, so these tricks don't escape detection.
#
# HONEST NOTE: this does NOT turn the validator into a real sandbox. `pathlib`
# (allowed) can still read/write arbitrary files and `__import__` is left
# alive in the loader; real containment is an architecture decision (human
# approval or process sandbox). These checks close the DEMONSTRATED ESCAPES and
# make the validator actually enforce its own list of prohibitions.
_FORBIDDEN_NAMES = {
    "eval", "exec", "compile", "__import__", "breakpoint",
    "globals", "locals", "vars", "getattr", "setattr", "delattr",
    "memoryview", "input",
}
# Dangerous attributes (Attribute node): introspection dunders that lead to
# `__globals__`/`__subclasses__` (classic escapes) and `os` methods that operate
# about the system or environment without going through any regex (`os.environ`,
# `os.remove`, `os.system`…).
_FORBIDDEN_ATTRS = {
    "system", "popen", "environ", "getenv", "putenv", "unsetenv",
    "remove", "unlink", "rmdir", "removedirs", "rename", "renames",
    "chmod", "chown", "startfile", "fork",
    "spawnl", "spawnv", "spawnvpe", "execv", "execl", "execve",
    "__globals__", "__builtins__", "__subclasses__", "__bases__",
    "__mro__", "__code__", "__closure__", "__getattribute__", "__reduce__",
}
# `open()` mode characters that imply writing (anything but pure read).
_WRITE_OPEN_CHARS = set("wax+")


# Keywords that suggest external write operations
EXTERNAL_WRITE_KEYWORDS = [
    "create", "update", "delete", "patch", "post", "put",
    "write", "modify", "insert", "remove", "add"
]

EXTERNAL_READ_KEYWORDS = [
    "query", "search", "get", "fetch", "read", "list", "retrieve"
]


class ToolValidator:
    """Validates auto-generated tool code for security and correctness."""
    
    def __init__(self):
        self.allowed_imports = ALLOWED_IMPORTS
        self.forbidden_patterns = FORBIDDEN_PATTERNS
    
    def validate(self, code: str, tool_name: str = "") -> ValidationResult:
        """
        Validate tool code.
        Returns ValidationResult with is_valid, errors, warnings, and risk_level.
        """
        errors = []
        warnings = []
        risk_level = RiskLevel.READ  # Start with safest level
        
        # 1. Check forbidden patterns (regex)
        for pattern, message in self.forbidden_patterns:
            if re.search(pattern, code):
                errors.append(f"Forbidden pattern detected: {message}")
        
        # 2. Parse AST
        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            errors.append(f"Syntax error: {e}")
            return ValidationResult(
                is_valid=False,
                errors=errors,
                warnings=warnings,
                risk_level=RiskLevel.EXTERNAL_WRITE  # Assume worst for unparseable
            )
        
        # 3. Check imports
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if not self._is_import_allowed(alias.name):
                        errors.append(f"Import not allowed: {alias.name}")
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                if not self._is_import_allowed(module):
                    errors.append(f"Import not allowed: from {module}")
        
        # 3.5. AST-based escapes (robust against reassignment/aliasing that regex can't see)
        self._check_dangerous_ast(tree, errors)

        # 4. Check for @tool decorator
        has_tool_decorator = False
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                for decorator in node.decorator_list:
                    if isinstance(decorator, ast.Name) and decorator.id == "tool":
                        has_tool_decorator = True
                        break
        
        if not has_tool_decorator:
            errors.append("Tool must have @tool decorator from langchain_core.tools")
        
        # 5. Determine risk level from function names and docstrings
        risk_level = self._analyze_risk_level(tree, tool_name)
        
        # 6. Add warnings for external operations
        if risk_level == RiskLevel.EXTERNAL_WRITE:
            warnings.append("This tool performs external write operations - requires user approval")
        elif risk_level == RiskLevel.EXTERNAL_READ:
            warnings.append("This tool reads from external sources")
        
        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            risk_level=risk_level
        )
    
    def _check_dangerous_ast(self, tree: ast.AST, errors: List[str]) -> None:
        """Detects escapes referenced by NAME (not by call syntax).

        Closes the regex bypasses: `f = eval`, `imp = __import__`,
        `getattr(o, "__globals__")`, `os.environ`, `open(p, "wb")`. Looks at the
        Name/Attribute/Call nodes of the AST, so reassigning or splitting the name
        doesn't avoid detection.
        
        """
        for node in ast.walk(tree):
            # Dangerous name referenced in any way (call, alias, arg…).
            if isinstance(node, ast.Name) and node.id in _FORBIDDEN_NAMES:
                errors.append(f"Forbidden name referenced: {node.id}")
            # Access to a dangerous attribute (os.environ, x.__globals__, …).
            elif isinstance(node, ast.Attribute) and node.attr in _FORBIDDEN_ATTRS:
                errors.append(f"Forbidden attribute access: .{node.attr}")
            # `open(...)` with a write mode (anything other than pure read).
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                    and node.func.id == "open":
                mode = None
                if len(node.args) >= 2:
                    mode = node.args[1]
                else:
                    mode = next((kw.value for kw in node.keywords if kw.arg == "mode"), None)
                if mode is None:
                    continue  # open(p) → read by default
                if isinstance(mode, ast.Constant) and isinstance(mode.value, str):
                    if set(mode.value) & _WRITE_OPEN_CHARS:
                        errors.append("Forbidden: open() in a write mode")
                else:
                    # Non-literal mode (variable): cannot be verified → blocked.
                    errors.append("Forbidden: open() with a non-literal mode")

    def _is_import_allowed(self, module: str) -> bool:
        """Check if a module import is allowed."""
        # Check exact match
        if module in self.allowed_imports:
            return True
        # Check if it's a submodule of allowed module
        for allowed in self.allowed_imports:
            if module.startswith(allowed + "."):
                return True
        return False
    
    def _analyze_risk_level(self, tree: ast.AST, tool_name: str) -> RiskLevel:
        """
        Analyze the AST to determine the risk level of the tool.
        """
        # Check tool name for keywords
        name_lower = tool_name.lower()
        
        # Check for MCP calls (external operations)
        has_mcp_call = False
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute):
                if hasattr(node, 'attr') and 'mcp' in str(node.attr).lower():
                    has_mcp_call = True
                    break
            if isinstance(node, ast.Name):
                if 'mcp' in node.id.lower():
                    has_mcp_call = True
                    break
        
        # Determine level based on keywords
        for keyword in EXTERNAL_WRITE_KEYWORDS:
            if keyword in name_lower:
                if has_mcp_call:
                    return RiskLevel.EXTERNAL_WRITE
                return RiskLevel.LOCAL_WRITE
        
        for keyword in EXTERNAL_READ_KEYWORDS:
            if keyword in name_lower:
                if has_mcp_call:
                    return RiskLevel.EXTERNAL_READ
                return RiskLevel.READ
        
        # Default based on MCP usage
        if has_mcp_call:
            return RiskLevel.EXTERNAL_READ
        
        return RiskLevel.READ


# Singleton instance
validator = ToolValidator()
