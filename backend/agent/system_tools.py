import os
import subprocess
from typing import List, Optional
from langchain_core.tools import tool
from pathlib import Path

from backend.utils.safe_io import safe_write_text

# Define project root for security (basic sandbox)
BASE_DIR = Path(os.getcwd()).resolve()


def _is_within_base(target: Path) -> bool:
    """True when `target` is contained in BASE_DIR.

    Uses `Path.is_relative_to` rather than string `startswith`, which would let
    a sibling directory sharing the prefix (e.g. `/app-evil` vs `/app`) escape
    containment.
    """
    try:
        return target.resolve().is_relative_to(BASE_DIR)
    except (ValueError, OSError):
        return False


def _mutations_allowed() -> bool:
    """Whether code-mutating / code-executing agent tools may run.

    These tools write source files and run pytest, i.e. arbitrary code
    execution as the backend process. That is acceptable for a local
    single-developer install, but on an exposed deployment (Docker or org mode)
    it would hand remote code execution to any `editor`. Fail closed there.
    """
    try:
        from backend.services.auth_service import deployment_is_exposed

        return not deployment_is_exposed()
    except Exception:
        # If we cannot determine the deployment shape, disallow mutations.
        return False


_MUTATION_DENIED_MSG = (
    "Error: Code-mutating tools are disabled on this deployment "
    "(exposed/multi-user mode)."
)


@tool
def inspect_codebase(path: str = ".") -> str:
    """
    Reads the directory structure and file contents within the backend.
    Limited to the current working directory for security.
    """
    try:
        target_path = (BASE_DIR / path).resolve()

        # Security Check: Ensure we stay within project root
        if not _is_within_base(target_path):
            return f"Error: Access denied. Path must be within {BASE_DIR}"

        if target_path.is_file():
            with open(target_path, "r", encoding="utf-8") as f:
                return f"File: {path}\nContent:\n{f.read()}"

        elif target_path.is_dir():
            files = []
            for item in target_path.rglob("*"):
                if (
                    ".git" in item.parts
                    or "__pycache__" in item.parts
                    or ".venv" in item.parts
                ):
                    continue
                if item.is_file():
                    files.append(str(item.relative_to(BASE_DIR)))
            return f"Directory listing for {path}:\n" + "\n".join(
                files[:50]
            )  # Limit output

        else:
            return f"Error: Path {path} does not exist."

    except Exception as e:
        return f"Error inspecting codebase: {str(e)}"


@tool
def create_git_branch(branch_name: str) -> str:
    """
    Creates a new Git branch to work on changes safely.
    Ex: 'feat/improve-agent'
    """
    if not _mutations_allowed():
        return _MUTATION_DENIED_MSG
    try:
        # Check for clean state optionally? For now just try to checkout -b
        result = subprocess.run(
            ["git", "checkout", "-b", branch_name],
            capture_output=True,
            text=True,
            cwd=str(BASE_DIR),
            timeout=30,
        )
        if result.returncode == 0:
            return f"Success: Created and switched to branch '{branch_name}'"
        else:
            return f"Error creating branch: {result.stderr}"
    except subprocess.TimeoutExpired:
        return "System Error: git checkout timeout (30s)"
    except Exception as e:
        return f"System Error: {str(e)}"


@tool
def commit_changes(message: str, paths: List[str]) -> str:
    """
    Commits only the explicitly listed project-relative paths.
    """
    if not _mutations_allowed():
        return _MUTATION_DENIED_MSG
    try:
        if not paths:
            return "Error: At least one explicit project-relative path is required."
        safe_paths = []
        for path in paths:
            target = (BASE_DIR / path).resolve()
            if not _is_within_base(target):
                return f"Error: Access denied for path '{path}'."
            safe_paths.append(str(target.relative_to(BASE_DIR)))

        # 1. Add only the approved paths. Never stage the whole worktree.
        add_res = subprocess.run(
            ["git", "add", "--", *safe_paths], capture_output=True, text=True,
            cwd=str(BASE_DIR), timeout=60,
        )
        if add_res.returncode != 0:
            return f"Error adding files: {add_res.stderr}"

        # 2. Commit
        commit_res = subprocess.run(
            ["git", "commit", "-m", message],
            capture_output=True,
            text=True,
            cwd=str(BASE_DIR),
            timeout=30,
        )
        if commit_res.returncode == 0:
            return f"Success: Committed changes with message '{message}'"
        else:
            return f"Error committing (maybe nothing to commit?): {commit_res.stderr}"

    except Exception as e:
        return f"System Error: {str(e)}"


@tool
def apply_patch(file_path: str, search_text: str, replace_text: str) -> str:
    """
    Applies a specific change to a file by replacing text.
    search_text: Exact text to search for.
    replace_text: New text.
    Returns error if text is not found or appears multiple times (ambiguity).
    """
    if not _mutations_allowed():
        return _MUTATION_DENIED_MSG
    try:
        target_path = (BASE_DIR / file_path).resolve()

        if not _is_within_base(target_path):
            return "Error: Access denied."

        if not target_path.exists():
            return f"Error: File {file_path} not found."

        with open(target_path, "r", encoding="utf-8") as f:
            content = f.read()

        count = content.count(search_text)

        if count == 0:
            return (
                "Error: 'search_text' not found in file. Please verify strict equality."
            )
        if count > 1:
            return f"Error: Ambiguous patch. 'search_text' found {count} times. Provide more context."

        new_content = content.replace(search_text, replace_text)

        # Atomic write — the agent edits source code (.py); a crash halfway
        # through the write would leave the file corrupted and potentially break
        # the backend on the next reload.
        safe_write_text(target_path, new_content)

        return f"Success: Patched {file_path}"

    except Exception as e:
        return f"Error patching file: {str(e)}"


