# Directive: Tool Development

## Objective
A guide for creating robust, secure, and reusable tools for the agent.

## Mandatory Steps

1. **Define a clear name** (snake_case, e.g., `count_notion_articles`).
2. **Document with a complete docstring** (description, args, returns).
3. **Use the `@tool` decorator** from `langchain_core.tools`.
4. **Catch exceptions** and return informative messages.
5. **Validate inputs** before processing.

---

## Allowed Imports

```python
# ✅ Safe - Always allowed
import json, datetime, re, typing, pathlib, collections, itertools

# ✅ LangChain - Required
from langchain_core.tools import tool

# ⚠️ External - Requires approval
# Any use of mcp_client to write to external APIs
```

---

## Restrictions and Edge Cases

- ❌ **NO** use of `subprocess`, `os.system`, `os.popen` → Security risk.
- ❌ **NO** use of `eval()`, `exec()`, `__import__()` → Arbitrary execution.
- ❌ **NO** direct HTTP calls (`requests`, `urllib`) → Use the MCP client.
- ❌ **NO** writing files outside the sandbox → Use relative paths.

---

## Recommended Patterns

### Base Structure
```python
from langchain_core.tools import tool

@tool
def tool_name(param1: str, param2: int = 10) -> str:
    """
    Clear description of what the tool does.
    
    Args:
        param1: Description of the first parameter
        param2: Optional description (default: 10)
    
    Returns:
        Descriptive result of the operation
    """
    try:
        # Logic here
        result = process(param1, param2)
        return f"✅ Operation completed: {result}"
    except Exception as e:
        return f"❌ Error: {str(e)}"
```

### For MCP Operations
```python
@tool
def query_notion(query: str) -> str:
    """Query Notion items."""
    try:
        # Use the injected MCP client
        result = mcp_client.call("API-post-database-query", {...})
        return f"Found {len(result)} results"
    except Exception as e:
        return f"Error querying Notion: {e}"
```

---

## Discovered Traps

> This section is automatically updated when the agent learns from errors.

| Date | Trap | Solution |
|------|------|----------|
| 2026-01-18 | Apostrophe in JSX strings breaks syntax | Use double quotes `"user's"` |
| 2026-01-18 | subprocess blocked by validator | Never use subprocess, delegate to existing tools |

---

## Common Error Examples

### Error 1: Forbidden Import
```
❌ Error: Import not allowed: requests
✅ Solution: Use mcp_client.call() instead of direct requests
```

### Error 2: Missing Decorator
```
❌ Error: Tool must have @tool decorator
✅ Solution: Add `from langchain_core.tools import tool` and `@tool`
```

---

*Last Update: 2026-04-08*
*Automatically updated by the learning loop*
