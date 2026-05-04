# Directiu: Re-migració d'imatges Bitàcora des de Notion

## Propòsit

Recuperar les imatges incrustades de les pàgines de la taula `Bitàcora` (i análoga per altres taules) que es van perdre durant un import inicial: només es van copiar els `.md` de l'export ZIP de Notion, però no les subcarpetes germanes amb les imatges.

## Diagnòstic

- 77 fitxers `.md` a `BD/Cervell Digital/Bitacora/` amb referències del tipus `![nom](Subcarpeta/imatge.jpg)`.
- 0 subdirectoris al costat dels `.md` → 0 fitxers d'imatge accessibles.
- El frontend ([VaultTable.jsx](monorepo/apps/gnosi/frontend/src/components/Vault/VaultTable.jsx)) sap resoldre `Assets/...` i `../Assets/...` cap a `/api/vault/assets/...`, però no rutes relatives a la pàgina (`Subcarpeta/...`).
- Els noms de fitxer Notion incorporen el `page_id` sense guions (32 hex chars) com a sufix abans de `.md`. Exemple: `Compostelana 1d7268e5271480ea85bddc4262c22c96.md`.

## Decisió

Re-extreure imatges directament de l'API de Notion via `page_id` (extret del nom de fitxer) i reescriure les referències del markdown. **No** s'esborra ni es regenera el contingut textual: això evita pèrdua per divergència respecte a Notion.

## Convencions

- **Destí d'imatges**: `Gnosi/Assets/Bitàcora/` (ja existeix, buida). Una carpeta per taula.
- **Nom de fitxer**: `<safe_original_name>_<page_id8>_<idx>.<ext>` — assegura unicitat sense colisions entre pàgines i suporta múltiples imatges per pàgina.
- **Ruta dins del markdown**: `../../Assets/Bitàcora/<filename>` (la pàgina és a `BD/Cervell Digital/Bitacora/`, calen 2 nivells amunt fins arribar a `Gnosi/`).
  - **Important**: el resolver del frontend (`VaultTable.jsx`) busca el patró `Assets/...` o `../Assets/...`. Per `../../Assets/...` cal afegir-hi suport, o bé escriure la ruta com `/api/vault/assets/Bitàcora/<filename>` directament al markdown.
  - **Decisió**: escrivim ruta API directa (`/api/vault/assets/Bitàcora/<filename>`) per evitar tocar el frontend i ser explícits. El backend [vault_routes.py](monorepo/apps/gnosi/backend/api/vault_routes.py) ja serveix `/api/vault/assets/{path:path}`.

## Procediment

```bash
# Des de monorepo/apps/gnosi/pipeline/sandbox/
python3 remigrate_bitacora_images.py --dry-run        # mostra què faria
python3 remigrate_bitacora_images.py                  # executa
python3 remigrate_bitacora_images.py --table Bitacora # explicit (és el default)
python3 remigrate_bitacora_images.py --limit 3        # només 3 pàgines (test)
```

L'script:

1. Llegeix tots els `.md` de `BD/Cervell Digital/Bitacora/`.
2. Per cada fitxer, extreu el `page_id` (els 32 hex chars finals abans de `.md`).
3. Crida `GET /v1/blocks/{page_id}/children` paginant per recol·lectar tots els blocs.
4. Per cada bloc `image` (file o external), descarrega a `Gnosi/Assets/Bitàcora/<safe_name>_<idprefix>_<idx>.<ext>`.
5. Reescriu les referències `![alt](Subcarpeta/...)` o qualsevol altra forma cap a `/api/vault/assets/Bitàcora/<filename>` mantenint el caption.
6. Idempotent: si el fitxer destí ja existeix amb la mateixa mida, no el torna a descarregar.
7. Backup: abans de modificar el `.md`, escriu `.md.bak` només si encara no existeix (no sobreescriu backups previs).

## Restriccions / Edge cases

- **Notion URLs caduquen**: les URLs `file` de Notion són signades i caduquen ~1h. Si el procés triga, refresca cridant l'API just abans de descarregar.
- **Pàgines sense `page_id` extraïble**: si el nom no acaba amb `<32 hex>.md`, es salta amb avís.
- **Imatges externes (`type=external`)**: les conservem tal com són (no es descarreguen) per defecte; opció `--mirror-external` per descarregar-les també.
- **Espais al nom de carpeta**: `Bitàcora` té un caràcter accentuat. URL-encode quan es construeix la ruta API (`Bit%C3%A0cora`) — el backend FastAPI ja en gestiona el decode.
- **Rate limit Notion**: 3 req/s. Mantenir `time.sleep(0.4)` entre crides.
- **Idempotència**: re-executar l'script no ha de duplicar imatges ni reescriure rutes ja correctes (ja apunten a `/api/vault/assets/Bitàcora/`).
- **Pàgines sense imatges**: salta sense tocar el `.md`.

## Estat

- Script: [remigrate_bitacora_images.py](monorepo/apps/gnosi/pipeline/sandbox/remigrate_bitacora_images.py)
- Pendent: prova `--dry-run` + execució.

## Si funciona

Consolidar a `pipeline/skills/notion_image_remigration/` amb `SKILL.md` i fer-ho parametritzable per qualsevol taula amb el mateix símptoma (les altres taules de la llista `BLACKLISTED` o exportades pel mateix mètode).
