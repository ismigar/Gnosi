# Directiva: Desenvolupament d'Eines

## Objectiu
Guia per crear eines robustes, segures i reutilitzables per a l'agent.

## Passos Obligatoris

1. **Definir nom clar** (snake_case, ex: `count_notion_articles`)
2. **Documentar amb docstring complet** (descripció, args, returns)
3. **Usar decorador `@tool`** de `langchain_core.tools`
4. **Capturar excepcions** i retornar missatges informatius
5. **Validar inputs** abans de processar

## Imports Permesos

```python
# ✅ Segurs - Sempre permesos
import json, datetime, re, typing, pathlib, collections, itertools

# ✅ LangChain - Requerit
from langchain_core.tools import tool

# ⚠️ Externs - Requereixen aprovació
# Qualsevol ús de mcp_client per escriure a APIs externes
```

## Restriccions Conegudes

- ❌ **NO** usar `subprocess`, `os.system`, `os.popen` → Risc de seguretat
- ❌ **NO** usar `eval()`, `exec()`, `__import__()` → Execució arbitrària
- ❌ **NO** fer crides HTTP directes (`requests`, `urllib`) → Usar client MCP
- ❌ **NO** escriure fitxers fora del sandbox → Usar paths relatius

## Patrons Recomanats

### Estructura Base
```python
from langchain_core.tools import tool

@tool
def nom_de_eina(param1: str, param2: int = 10) -> str:
    """
    Descripció clara del que fa l'eina.
    
    Args:
        param1: Descripció del primer paràmetre
        param2: Descripció opcional (default: 10)
    
    Returns:
        Resultat descriptiu de l'operació
    """
    try:
        # Lògica aquí
        result = process(param1, param2)
        return f"✅ Operació completada: {result}"
    except Exception as e:
        return f"❌ Error: {str(e)}"
```

### Per Operacions MCP
```python
@tool
def consultar_notion(query: str) -> str:
    """Consulta pàgines de Notion."""
    try:
        # Usar el client MCP injectat
        result = mcp_client.call("API-post-database-query", {...})
        return f"Trobats {len(result)} resultats"
    except Exception as e:
        return f"Error consultantarx Notion: {e}"
```

## Trampes Descobertes

> Aquesta secció s'actualitza automàticament quan l'agent aprèn d'errors.

| Data | Trampa | Solució |
|------|--------|---------|
| 2026-01-18 | L'apòstrof en strings JSX trenca la sintaxi | Usar cometes dobles `"l'usuari"` |
| 2026-01-18 | subprocess bloquejat pel validador | No usar mai subprocess, delegar a eines existents |

## Exemples d'Errors Comuns

### Error 1: Import no permès
```
❌ Error: Import not allowed: requests
✅ Solució: Usar mcp_client.call() en lloc de requests directe
```

### Error 2: Falta decorador
```
❌ Error: Tool must have @tool decorator
✅ Solució: Afegir `from langchain_core.tools import tool` i `@tool`
```

---

*Última actualització: 2026-01-18*
*Actualitzada automàticament pel bucle d'aprenentatge*
