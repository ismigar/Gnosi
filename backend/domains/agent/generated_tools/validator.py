"""Security validation for generated agent tools."""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from enum import Enum


class RiskLevel(Enum):
    READ = "READ"  # 🟢 Safe - read only
    LOCAL_WRITE = "LOCAL_WRITE"  # 🟡 Local filesystem writes
    EXTERNAL_READ = "EXTERNAL_READ"  # 🟠 External API reads
    EXTERNAL_WRITE = "EXTERNAL_WRITE"  # 🔴 External API writes - REQUIRES APPROVAL


@dataclass
class ValidationResult:
    is_valid: bool
    errors: list[str]
    warnings: list[str]
    risk_level: RiskLevel


ALLOWED_IMPORTS = {
    # Standard library (safe)
    "json",
    "datetime",
    "re",
    "typing",
    "pathlib",
    "os.path",
    "collections",
    "itertools",
    "functools",
    "dataclasses",
    "enum",
    # LangChain (required for tools)
    "langchain_core.tools",
    "langchain_core",
    # Project internals (controlled)
    "backend.agent.memory",
    "backend.mcp.client",
}


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


_FORBIDDEN_NAMES = {
    "eval",
    "exec",
    "compile",
    "__import__",
    "breakpoint",
    "globals",
    "locals",
    "vars",
    "getattr",
    "setattr",
    "delattr",
    "memoryview",
    "input",
}


_FORBIDDEN_ATTRS = {
    "system",
    "popen",
    "environ",
    "getenv",
    "putenv",
    "unsetenv",
    "remove",
    "unlink",
    "rmdir",
    "removedirs",
    "rename",
    "renames",
    "chmod",
    "chown",
    "startfile",
    "fork",
    "spawnl",
    "spawnv",
    "spawnvpe",
    "execv",
    "execl",
    "execve",
    "__globals__",
    "__builtins__",
    "__subclasses__",
    "__bases__",
    "__mro__",
    "__code__",
    "__closure__",
    "__getattribute__",
    "__reduce__",
}


_WRITE_OPEN_CHARS = set("wax+")


_FORBIDDEN_IN_STRINGS = {a for a in _FORBIDDEN_ATTRS if a.startswith("__")}


EXTERNAL_WRITE_KEYWORDS = [
    "create",
    "update",
    "delete",
    "patch",
    "post",
    "put",
    "write",
    "modify",
    "insert",
    "remove",
    "add",
]


EXTERNAL_READ_KEYWORDS = ["query", "search", "get", "fetch", "read", "list", "retrieve"]


