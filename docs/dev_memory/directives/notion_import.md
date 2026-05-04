# Directiu: Import Notion → Gnosi Vault

## Propòsit

Importar exportació local de Notion (CSV + .md) cap a `BD/Cervell Digital/<Taula>/` del vault de Gnosi, generant `.md` amb frontmatter YAML i seccions incrustades populades segons `vault_db_registry.json`.

## Components

| Fitxer | Funció |
|---|---|
| `pipeline/sandbox/import_from_export.py` | Lectura CSV+.md de Notion → escriptura .md amb frontmatter al vault |
| `pipeline/sandbox/sync_sections.py` | Resolució relacions `📀_*` → seccions `# Heading` amb wikilinks (i taules markdown si la secció té múltiples columnes) |
| `BD/vault_db_registry.json` | Configuració central: taules, propietats, seccions de taula i de pàgina |

## Convencions clau

- **EXPORT_PATH**: `~/Downloads/Export-Notion/BD/`. Si Notion exporta a una altra carpeta, actualitza la constant a [import_from_export.py:31](monorepo/apps/gnosi/pipeline/sandbox/import_from_export.py:31).
- **Filenames**: `<safe_title> <uuid32>.md` — un sol fitxer per UUID. **Mai s'afegeix sufix `-N`** (idempotència per UUID: si el títol canvia, el fitxer antic s'esborra abans).
- **Adjunts**: `Recursos` → `Biblioteca/` amb deduplicació MD5; altres → `Assets/<Taula>/`.

## Bug crític resolt (2026-04-29)

Símptoma original: les àrees no s'obrien al frontend; `/api/vault/registry` trigava 30+ segons.

Causes encadenades:

1. **Bug a `import_from_export.py:567-569`**: si el `.md` destí ja existia, el script creava `<títol> <uuid>-2.md`. Cada reimport multiplicava els fitxers. Amb 1162 IDs duplicats, el backend (`vault_routes.py:1923`) deduplicava cada petició → 8-9 s per request.
2. **Bug a `sync_sections.py`**: `import_from_export.py` cridava `from sync_sections import sync_all_tables`, però aquesta funció no existia. ImportError engolit silenciosament → cap secció es generava.
3. **Bug a `vault_routes.py:load_registry`**: cridava `_ensure_table_vault_folder()` per cada taula a cada lectura, fent `path.exists()`/`path.is_dir()` sobre OneDrive. Quan OneDrive sincronitzava, la FUSE bloquejava → endpoint penjat indefinidament.

Correccions aplicades:

- Esborrats 1125 fitxers `*-N.md` duplicats.
- `import_from_export.py:567-575`: substituida la lògica `-2` per *idempotència estricta per UUID* (esborra altres `.md` amb el mateix UUID abans d'escriure).
- `sync_sections.py`: afegides `sync_all_tables(vault_path, table_filter, dry_run, verbose)` i `sync_all_pages(vault_path, dry_run)` com a wrappers programàtics. Suport per renderitzar seccions amb múltiples columnes com a taules markdown.
- `vault_routes.py:load_registry`: cache amb TTL de 30s + skip de `_ensure_table_vault_folder` quan ja s'ha validat aquesta sessió + fallback a cache stale si la FS triga. Resultat: registry passa de 30s+ a <300ms.

## Procediment de reimport (idempotent)

```bash
# Des de monorepo/apps/gnosi/pipeline/sandbox/
python3 import_from_export.py              # totes les taules
python3 import_from_export.py Àrees        # només una taula
python3 import_from_export.py --dry-run    # comptatges sense escriure
python3 import_from_export.py --no-sync    # salta sync_sections
```

L'script:
1. Llegeix `vault_db_registry.json` (16 taules).
2. Per cada taula amb CSV `*_all.csv` a l'export:
   - Llegeix files del CSV i `.md` individuals de Notion.
   - Genera frontmatter YAML (relacions `📀_*` com llistes d'UUIDs amb guions).
   - Extreu cos del `.md` original (links → wikilinks `[[Títol]]`).
   - Escriu `<safe_title> <uuid>.md` (esborrant abans qualsevol `.md` previ amb mateix UUID).
3. Post-import: `sync_all_tables()` + `sync_all_pages()` actualitzen seccions de taula i pàgina.

## Estat verificat (2026-04-29)

- 1445 registres importats nets en 11 taules (Antigravity, Cinema, Experiencia profesional, Taula de Verificacio Final, Titulaciones queden buides perquè no tenen CSV a l'export).
- 0 fitxers `*-N.md` al vault.
- Total `.md` al vault: 1756.
- Backend dedup count: 37 (estable, no creix).
- Latència API:
  - `/api/vault/registry`: <300ms (cache hit)
  - `/api/vault/pages/{id}`: ~200ms (cache hit)
  - `/api/vault/pages/by-table/{id}/snapshot`: ~300ms (cache hit)

## Edge cases / restriccions

- **No cridis `sync_all_tables()` mentre OneDrive estigui >50% CPU**: el primer pas (`build_full_index`) recorre tot el vault i pot trigar minuts; espera a que es calmi.
- **Tasques sense `.md` individual**: el CSV té 683 files però Notion no exporta `.md` per cada tasca (no tenen subpàgina). El cos resultant és buit; les relacions sí funcionen.
- **Adjunts no trobats**: Recursos té 436 avisos d'adjunts (PDFs antics esborrats o moguts). Es preserva el path original al frontmatter; el fitxer no es copia. Aquests es poden netejar/resoldre manualment.
- **Tables sense .md de Notion**: Cinema, Experiencia profesional, Titulaciones, Taula de Verificacio Final, Antigravity Verification → no tenen `_all.csv` i el script les salta amb un avís.
- **El backend cacheja el registry 30s i les `_ensure_table_vault_folder` son one-shot per procés**: si afegeixes una taula nova al `vault_db_registry.json`, **reinicia el backend** perquè crei la carpeta física, o crida l'endpoint que crea taules (que invalida la cache automàticament).

## Fonts del codi

- [import_from_export.py](monorepo/apps/gnosi/pipeline/sandbox/import_from_export.py)
- [sync_sections.py](monorepo/apps/gnosi/pipeline/sandbox/sync_sections.py)
- [vault_routes.py:load_registry](monorepo/apps/gnosi/backend/api/vault_routes.py:3409)
