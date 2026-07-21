# Directiva: Extensió LibreOffice "Gnosi Cite"

**Objectiu**: gestor de cites estil Mendeley dins LibreOffice Writer, a
paritat amb el Word Add-in (`frontend/public/word-addin/`). Cerca, selecció
d'estil de citació, inserció amb tracking, bibliografia i reformatació APA.
(El locale és fix `ca-AD`, no exposat a la UI — paritat amb el Word Add-in.)

**Ubicació**: `monorepo/apps/gnosi/integrations/libreoffice-cite/`

## Arquitectura

Extensió `.oxt` (ZIP) amb un *protocol handler* UNO en Python que registra
el protocol `gnosicite:` i atén 4 comandes des d'un menú propi:

| Menú | URL | Acció |
|------|-----|-------|
| Insereix cita… | `gnosicite:insertCitation` | Obre diàleg UNO de cerca |
| Insereix bibliografia | `gnosicite:insertBibliography` | Recopila claus → llista al final |
| Actualitza tot (APA) | `gnosicite:refreshAll` | Reformata en lot amb context |
| Configuració… | `gnosicite:settings` | Edita URL del backend |

Nota històrica (2026-07-21): `refreshAll` va estar **implementat però sense
entrada de menú** des de l'inici — el despatxador i `refresh_all()` hi eren i
el diàleg de cerca el cridava internament, però `Addons.xcu` només declarava
3 ítems. Exposat a la v0.1.1 afegint el node `m03` i renumerant separador i
configuració a `m04`/`m05`. Els nodes es pinten per ordre de nom, així que
inserir al mig obliga a renumerar: no n'hi ha prou d'afegir un `m05` al final
si el vols abans del separador.

Reutilitza **els mateixos endpoints** que el Word Add-in (cap canvi al
backend): `/api/health`, `/api/vault/search-citations`,
`/api/vault/format-citation`, `/api/vault/format-citations`,
`/api/vault/format-bibliography`.

## Fitxers del paquet

- `gnosi_cite.py` — component UNO (handler + API client + DocOps + diàlegs)
- `description.xml` — metadades de l'extensió (identifier `com.gnosi.cite`)
- `META-INF/manifest.xml` — declara els media-types dels fitxers
- `ProtocolHandler.xcu` — registra `gnosicite:*`
- `Addons.xcu` — menú "Gnosi Cite" (Context = TextDocument)
- `build.sh` — empaqueta tot en `gnosi-cite.oxt`

## Restriccions / Edge cases (apreses)

- **No usar `requests`** → el Python embegut de LO no el porta. Només
  `urllib`/`json`/`uuid` de la stdlib.
- **Dependència: `LibreOffice-minimal-version`, MAI `OpenOffice.org-minimal-version`
  amb valor ≥ 4.2**. OpenOffice.org no va passar de la 4.1, així que declarar
  `<OpenOffice.org-minimal-version value="5.0">` deixa la dependència
  *eternament insatisfeta* (fins i tot a LibreOffice 26.x) → `unopkg add`
  falla amb `ERROR: ... unsatisfied dependencies`. Cal el namespace
  `http://libreoffice.org/extensions/description/2011` (prefix `l:`) i
  `<l:LibreOffice-minimal-version value="5.0">`.
- **Implementation name = node name del HandlerSet** (`com.gnosi.cite.ProtocolHandler`).
  El dispatch framework crea el handler **per aquest nom**; ha de coincidir
  exactament a `ProtocolHandler.xcu` i a `addImplementation(...)`.
- **Media-type del component Python**:
  `application/vnd.sun.star.uno-component;type=Python` (activa la passive
  registration via `g_ImplementationHelper`). Els `.xcu` són
  `application/vnd.sun.star.configuration-data`. `description.xml` **no** va
  al manifest.
- **Tracking via reference marks** (`com.sun.star.text.ReferenceMark`), nom
  `gnosicite::<key>::<uuid>`. Inserció: `setString(text)` sobre un cursor i
  després `insertTextContent(cur, mark, True)` (absorb=True → la marca
  *embolcalla* el rang, no esborra el text).
- **Ordre del document amb duplicats** (necessari per APA): no es pot
  obtenir de `getReferenceMarks()` (ordre per nom). Cal **enumerar text
  portions** del cos: paràgrafs → portions amb `TextPortionType ==
  "ReferenceMark"` i `IsStart`. Per a la bibliografia (claus úniques) sí
  que val `getReferenceMarks().getElementNames()`.
