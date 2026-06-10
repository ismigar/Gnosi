# Media Upload: Path Safety (traversal + escriptura atòmica)

## Context

L'endpoint POST `/api/vault/media/upload` (vault_routes) delega a
`MediaService.upload_media` (services/media_service). Fins al juny de 2026 ni
`album` ni `filename` es sanejaven: un valor amb `../` permetia escriure
fitxers FORA de `<vault>/Images` (path traversal real amb rol editor). A més,
l'escriptura era `open('wb')` directe: no atòmica (perillós amb OneDrive
sincronitzant a mig escriure) i amb un cas residual de sobreescriptura
silenciosa.

## Decisions de disseny

1. **`album` és jeràrquic i legítim.** L'arbre del MediaCenter navega
   subcarpetes i envia paths com `Viatges/2024`. NO es pot rebutjar `/` en
   bloc: cal partir per separadors (els dos estils, barra i contrabarra) i
   sanejar segment a segment.
2. **`.` i `..` com a segment = rebuig sorollós (HTTP 400).** La UI no els
   genera mai; si arriben són un atac o un bug. Sanejar-los en silenci
   escamparia fitxers a carpetes inesperades i amagaria l'atac.
3. **Contenció post-resolució (cinturó i tirants).** Després de sanejar,
   es resol el directori destí (resolve) i es comprova que segueixi dins
   l'arrel d'Images amb relative_to; si no, 400. Això també tanca la via
   dels symlinks dins d'Images que apuntin fora. La comprovació es fa ABANS
   de crear cap directori.
4. **El sanejador viu a `backend/utils/safe_io.py`** com a
   `sanitize_path_segment`. Era `_sanitize_asset_segment` a vault_routes,
   però media_service no pot importar de la capa api (vault_routes ja
   importa media_service: cicle). vault_routes manté el nom antic com a
   àlies de l'import per no tocar els ~15 punts de crida.
5. **Escriptura atòmica** amb `safe_write_bytes` (tmp + fsync + rename):
   un upload interromput mai deixa un fitxer truncat que OneDrive pugui
   replicar a mitges.
6. **Col·lisions**: es manté la política de prefixar amb els 8 primers
   caràcters del sha256 del contingut. L'únic cas en què encara es
   "sobreescriu" és contingut idèntic amb nom idèntic (bytes iguals,
   inofensiu); amb escriptura atòmica ni una cursa concurrent deixa el
   fitxer corrupte.

## Restrictions / Edge Cases

- **No usar `_sanitize_asset_segment` / `sanitize_path_segment` com a única
  defensa contra traversal**: els punts passen el filtre de caràcters, així
  que un segment `..` sobrevivia al sanejador original → per això la versió
  d'utils retorna el `fallback` quan el resultat és buit O només punts, i
  upload_media rebutja explícitament aquests segments abans de sanejar.
- **No importar res de `backend/api/...` dins de `backend/services/...`** →
  cicle d'imports (les routes importen els services) → mou la utilitat a
  `backend/utils/`.
- El sanejador talla a 120 caràcters: un nom de fitxer extremadament llarg
  pot perdre l'extensió. Cas heretat del flux d'assets; acceptat.
- `filename` es tracta com UN sol component: els separadors es converteixen
  en espais (un upload de curl amb `../../evil` acaba com a nom pla dins de
  l'àlbum, mai com a ruta).
- Tests d'unitat a `backend/tests/test_media_upload.py`; s'executen dins el
  contenidor (docker exec gnosi_backend python -m pytest ...).

## Relacionat

- `onedrive_filename_safety.md` (caràcters prohibits a OneDrive/Windows)
- `media_index_cache.md` (invalidació de caches després d'upload)
