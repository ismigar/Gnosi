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

- **Verificació E2E final** (usuari): obrir Writer → menú **Gnosi Cite** →
  provar les 4 comandes contra el backend real (`localhost:5002`).

## Config d'usuari

`~/.config/gnosi-cite/config.json` → `{backend_url, style, locale}`.
Default backend `http://localhost:5002`.
