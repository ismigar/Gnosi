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

# Detecció per AST (no regex): els patrons de dalt es bypassaven trivialment
# reassignant el nom (`f = eval; f(x)`), amb àlies (`imp = __import__`), o amb
# modes que la regex no cobria (`open(p, "wb")`). L'AST mira el NOM referenciat,
# no la sintaxi de crida, així que aquests trucs no s'escapen.
#
# NOTA HONESTA: això NO converteix el validador en un sandbox real. `pathlib`
# (permès) encara pot llegir/escriure fitxers arbitraris i `__import__` es deixa
# viu al loader; la contenció real és una decisió d'arquitectura (aprovació
# humana o sandbox de procés). Aquests checks tanquen els ESCAPES DEMOSTRATS i
# fan que el validador enforci de debò la seva pròpia llista de prohibicions.
_FORBIDDEN_NAMES = {
    "eval", "exec", "compile", "__import__", "breakpoint",
    "globals", "locals", "vars", "getattr", "setattr", "delattr",
    "memoryview", "input",
}
# Atributs perillosos (Attribute node): dunders d'introspecció que porten a
# `__globals__`/`__subclasses__` (escapes clàssics) i mètodes d'`os` que operen
# sobre el sistema o l'entorn sense passar per cap regex (`os.environ`,
# `os.remove`, `os.system`…).
_FORBIDDEN_ATTRS = {
    "system", "popen", "environ", "getenv", "putenv", "unsetenv",
    "remove", "unlink", "rmdir", "removedirs", "rename", "renames",
    "chmod", "chown", "startfile", "fork",
    "spawnl", "spawnv", "spawnvpe", "execv", "execl", "execve",
    "__globals__", "__builtins__", "__subclasses__", "__bases__",
    "__mro__", "__code__", "__closure__", "__getattribute__", "__reduce__",
}
# Caràcters de mode d'`open()` que impliquen escriptura (tot menys lectura pura).
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
        
        # 3.5. Escapes per AST (robust davant reassignació/àlies que la regex no veu)
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
        """Detecta escapes referenciats pel NOM (no per la sintaxi de crida).

        Tanca els bypasses de la regex: `f = eval`, `imp = __import__`,
        `getattr(o, "__globals__")`, `os.environ`, `open(p, "wb")`. Mira els
        nodes Name/Attribute/Call de l'AST, així que reassignar o partir el nom
        no evita la detecció.
        """
        for node in ast.walk(tree):
            # Nom perillós referenciat de qualsevol manera (crida, àlies, arg…).
            if isinstance(node, ast.Name) and node.id in _FORBIDDEN_NAMES:
                errors.append(f"Forbidden name referenced: {node.id}")
            # Accés a atribut perillós (os.environ, x.__globals__, …).
            elif isinstance(node, ast.Attribute) and node.attr in _FORBIDDEN_ATTRS:
                errors.append(f"Forbidden attribute access: .{node.attr}")
            # `open(...)` amb un mode d'escriptura (qualsevol menys lectura pura).
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                    and node.func.id == "open":
                mode = None
                if len(node.args) >= 2:
                    mode = node.args[1]
                else:
                    mode = next((kw.value for kw in node.keywords if kw.arg == "mode"), None)
                if mode is None:
                    continue  # open(p) → lectura per defecte
                if isinstance(mode, ast.Constant) and isinstance(mode.value, str):
                    if set(mode.value) & _WRITE_OPEN_CHARS:
                        errors.append("Forbidden: open() in a write mode")
                else:
                    # Mode no literal (variable): no es pot verificar → es bloqueja.
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