@tool
def run_tests(path: str = "backend") -> str:
    """
    Runs tests using pytest.
    Useful for TDD (Test Driven Development) and verifying changes.
    path: File or directory to test (default: 'backend').
    """
    if not _mutations_allowed():
        return _MUTATION_DENIED_MSG
    try:
        # Validate path
        target_path = (BASE_DIR / path).resolve()
        if not _is_within_base(target_path):
            return "Error: Access denied."

        # Run pytest with a timeout to avoid blocking the agent if tests
        # have an infinite loop or hanging connections.
        try:
            result = subprocess.run(
                ["python", "-m", "pytest", str(target_path)],
                capture_output=True,
                text=True,
                cwd=str(BASE_DIR),
                timeout=300,  # 5 min, enough for most suites
            )
        except subprocess.TimeoutExpired:
            return "Error: pytest timeout (5 min). Tests may contain an infinite loop."

        output = f"Exit Code: {result.returncode}\n"
        output += f"STDOUT:\n{result.stdout}\n"
        if result.stderr:
            output += f"STDERR:\n{result.stderr}"

        return output
    except Exception as e:
        return f"Error running tests: {str(e)}"


@tool
def search_code_symbols(query: str) -> str:
    """
    Searches for class and function definitions in the backend code using AST.
    Much faster and more accurate than grep for finding "where function X is defined".
    query: Name (or part of the name) of the function or class.
    """
    import ast

    results = []

    try:
        # Walk through all python files in backend
        backend_dir = BASE_DIR / "backend"
        if not backend_dir.exists():
            return "Error: backend directory not found."

        for py_file in backend_dir.rglob("*.py"):
            if ".venv" in py_file.parts or "__pycache__" in py_file.parts:
                continue

            try:
                with open(py_file, "r", encoding="utf-8") as f:
                    content = f.read()

                tree = ast.parse(content)
                rel_path = py_file.relative_to(BASE_DIR)

                for node in ast.walk(tree):
                    if isinstance(
                        node, (ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef)
                    ):
                        if query.lower() in node.name.lower():
                            results.append(
                                f"[{type(node).__name__}] {node.name} in {rel_path}:{node.lineno}"
                            )

            except Exception:
                continue  # Skip files that fail to parse

        if not results:
            return f"No symbols found matching '{query}'."

        return "Found symbols:\n" + "\n".join(results[:50])

    except Exception as e:
        return f"Error searching symbols: {str(e)}"


@tool
def save_memory(content: str) -> str:
    """
    Saves important information to long-term memory (Vector DB).
    Use it to remember facts, user preferences, or architectural decisions.
    content: The text to remember (ex: "The user prefers the color orange").
    """
    from .memory import memory_store

    return memory_store.add_memory(content)


@tool
def query_memory(query: str) -> str:
    """
    Searches in long-term memory.
    Use it when the user asks about things from the past or context that you don't have in the current chat.
    """
    from .memory import memory_store

    results = memory_store.search_memory(query)
    if not results:
        return "No memory found."
    return "Relevant Memories:\n- " + "\n- ".join(results)


@tool
def search_vault(query: str, k: int = 5) -> str:
    """
    Searches for relevant content in the Gnosi Vault (Wiki, DB, etc.).
    Useful for answering questions about user's personal information, notes, and databases.
    Returns a summary of the most relevant fragments.
    """
    from .memory import vault_store

    results = vault_store.search_vault(query, k=k)
    if not results:
        return "No relevant information found in the Vault."

    formatted = "Relevant information found in the Vault:\n"
    for r in results:
        meta = r.get("metadata", {})
        source = meta.get("source", "Unknown")
        formatted += f"- [Source: {source}]\n  Content: {r['content']}\n\n"
    return formatted


@tool
def get_vault_registry() -> str:
    """Returns a summary of the databases and tables available in the Gnosi Vault."""
    from backend.config.app_config import load_params
    import json

    cfg = load_params(strict_env=False)
    registry_path = cfg.paths["REGISTRY"]

    if not registry_path or not registry_path.exists():
        return "Error: Vault Registry not found."

    try:
        with open(registry_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        summary = "Databases available in the Vault:\n"
        for table in data.get("tables", []):
            summary += f"- Name: {table['name']} | ID: {table['id']}\n"
            summary += (
                "  Properties: "
                + ", ".join([p["name"] for p in table.get("properties", [])[:10]])
                + "...\n"
            )

        return summary
    except Exception as e:
        return f"Error reading registry: {str(e)}"


# Exportable list
from backend.agent.directive_tools import (
    list_directives,
    read_directive,
    update_directive,
)

SYSTEM_TOOLS = [
    inspect_codebase,
    create_git_branch,
    commit_changes,
    apply_patch,
    run_tests,
    search_code_symbols,
    save_memory,
    query_memory,
    search_vault,
    get_vault_registry,
    list_directives,
    read_directive,
    update_directive,
]

# Ordinary agent chat is deliberately read-only. Mutation and code execution
# require a separate per-invocation approval protocol, which the chat endpoint
# does not currently issue.
READ_ONLY_SYSTEM_TOOLS = [
    inspect_codebase,
    search_code_symbols,
    query_memory,
    search_vault,
    get_vault_registry,
    list_directives,
    read_directive,
]
