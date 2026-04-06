# Directiva: Convencions de Codi

## Objectiu
Mantenir consistència i qualitat al codi del projecte Digital Brain.

## Estructura del Projecte

```
digital-brain/
├── backend/
│   ├── agent/          # Agents i eines
│   ├── api/            # Rutes FastAPI
│   └── instructions/   # Directives (SOPs)
├── frontend/
│   ├── src/components/ # Components React
│   └── src/pages/      # Pàgines
├── pipeline/           # Scripts de processament
└── config/             # Configuració YAML
```

## Nomenclatura

| Element | Estil | Exemple |
|---------|-------|---------|
| Fitxers Python | snake_case | `tool_creator.py` |
| Fitxers JS/JSX | PascalCase | `GraphViewer.jsx` |
| Classes | PascalCase | `ToolValidator` |
| Funcions | snake_case | `create_new_tool` |
| Constants | UPPER_SNAKE | `MAX_RETRIES` |
| Variables | snake_case | `tool_name` |

## Python

### Imports
```python
# Ordre: stdlib → tercers → locals
import os
import json
from pathlib import Path

from langchain_core.tools import tool
from pydantic import BaseModel

from backend.agent.validator import validator
```

### Tipus
```python
from typing import Optional, List, Dict, Tuple

def process(items: List[str], config: Optional[Dict] = None) -> Tuple[bool, str]:
    """Docstring amb descripció."""
    pass
```

### Docstrings
```python
def my_function(param1: str, param2: int = 10) -> str:
    """
    Descripció breu de la funció.
    
    Args:
        param1: Descripció del primer paràmetre
        param2: Descripció amb valor per defecte
    
    Returns:
        Descripció del valor retornat
    
    Raises:
        ValueError: Quan param1 és buit
    """
```

## JavaScript/React

### Components
```jsx
// Sempre amb nom de funció i export
function MyComponent({ prop1, prop2 = "default" }) {
    const [state, setState] = useState(null);
    
    useEffect(() => {
        // Efectes
    }, []);
    
    return <div>{/* JSX */}</div>;
}

export default MyComponent;
```

### Hooks personalitzats
```jsx
// Prefix "use"
function useMyCustomHook(param) {
    const [data, setData] = useState(null);
    // ...
    return { data, loading, error };
}
```

## Eines

### Estructura base
```python
from langchain_core.tools import tool

@tool
def nom_descriptiu(param: str) -> str:
    """
    Descripció clara en una línia.
    
    Args:
        param: Descripció del paràmetre
    
    Returns:
        Resultat de l'operació
    """
    try:
        result = process(param)
        return f"✅ {result}"
    except Exception as e:
        return f"❌ Error: {e}"
```

## Comentaris

```python
# ✓ Bo: Explica el "per què"
# Usem retry perquè l'API té rate limiting intermitent
result = with_retry(api_call)

# ✗ Dolent: Explica el "què" (ja es veu al codi)
# Crida la funció with_retry
result = with_retry(api_call)
```

## Commits

```
<tipus>: <descripció curta>

Tipus: feat, fix, docs, refactor, test, chore

Exemples:
feat: afegir validació d'eines generades
fix: corregir error de paginació a Notion
docs: actualitzar directiva de n8n
```

---
*Última actualització: 2026-01-18*