class ToolValidator:
    """Validates auto-generated tool code for security and correctness."""

    def __init__(self) -> None:
        self.allowed_imports = ALLOWED_IMPORTS
        self.forbidden_patterns = FORBIDDEN_PATTERNS

    def _forbidden_pattern_errors(self, code: str) -> list[str]:
        return [
            f"Forbidden pattern detected: {message}"
            for pattern, message in self.forbidden_patterns
            if re.search(pattern, code)
        ]

    def _import_errors(self, tree: ast.AST) -> list[str]:
        errors: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                errors.extend(
                    f"Import not allowed: {alias.name}"
                    for alias in node.names
                    if not self._is_import_allowed(alias.name)
                )
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                if not self._is_import_allowed(module):
                    errors.append(f"Import not allowed: from {module}")
        return errors

    @staticmethod
    def _has_tool_decorator(tree: ast.AST) -> bool:
        return any(
            isinstance(node, ast.FunctionDef)
            and any(
                isinstance(decorator, ast.Name) and decorator.id == "tool"
                for decorator in node.decorator_list
            )
            for node in ast.walk(tree)
        )

    @staticmethod
    def _risk_warnings(risk_level: RiskLevel) -> list[str]:
        if risk_level == RiskLevel.EXTERNAL_WRITE:
            return ["This tool performs external write operations - requires user approval"]
        if risk_level == RiskLevel.EXTERNAL_READ:
            return ["This tool reads from external sources"]
        return []

    def validate(self, code: str, tool_name: str = "") -> ValidationResult:
        """
        Validate tool code.
        Returns ValidationResult with is_valid, errors, warnings, and risk_level.
        """
        errors = self._forbidden_pattern_errors(code)

        # 2. Parse AST
        try:
            tree = ast.parse(code)
        except SyntaxError as error:
            errors.append(f"Syntax error: {error}")
            return ValidationResult(
                is_valid=False,
                errors=errors,
                warnings=[],
                risk_level=RiskLevel.EXTERNAL_WRITE,  # Assume worst for unparseable
            )

        errors.extend(self._import_errors(tree))
        self._check_dangerous_ast(tree, errors)
        if not self._has_tool_decorator(tree):
            errors.append("Tool must have @tool decorator from langchain_core.tools")

        risk_level = self._analyze_risk_level(tree, tool_name)
        return ValidationResult(
            is_valid=not errors,
            errors=errors,
            warnings=self._risk_warnings(risk_level),
            risk_level=risk_level,
        )

    @staticmethod
    def _open_mode_error(node: ast.Call) -> str | None:
        mode: ast.expr | None = None
        if len(node.args) >= 2:
            mode = node.args[1]
        else:
            mode = next(
                (keyword.value for keyword in node.keywords if keyword.arg == "mode"),
                None,
            )
        if mode is None:
            return None
        if isinstance(mode, ast.Constant) and isinstance(mode.value, str):
            if set(mode.value) & _WRITE_OPEN_CHARS:
                return "Forbidden: open() in a write mode"
            return None
        return "Forbidden: open() with a non-literal mode"

    @classmethod
    def _dangerous_ast_error(cls, node: ast.AST) -> str | None:
        if isinstance(node, ast.Name) and node.id in _FORBIDDEN_NAMES:
            return f"Forbidden name referenced: {node.id}"
        if isinstance(node, ast.Attribute) and node.attr in _FORBIDDEN_ATTRS:
            return f"Forbidden attribute access: .{node.attr}"
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            forbidden = next(
                (value for value in _FORBIDDEN_IN_STRINGS if value in node.value),
                None,
            )
            if forbidden:
                return f"Forbidden introspection dunder in string literal: {forbidden}"
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "open"
        ):
            return cls._open_mode_error(node)
        return None

    def _check_dangerous_ast(self, tree: ast.AST, errors: list[str]) -> None:
        """Detects escapes referenced by NAME (not by call syntax).

        Closes the regex bypasses: `f = eval`, `imp = __import__`,
        `getattr(o, "__globals__")`, `os.environ`, `open(p, "wb")`. Looks at the
        Name/Attribute/Call nodes of the AST, so reassigning or splitting the name
        doesn't avoid detection.

        """
        for node in ast.walk(tree):
            error = self._dangerous_ast_error(node)
            if error:
                errors.append(error)

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

    @staticmethod
    def _has_mcp_reference(tree: ast.AST) -> bool:
        return any(
            (isinstance(node, ast.Attribute) and "mcp" in node.attr.lower())
            or (isinstance(node, ast.Name) and "mcp" in node.id.lower())
            for node in ast.walk(tree)
        )

    @staticmethod
    def _keyword_risk(
        name_lower: str,
        keywords: list[str],
        *,
        local: RiskLevel,
        external: RiskLevel,
        has_mcp_call: bool,
    ) -> RiskLevel | None:
        if not any(keyword in name_lower for keyword in keywords):
            return None
        return external if has_mcp_call else local

    def _analyze_risk_level(self, tree: ast.AST, tool_name: str) -> RiskLevel:
        """
        Analyze the AST to determine the risk level of the tool.
        """
        name_lower = tool_name.lower()
        has_mcp_call = self._has_mcp_reference(tree)
        write_risk = self._keyword_risk(
            name_lower,
            EXTERNAL_WRITE_KEYWORDS,
            local=RiskLevel.LOCAL_WRITE,
            external=RiskLevel.EXTERNAL_WRITE,
            has_mcp_call=has_mcp_call,
        )
        if write_risk:
            return write_risk
        read_risk = self._keyword_risk(
            name_lower,
            EXTERNAL_READ_KEYWORDS,
            local=RiskLevel.READ,
            external=RiskLevel.EXTERNAL_READ,
            has_mcp_call=has_mcp_call,
        )
        if read_risk:
            return read_risk
        return RiskLevel.EXTERNAL_READ if has_mcp_call else RiskLevel.READ


validator = ToolValidator()
