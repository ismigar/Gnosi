# Directiva (PROJECTE Fase 2): vistes incrustades fidels de Notion via MCP-OAuth

**Objectiu:** recrear FIDELMENT les vistes incrustades (linked database views) de les pàgines
de Notion al vault de Gnosi com a `gnosi-view`, cosa que l'**API REST no permet**.

## Per què cal (límit dur de la REST — PROVAT 2026-06-26)

Les "vistes" dins una pàgina de Notion (p.ex. sota "Planificació" → "Tasques pendents/
acabades/Cronograma") són **linked database views**. Via token d'integració (REST):
- Apareixen com a blocs `child_database` titulats **"Untitled"**, niats sota capçaleres toggle.
- `GET /v1/databases/{block_id}` retorna **error**: *"Database … does not contain any data
  sources accessible by this API bot."* → **la REST NO dóna ni la taula destí ni el filtre.**
- Per això tant la migració original com l'importador REST acaben fent `[[Sin título]]`.

→ La fidelitat de vistes només és possible amb una font que SÍ les exposi: l'**MCP allotjat
de Notion** (el mateix que retorna `<database url=".../<id>" inline="true">` amb id resoluble).

## Punt de partida (què ja tenim)

- **Client MCP** a `backend/mcp/client.py` — però és **stdio via `docker exec`**
  (`DockerMCPClient` + `MultiServerMCPClient`), i `MCP_SERVERS` (config/mcp_config.py) està buit.
  → cal una variant **HTTP/SSE (streamable) + OAuth**, no stdio.
- **Infra OAuth** ja existent per a Google/Microsoft (`config/env_config.py`:
  `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `MICROSOFT_OAUTH_*`; routers `google_auth_routes`,
  `microsoft_auth_routes`). → replicar el patró per a Notion.
- **Importador REST** (`services/notion_importer.py`) + diff + reconciliació per id ja fets
  (cf. [[notion_api_importer]]). Aquesta fase NOMÉS afegeix la capa de vistes.
- **Sistema de vistes incrustades** del vault ja existeix: `POST /api/vault/views`
  (upsert per id, uuid5 idempotent) + fence ```gnosi-view + filtre `{field, value:"this"}`
  (cf. memòria `feedback_vault_embedded_views`).

## Arquitectura proposada

```
backend/mcp/http_client.py      # client MCP HTTP/SSE (streamable) + Bearer OAuth
backend/api/notion_oauth_routes.py  # flux OAuth de Notion (authorize → callback → token)
services/notion_mcp.py          # fetch d'una pàgina via MCP → Notion-flavored markdown
services/notion_view_recreator.py   # parse <database inline url> → crea gnosi-view + embed
```

### 1. OAuth de Notion (com Google/Microsoft)
- `GET /api/notion-oauth/authorize` → redirigeix a l'autorització de Notion.
- `GET /api/notion-oauth/callback` → bescanvia el codi per un access token; desa a
  `integrations.json` sota `notion_mcp` (separat del token d'integració REST).
- Credencials d'app (client id/secret) a env (`NOTION_OAUTH_CLIENT_ID/SECRET`).

### 2. Client MCP HTTP cap a l'MCP allotjat de Notion
- Endpoint hostat de Notion (verificar a la implementació: p.ex. `https://mcp.notion.com/mcp`,
  transport streamable-HTTP/SSE) amb `Authorization: Bearer <oauth_token>`.
- Reusar el patró JSON-RPC de `DockerMCPClient` però sobre HTTP (initialize → tools/call).
- Tool clau: **`fetch`** (id de pàgina) → retorna Notion-flavored markdown amb les vistes com
  `<database url="https://notion.so/p/<32hex>" inline="true">`.

### 3. Recreació de vistes (`notion_view_recreator.py`)
Per cada pàgina importada que tingui vistes incrustades:
1. `fetch` la pàgina via MCP → markdown enriquit.
2. Extreure els `<database url=".../<id>" inline>` (reusar `notion_diff.extract_notion_inline_dbs`)
   amb la **capçalera** que els precedeix (secció).
3. Mapar `<id>` (32-hex) → **taula del vault per id** (ja casen: cf. [[notion_api_importer]]
   reconciliació per id).
4. Crear una `gnosi-view` (`POST /api/vault/views`, id uuid5 deterministe) de la taula destí.
   Filtre heurístic: si la taula té una relació cap a la taula de la pàgina amfitriona →
   `{field: "<relació>", value: "this"}` (mostra els relacionats amb aquesta pàgina).
5. Substituir el `[[Untitled]]`/`child_database` del cos per la incrustació
   `<!-- gnosi-view:def {"view_id":"<id>"} -->` sota la capçalera corresponent.

### 4. On enganxa a l'importador
- Nou flag `recreate_views: bool` a `/api/notion/import`. Quan actiu i hi ha token MCP-OAuth,
  després d'escriure la pàgina REST, fa el pas 1-5 per enriquir-la amb vistes.
- Sense token MCP → degrada al comportament actual (REST, sense vistes) sense error.

## Límits coneguts / a verificar a la implementació
- El **filtre exacte** de la vista de Notion (p.ex. status="pendent" vs "acabada") potser
  l'MCP tampoc el dóna granular → la incrustació mostra la relació sencera (com el primer diff
  d'Oci ja insinuava: layout + columnes sí, filtre fi potser no). Documentar el que s'obté.
- Endpoint/transport/scopes exactes de l'MCP de Notion → confirmar amb la doc oficial.
- Quota/rate de l'MCP allotjat.

## Encaix amb el projecte d'agents
Aquesta fase ÉS la "Fase 3 — Connexió exterior (client MCP)" de [[vault_knowledge_agents]]:
un cop Gnosi parla amb l'MCP allotjat de Notion, els **agents** també hi tenen accés (no només
l'importador). Construir el client MCP HTTP+OAuth un cop, reusar-lo a tots dos.

## QA
1. Transforms purs (parse `<database inline>` + map a taula + construcció de la `gnosi-view` i
   l'embed) → tests amb fixtures de markdown de l'MCP (sense xarxa).
2. E2E: amb OAuth real, importar 1 pàgina amb vistes (p.ex. "Postgrau de Coaching") i verificar
   que les `gnosi-view` apareixen i materialitzen (cf. memòria `feedback_vault_embedded_views`).
3. Stopping rule: "no s'ha pogut provar" = no fet.

## Fases d'execució
1. Client MCP HTTP + OAuth de Notion (peça compartida amb agents).
2. `fetch` d'una pàgina via MCP + parse de vistes.
3. Recreador de `gnosi-view` + flag `recreate_views` a l'import.
4. (opcional) estendre a totes les pàgines amb vistes en un sync massiu.
