# Directiva: Extensió LibreOffice "Gnosi Cite"

**Objectiu**: gestor de cites estil Mendeley dins LibreOffice Writer, a
paritat amb el Word Add-in (`frontend/public/word-addin/`). Cerca, selecció
d'estil/idioma, inserció amb tracking, bibliografia i reformatació APA.

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
- **Pendent de l'usuari** (cal Mac amb LO instal·lat): `unopkg add`,
  obrir Writer, provar les 4 comandes contra el backend real. No es pot
  provar en aquesta màquina (sense LibreOffice ni bridge UNO).

## Config d'usuari

`~/.config/gnosi-cite/config.json` → `{backend_url, style, locale}`.
Default backend `http://localhost:5002`.
