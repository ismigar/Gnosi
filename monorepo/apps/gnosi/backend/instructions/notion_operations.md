# Directiva: Operacions amb Notion

## Objectiu
Guia per interactuar amb Notion via MCP de forma segura i eficient.

## Eines Disponibles (MCP)

| Eina | Propòsit | Risc |
|------|----------|------|
| `API-post-search` | Cercar pàgines/bases de dades | 🟢 READ |
| `API-retrieve-a-page` | Obtenir detalls d'una pàgina | 🟢 READ |
| `API-get-block-children` | Llegir contingut de blocs | 🟢 READ |
| `API-post-database-query` | Consultar una base de dades | 🟢 READ |
| `API-patch-page` | Modificar propietats d'una pàgina | 🔴 WRITE |
| `API-post-page` | Crear nova pàgina | 🔴 WRITE |
| `API-delete-a-block` | Eliminar bloc | 🔴 WRITE |

## Patrons Recomanats

### Cercar abans de crear
```python
# Sempre buscar si existeix abans de crear
search_result = mcp_client.call("API-post-search", query="nom_pagina")
if not search_result["results"]:
    # Crear només si no existeix
```

### Paginació
```python
# Notion limita a 100 resultats per pàgina
has_more = True
start_cursor = None
all_results = []

while has_more:
    result = mcp_client.call("API-post-database-query", 
        database_id=db_id,
        start_cursor=start_cursor
    )
    all_results.extend(result["results"])
    has_more = result.get("has_more", False)
    start_cursor = result.get("next_cursor")
```

## Restriccions Conegudes

- ❌ **NO** fer més de 3 requests/segon (rate limit)
- ❌ **NO** modificar pàgines sense backup previ
- ⚠️ Els IDs de Notion tenen format UUID amb guions

## Trampes Descobertes

| Data | Trampa | Solució |
|------|--------|---------|
| 2026-01-18 | Error 429 Too Many Requests | Afegir sleep(0.5) entre requests |
| 2026-01-18 | page_id vs block_id confusió | Usar always el format amb guions |

## Format d'IDs

```python
# Correcte: amb guions
page_id = "12345678-1234-1234-1234-123456789abc"

# Incorrecte: sense guions (alguns endpoints fallen)
page_id = "123456781234123412341234567892abc"
```

---
*Última actualització: 2026-01-18*