- **Reformatació**: agafar `mark.getAnchor().setString(formatted)`. La
  marca sobreviu al canvi de text (comportament tipus Zotero).
- **Noms interns d'estils de paràgraf**: usar `"Heading 1"` i `"Standard"`
  (NO el nom visible localitzat "Per defecte").
- **Limitació v0.1**: el refresc ordenat només recorre el cos del document
  (no capçaleres/peus/cel·les de taula).
- **Diàlegs**: construïts programàticament amb `UnoControlDialogModel`;
  ListBox doble-clic dispara `actionPerformed` amb `ActionCommand` buit
  (es tracta com a "pick").

## Verificació

- `python3 -m py_compile gnosi_cite.py`
- Well-formedness XML de cada `.xcu`/`.xml`
- `./build.sh` genera `.oxt` amb 6 fitxers

### Instal·lació a macOS (provada 2026-05-30, LibreOffice 26.2 via Homebrew)

1. `brew install --cask libreoffice` → `/Applications/LibreOffice.app`.
2. **Treu la quarantine de Gatekeeper** (cask de brew): `xattr -dr
   com.apple.quarantine /Applications/LibreOffice.app`. Si no, els
   subprocessos UNO de `soffice` poden fallar.
3. **Inicialitza el perfil d'usuari** abans del primer `unopkg`:
   `soffice --headless --terminate_after_init` (crea
   `~/Library/Application Support/LibreOffice/4/user/`).
4. `unopkg add --force gnosi-cite.oxt`.

**`unopkg add` a macOS falla l'enabling EN CALENT** amb
`com.sun.star.connection.NoConnectException "couldn't connect to pipe …"`:
unopkg arrenca un `soffice` bootstrap i no s'hi pot connectar pel named pipe.
**És cosmètic** → el paquet SÍ queda desplegat (surt a `unopkg list` com
`com.gnosi.cite`) i, gràcies a la *passive registration* del component
Python, s'activa sol quan LibreOffice **arrenca en mode GUI** (els
`Addons.xcu`/menús només es processen amb finestra, no en `--headless`).
Via robusta alternativa: **Eines > Gestor d'extensions > Afegeix** amb LO
ja obert (evita el pipe del tot).

