# Directiva: Gestió d'Errors

## Objectiu
Patrons estàndard per gestionar errors de forma consistent i informativa.

## Principis

1. **Capturar sempre** - Mai deixar excepcions sense tractar
2. **Informar clarament** - L'usuari ha de saber què ha fallat
3. **Documentar** - Errors nous → actualitzar directiva
4. **Recuperar si és possible** - Retry amb backoff per errors temporals

## Patró Base

```python
from langchain_core.tools import tool

@tool
def my_tool(param: str) -> str:
    """Descripció de l'eina."""
    try:
        # Lògica principal
        result = do_something(param)
        return f"✅ Operació completada: {result}"
    
    except ValueError as e:
        return f"❌ Error de validació: {e}"
    
    except ConnectionError as e:
        return f"❌ Error de connexió: {e}. Intenta de nou."
    
    except Exception as e:
        return f"❌ Error inesperat: {type(e).__name__}: {e}"
```

## Errors Comuns i Solucions

### Errors de Connexió
```python
import time

def with_retry(func, max_retries=3, backoff=1.0):
    for attempt in range(max_retries):
        try:
            return func()
        except ConnectionError:
            if attempt < max_retries - 1:
                time.sleep(backoff * (2 ** attempt))
            else:
                raise
```

### Errors de Rate Limit
```python
def handle_rate_limit(func):
    try:
        return func()
    except RateLimitError:
        time.sleep(60)  # Esperar 1 minut
        return func()
```

### Errors de Validació
```python
def validate_input(value, expected_type, name):
    if not isinstance(value, expected_type):
        raise ValueError(f"{name} ha de ser {expected_type.__name__}, rebut {type(value).__name__}")
```

## Format de Missatges d'Error

| Tipus | Prefix | Exemple |
|-------|--------|---------|
| Èxit | ✅ | `✅ Operació completada: 10 articles trobats` |
| Avís | ⚠️ | `⚠️ Resultat parcial: 5 de 10 processats` |
| Error recuperable | ❌ | `❌ Error de connexió. Reintentant...` |
| Error fatal | 🚫 | `🚫 Error crític: No es pot continuar` |

## Logging

```python
import logging
logger = logging.getLogger(__name__)

# Nivells apropiats
logger.debug("Detalls de depuració")
logger.info("Operació iniciada")
logger.warning("Situació inesperada però recuperable")
logger.error("Error que afecta la funcionalitat")
logger.critical("Error que requereix intervenció immediata")
```

## Trampes Descobertes

| Data | Trampa | Solució |
|------|--------|---------|
| 2026-01-18 | Excepcions silenciades amaguen bugs | Sempre logar abans de capturar |
| 2026-01-18 | Missatges genèrics no ajuden | Incloure context específic |

---
*Última actualització: 2026-01-18*
