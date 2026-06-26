# Directiva: Clon exacte de Notion → Gnosi (Notion com a font de veritat)

**Objectiu:** que l'usuari pugui fer un **clon exacte i fàcil** del seu workspace de Notion a
Gnosi (vistes incrustades, columnes, contingut, esquema), **acceptant perdre traduccions**,
per **abandonar Notion**. Diferent del SYNC guardat (que protegeix el vault i mai sobreescriu).

## Decisió de l'usuari (2026-06-26): CLON A CARPETA NOVA (segur)
El clon aterra en un **espai/carpeta nou** (p.ex. `Clon Notion/`), **sense tocar el vault
actual**. L'usuari revisa la fidelitat i, si el convenç, el fa el principal. → ids del clon
**namespaced** (no reconcilien amb les taules/pàgines existents; no col·lisionen).

## Prerequisit DUR: connexió MCP
La fidelitat (vistes + columnes + layout) NOMÉS la dóna l'MCP allotjat de Notion (la REST no
—provat). Cal **"Connecta MCP"** (OAuth DCR+PKCE, ja implementat) abans de clonar.

## Peces

### ✅ Fetes i verificades
- `notion_view_recreator.py` (8/8): parse de pàgina/vista MCP + `build_gnosi_view` (taula +
  filtre "aquesta pàgina") + `recreate_views_for_page`.
- `notion_mcp_md.py` (7/7): markdown ric de l'MCP → Markdown de Gnosi:
  `<database inline>` → `<!-- gnosi-notion-db:<id> -->` (marcador), `<mention-page>` →
  `[[...]]`, `<columns>` aplanat, `{color}`/`{toggle}` tret, tabs desfets, etiquetes netes.
- Client MCP HTTP+OAuth (`mcp/http_client.py`, `services/notion_mcp.py`, `notion_oauth_routes`).

### ⏳ Per fer (l'orquestrador del clon)
`services/notion_clone.py` + flag `mode="clone"` a `/api/notion/import`:
1. ids **namespaced**: `clone_table_id = uuid5(CLONE_NS, notion_db_id)`,
   `clone_page_id = uuid5(CLONE_NS, notion_page_id)` → espai separat, no toca l'existent.
2. **Totes** les pàgines (no només noves), a `Clon Notion/<taula>/`.
3. Contingut: `notion_mcp.fetch(page)` → `notion_mcp_md.mcp_to_markdown` → per cada marcador
   `<!-- gnosi-notion-db:<id> -->`, resoldre amb `notion_view_recreator` (fetch de la vista,
   mapar a la **taula del clon** per nom/id, crear `gnosi-view` namespaced) i substituir el
   marcador per l'embed `<!-- gnosi-view:def {view_id} -->`.
4. Relacions → ids del clon (namespaced).
5. Esquema de taules via `map_database_schema` però amb id namespaced.
6. Inclou pàgines soltes.
UI: mode **"Clon exacte (a carpeta nova)"** (vs "Sync guardat"); requereix MCP connectat.

## Limitacions conegudes v1
- **Columnes**: Gnosi no té layout de columnes al Markdown → s'aplanen (contingut conservat,
  no la disposició costat a costat). Revisar si BlockNote ho admet més endavant.
- Fitxers/imatges: URLs de l'MCP poden caducar → baixar a `Assets/` del clon (com l'import REST).
- Volum: clonar tot el workspace = moltes crides MCP → job amb progrés (timeout client ja a 0).

## QA
1. Transforms purs (recreator + mcp_md): tests amb markdown REAL de l'MCP (fets).
2. E2E: amb MCP connectat, clonar 1 taula a `Clon Notion/` i verificar al navegador que les
   pàgines tenen el contingut + les `gnosi-view` materialitzades.
3. Stopping rule: "no provat" = no fet (E2E necessita MCP connectat).

## Ordre
1. (Usuari) Connectar MCP i verificar un `fetch` real.
2. `notion_clone.py` + mode clon + UI.
3. E2E d'una taula → ampliar a tot el workspace.