⚠️ **"Cosmètic" NOMÉS val per a un `add` NOU. En una REINSTAL·LACIÓ,
`add --force` sobre la mateixa versió NO és cosmètic** (verificat 2026-07-21):
l'error del pipe avorta el reemplaçament i la caché es queda amb el **payload
VELL** — `unopkg list` mostra un tmp-dir amb mtime d'avui, però el
`gnosi_cite.py` de dins és el codi antic i creuries que has desplegat el nou.
Procediment fiable de reinstal·lació:
1. `unopkg remove com.gnosi.cite` (aquest sí que funciona sense pipe),
2. `unopkg add gnosi-cite.oxt` (add net; l'error de pipe torna a ser cosmètic),
3. **verifica BYTES, no el llistat**: `shasum` del
   `.../uno_packages/cache/uno_packages/*/gnosi-cite.oxt/gnosi_cite.py`
   desplegat vs el font — han de coincidir,
4. arrenca LO en GUI un cop (`open -g -j -a LibreOffice`) per la passive
   registration.

⚠️ **CORRECCIÓ (2026-07-21): `is registered` SÍ que canvia — és el senyal
diagnòstic bo, no soroll.** Aquesta directiva deia que el camp no canviava mai
i que calia ignorar-lo. Fals: després d'una instal·lació que funciona,
`unopkg list` mostra `is registered: yes` als quatre components (paquet,
`gnosi_cite.py`, `ProtocolHandler.xcu`, `Addons.xcu`). Fes-lo servir:

```bash
/Applications/LibreOffice.app/Contents/MacOS/unopkg list | grep -A6 -i gnosi
```

**El que NO és prova de res és que l'extensió surti a `unopkg list`.** Els
fitxers poden ser a la caché i sortir llistats amb el paquet mai registrat
a la UI — i llavors **no hi ha menú**, que és el símptoma que veu l'usuari.

### Símptoma: l'extensió hi és però NO surt el menú «Gnosi Cite»

Viscut i resolt el 2026-07-21. Comprovacions que van sortir TOTES bé i que
per tant **no** cal repetir: payload desplegat idèntic byte a byte al repo,
nom d'implementació de `ProtocolHandler.xcu` coincidint amb el que registra
`gnosi_cite.py`, URLs `gnosicite:` casant, `Context` = `TextDocument`
coincidint amb el document obert, i LibreOffice arrencat en GUI després del
desplegament. Res d'això era la causa.

La causa: el desplegament per línia d'ordres havia deixat els fitxers a la
caché sense completar el registre de la UI. Cura, verificada:

1. Tanca LibreOffice **del tot** (Cmd+Q) — sense això el `remove` topa amb
   el mateix pipe.
2. `unopkg remove com.gnosi.cite` → deixa la caché a zero fitxers `gnosi`.
   Això converteix la següent instal·lació en un **`add` NOU**, que és el cas
   segur (vegeu l'avís de la reinstal·lació més amunt).
3. Amb LO obert: **Eines → Gestor d'extensions → Afegeix** → el `.oxt`.
4. Reinicia LO. Verifica amb `is registered: yes` i amb un `tmp_` de caché
   **nou** (si el directori `lu…tmp_` és el mateix d'abans, el reemplaçament
   no s'ha fet).

Moralitat operativa: **per a l'usuari final, instal·la SEMPRE pel Gestor
d'extensions.** La via `unopkg add` és per a automatització i té prou
paranys (pipe, reinstal·lació silenciosa, registre incomplet) per no
recomanar-la a ningú.

- **Verificació E2E final** (usuari): obrir Writer → menú **Gnosi Cite** →
  provar les 4 comandes contra el backend real (`localhost:5002`).

## Config d'usuari

`~/.config/gnosi-cite/config.json` → `{backend_url, style, locale}`.
Default backend `http://localhost:5002`.

## Modes de fallada SILENCIOSOS del backend (2026-07-20)

Els tres endpoints responen 200 amb text plausible fins i tot quan el
resultat és incorrecte. **No n'hi ha prou de comprovar que responen**: cal
llegir el text formatat i comparar-lo amb l'APA esperat.

- **Estil CSL no resolt → pandoc aplica el SEU estil per defecte.**
  `_resolve_csl_path` només tenia candidats `/app/...` (imatge Docker). En mode
  NATIU cap existia, `--csl` no s'hi passava mai i totes les cites sortien
  `(Bauman 2007)` en comptes de l'APA `(Bauman, 2007)` — demanessis l'estil que
  demanessis. Símptoma: APA, MLA i Chicago donen tots el mateix. Ara hi ha un
  candidat relatiu al repo derivat de `__file__`. **Qualsevol ruta d'actiu del
  backend ha de resoldre en TOTS DOS modes** (cf. `environment_integrity.md`).
- **L'autoria estructurada s'ignorava.** `_recursos_metadata_to_csl` llegia només
  la cadena llegada `Authors`; els registres amb l'autor a `Autoría` es citaven
  pel títol (`(Zombie University 2018)`). El frontend (`cslEngine.js`) ja ho feia
  bé → **divergència frontend/backend**: la cita es veia correcta a Gnosi i
  sortia malament a Word. Regla: el backend és un MIRALL de `recursosPageToCsl`;
  si en toques un, toca l'altre (i el test `test_recursos_csl_mapping.py`).
- **`Citation Key` duplicada = registre invisible.** La clau és l'`id` del
  CSL-JSON: dos registres amb la mateixa clau fan que citeproc només en vegi un,
  i l'altre es cita silenciosament com el seu germà. Sense clau = incitable.
  Han de ser **úniques i no buides**, sempre. Eina idempotent:
  `pipeline/sandbox/recursos_citation_key_rebuild.py`.
- **Editar una `Citation Key` no propagava.** `_ensure_cite_key_index` es
  reconstrueix quan canvia el NOMBRE de pàgines, així que una edició in situ
  passava desapercebuda i Word seguia resolent la clau VELLA fins a reiniciar.
  El PATCH de pàgina ara invalida l'índex si la clau canvia.

⚠️ **MAI esborris `local_data/cache/vault_page_index_*.json` per refrescar.**
Força un rescan complet del vault OneDrive (~1600 fitxers) i l'app es queda
BUIDA uns quants minuts (`search-citations` torna `[]`). Per propagar canvis
massius, escriu via API (invalida sola) i espera el sync de fons
(`_VAULT_SYNC_COOLDOWN_SECONDS=600`).
