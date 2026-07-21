# SKILL: Notion Clone (clon exacte + reparació de pestanyes)

Eines per al **clon exacte de Notion → Gnosi**: la importació (al backend, via
`services/notion_clone.py` + `notion_view_recreator.py`) i la **reparació
incremental** de pestanyes perdudes en clons ja fets.

> ID: NOTION-CLONE-20260708
> Stack: Python 3.10+ (`httpx`, `yaml`, backend Gnosi en execution)
> Directiva: `docs/dev_memory/directives/notion_exact_clone.md`

---

## Context: pestanyes per vistes

Notion agrupa N vistes (Taula/Board/Gallery…) com a **pestanyes** d'un sol bloc
de linked database; el fetch MCP les retorna totes com a `<view url>{json}</view>`.
El clon v1 només en llegia la primera (`.search()`) → «Cervell digital» (10
pestanyes) quedava en 1, «Recursos» (13) en 1.

**Model àncora + `tabs`** (fix): al cos de la pàgina només hi va l'embed de la
**primera** vista (l'àncora); la resta es creen al registry i pengen del camp
`tabs` de l'àncora. El frontend (`DbViewEmbed`) llegeix `anchorReg.tabs` i les
mostra com a pestanyes del bloc, com a Notion. El camp `tabs` flota pel registry
JSON (`ViewSection` porta `extra='allow'` i `update_view` fa merge per clau); no
cal tocar el model de dades.

---

## Scripts

| Script | Ús |
|---|---|
| [`scripts/backfill_notion_views.py`](./scripts/backfill_notion_views.py) | Reparació incremental de les pestanyes 2..N que el clon v1 perdia, **sense refer el clon** ni tocar contingut editat |

### `backfill_notion_views.py`

Requereix:
- Backend natiu corrent (`uvicorn :5002`) i **MCP de Notion connectat** (OAuth).
- `GNOSI_LOCAL_DATA` apuntant al `local_data` amb `integrations.json` (tokens).
- El vault ja clonat al disc (OneDrive o local).

Flux:
1. Escaneja `.md` amb `gnosi-view:def` (fora de `.history`/`.trash`/`Assets`/…).
2. Mapa pàgina del vault → pàgina de Notion (re-enumera ids: `import-config` +
   `query_database` + `search_pages` fallback; `uuid5` és one-way).
3. Per cada pàgina: `fetch` MCP → `build_clone_views` (totes les pestanyes reals,
   sense els gràfics "suggerits").
4. **Reconcilia**: al cos hi queda NOMÉS l'embed de l'àncora; upsert de totes les
   vistes (`POST /views`), `tabs` a l'àncora, esborra els gràfics erronis (`DELETE`)
   i treu els `gnosi-view:def` apilats (`PATCH /pages/{id}`).

Idempotent (ids deterministes). Dry-run per defecte; `--apply` per escriure;
`--state <jsonl>` per reprendre.

```bash
.venv/bin/python pipeline/skills/notion_clone/scripts/backfill_notion_views.py \
    --vault-dir ~/Library/CloudStorage/OneDrive-UNED/Gnosi/Notion \
    --vault-id <vault-id> [--apply] [--only .Dashboards] [--state /tmp/state.jsonl]
```

Sortida: resum amb `pages`, `views_upserted`, `embeds_added`, `unmapped`,
`mcp_empty`, `errors`, `chart_views_deleted`.
