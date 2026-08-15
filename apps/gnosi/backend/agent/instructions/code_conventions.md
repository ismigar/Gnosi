# Directive: Code Conventions

## Objective
Maintain consistency and quality in the code of the Gnosi project.

## Project Structure

```
gnosi/
├── backend/
│   ├── agent/          # Agents and tools
│   ├── api/            # FastAPI routes
│   └── instructions/   # Directives (SOPs)
├── frontend/
│   ├── src/components/ # React components
│   └── src/pages/      # Pages
├── pipeline/           # Processing scripts
└── config/             # YAML configuration
```

## Naming Conventions

| Element | Style | Example |
|---------|-------|---------|
| Python Files | snake_case | `tool_creator.py` |
| JS/JSX Files | PascalCase | `GraphViewer.jsx` |
| Classes | PascalCase | `ToolValidator` |
| Functions | snake_case | `create_new_tool` |
| Constants | UPPER_SNAKE | `MAX_RETRIES` |
| Variables | snake_case | `tool_name` |

## Python

### Imports
```python
# Order: stdlib → third-party → locals
import os
import json
from pathlib import Path

from langchain_core.tools import tool
from pydantic import BaseModel

from backend.agent.validator import validator
```

### Types
```python
from typing import Optional, List, Dict, Tuple

def process(items: List[str], config: Optional[Dict] = None) -> Tuple[bool, str]:
    """Docstring with description."""
    pass
```

### Docstrings
```python
def my_function(param1: str, param2: int = 10) -> str:
    """
    Brief description of the function.
    
    Args:
        param1: Description of the first parameter
        param2: Description with default value
    
    Returns:
        Description of the returned value
    
    Raises:
        ValueError: When param1 is empty
    """
```

## JavaScript/React

### Components
```jsx
// Always with function name and export
function MyComponent({ prop1, prop2 = "default" }) {
    const [state, setState] = useState(null);
    
    useEffect(() => {
        // Effects
    }, []);
    
    return <div>{/* JSX */}</div>;
}

export default MyComponent;
```

### Custom Hooks
```jsx
// Prefix "use"
function useMyCustomHook(param) {
    const [data, setData] = useState(null);
    // ...
    return { data, loading, error };
}
```

## Tools

### Base Structure
```python
from langchain_core.tools import tool

@tool
def descriptive_name(param: str) -> str:
    """
    Clear description in one line.
    
    Args:
        param: Description of the parameter
    
    Returns:
        Result of the operation
    """
    try:
        result = process(param)
        return f"✅ {result}"
    except Exception as e:
        return f"❌ Error: {e}"
```

## Comments

```python
# ✓ Good: Explains the "why"
# We use retry because the API has intermittent rate limiting
result = with_retry(api_call)

# ✗ Bad: Explains the "what" (already visible in code)
# Calls the with_retry function
result = with_retry(api_call)
```

## Commits

```
<type>: <short description>

Types: feat, fix, docs, refactor, test, chore

Examples:
feat: add validation for generated tools
fix: correct pagination error in Notion import connector
docs: update vault sync directive
```

---
*Last Update: 2026-04-08*
