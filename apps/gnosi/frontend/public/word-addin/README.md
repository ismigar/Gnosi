# Gnosi Cite — Office Add-in per Word

Sidebar tipus Mendeley Cite per inserir referències del Vault de Gnosi
(taula Recursos) al document de Word com a cites formatades + bibliografia
autogenerada.

## Què fa

- **Cerca dinàmica**: filtra Recursos per `Citation Key`, `Títol` o `Autor`
- **Inserció amb tracking**: cada cita s'insereix com un Content Control de
  Word amb tag `gnosi-cite:<key>`. Això permet refrescar-les si es canvia
  d'estil
- **Bibliografia automàtica**: el botó "Insereix bibliografia" recopila
  totes les cites del document i les renderitza al final via pandoc-citeproc
- **Estils CSL**: APA 7, Chicago author-date, MLA, IEEE
- **Idiomes**: ca-AD, es-ES, en-US, en-GB

## Arquitectura

```
[Word host]
   └── Taskpane (sidebar)
        ├── HTML/CSS/JS estàtic servit per Gnosi (públic)
        └── Office.js (CDN oficial Microsoft)
              ↓ fetch
[Gnosi backend]
   ├── GET  /api/vault/search-citations?q=…
   ├── GET  /api/vault/format-citation?key=…&style=apa&locale=ca-AD
   ├── POST /api/vault/format-citations   { keys[], style, locale }  ← APA batch
   └── POST /api/vault/format-bibliography { keys[], style, locale }
              ↓ subprocess
[pandoc + citeproc + CSL styles + locales]
```

El backend reutilitza el mateix pipeline pandoc que `/export/{page_id}`
(mateixos estils, mateix locale handling).

## Conformitat APA (important)

L'estil APA (i altres autor-data) té regles **sensibles a context**:

- Mateix autor + mateix any en diferents fonts → sufixos `2020a`, `2020b`
- Diferents autors amb mateix cognom → afegir inicials per desambiguar
  (`Smith, J. (2020)` vs `Smith, A. (2020)`)
- Primera aparició d'un grup amb molts autors → noms complets; següents
  → `Smith et al.`

Aquestes decisions requereixen que pandoc-citeproc rebi **totes les
cites del document juntes** en una sola crida. Per això l'add-in ho fa
**automàticament** (com Mendeley/Zotero), sense cap botó:

- **En inserir una cita**, reformata totes les cites del document amb
  context complet — una crida `format-citations` (plural) amb totes les
  claus en ordre, incloent duplicats, i actualitza tots els Content
  Controls amb el text definitiu (`2020a`/`2020b`, inicials, `et al.`).
- **En canviar l'estil** (APA → Chicago) al selector, les cites ja
  inserides es reformaten soles també.

La **bibliografia** es genera amb el botó **«Insereix bibliografia»**;
refés-la si has canviat d'estil després d'inserir-la.

## Requisit previ: HTTPS local (mkcert)

⚠ **Word exigeix que el taskpane es carregui per HTTPS.** El `manifest.xml`
apunta a `https://localhost:5173`, però el dev server (Vite) serveix per
HTTP per defecte. Sense HTTPS, el panell es carrega en blanc.

A més, ha de ser un certificat **de confiança**: el WebView de Word rebutja
un autofirmat normal sense opció d'acceptar-lo. Solució: [mkcert](https://github.com/FiloSottile/mkcert),
que instal·la una CA al clauer del sistema.

```bash
brew install mkcert nss   # un cop
sh/setup-https-dev.sh     # CA + cert a frontend/certs/ (gitignorats)

# reinicia Vite perquè rellegeixi la config i passi a HTTPS:
launchctl kickstart -k gui/$UID/com.gnosi.frontend-native   # natiu (per defecte)
docker compose restart frontend                             # si el desplegues amb Docker
```

`vite.config.js` detecta `frontend/certs/localhost.pem` i activa HTTPS sol.
Comprova-ho: `curl -sI https://localhost:5173/word-addin/index.html` → `200`.
(Si no hi ha certs, Vite segueix en HTTP i no es trenca res.)

## Instal·lació en local (sideload)

Word 2016+ permet "sideload" d'un add-in per a dev/testing sense passar
per la Microsoft Store.

### Mac — via recomanada: l'instal·lador

Amb el Word tancat (Cmd+Q):

```bash
cd ../../../integrations/word-cite-pin && ./install.sh
```

Fa les dues coses que calen: copia el manifest a `wef/` i fixa
`Normal.dotm` perquè **els documents nous obrin el panell sols** — vegeu
[Persistència del panell a macOS](#persistència-del-panell-a-macos).
`./install.sh --status` per comprovar-ho, `./install.sh --undo` per
desfer-ho tot.

### Mac — a mà

La carpeta de sideload és `~/Library/Containers/com.microsoft.Word/Data/Documents/wef/`.
Hi va **un sol fitxer** de manifest (el nom del fitxer és indiferent):

```bash
WEF=~/Library/Containers/com.microsoft.Word/Data/Documents/wef
mkdir -p "$WEF"
rm -f "$WEF"/*.xml          # ⚠ mai dues còpies del mateix add-in: vegeu més avall
cp manifest.xml "$WEF"/
```

⚠ **Dues còpies del mateix manifest = add-in invisible.** Word indexa els
manifests per `<Id>` i, si en troba dos amb el mateix `<Id>`, no en registra
cap al ribbon (`office-addin-dev-settings registered` sí que els llista tots
dos — no serveix per detectar-ho). Si baixes el manifest d'una release i ja
en tenies un de copiat a mà, **esborra l'antic**.

⚠ **En reinstal·lar, puja `<Version>`.** Word memoritza el manifest com a
`<Id>_<Version>`; si la versió no canvia no el torna a llegir, i et quedes
amb el payload antic encara que el fitxer del disc sigui nou.

Després **tanca Word del tot (Cmd+Q)** i torna'l a obrir amb un document.

#### Com obrir-lo a mà (sense l'instal·lador: cada sessió de Word)

1. **Inici > Complements** (botó de la cinta) → secció **«Complements de
   desenvolupador»** → **Gnosi Cite**. S'obre el panell lateral.
2. A partir d'aquest moment, i **només durant aquesta sessió de Word**, surt
   també el botó **Cites Gnosi** (grup **Gnosi**) a la pestanya
   **Referències** (*Referencias* / *References*), al costat de Mendeley Cite.

⚠ **A Mac el botó de la cinta NO sobreviu a un reinici de Word.** Verificat a
Word 16.110.3 (2026-07-21): Word només escriu la caché persistent del ribbon
(`…/Office/16.0/Wef/AppCommands/`) per a add-ins vinguts d'un **catàleg**
(AppSource o desplegament centralitzat — hi apareixen com a `EXCatalog`, com
Mendeley Cite o RefWorks). Un add-in *sideloaded* des de `wef/` es llegeix i
es cacheja el manifest, però el seu `VersionOverrides` només s'aplica a la
sessió en curs. Pujar `<Version>` **ja no ho arregla** (sí que ho feia en
builds anteriors). Per al **botó** permanent cal publicar a un catàleg
([Producció](#producció)) — però per al **panell** no cal: que la barra
torni sola es resol en local amb l'*autoopen*. Vegeu la secció següent.

Si no surt ni tan sols a «Complements de desenvolupador», vegeu
«El botó no surt al ribbon» a [Troubleshooting](#el-botó-no-surt-al-ribbon).

### Persistència del panell a macOS

Office té una funció (*autoopen*) que reobre sol un panell designat quan
s'obre un document marcat. Microsoft la va retirar per als add-ins de la
Marketplace (2026-03-02) però la manté per als **sideloaded**, que és el
nostre cas. El parany: el marcatge que escriu Office.js
(`visibility="0"`) només actua si l'add-in està *instal·lat* — circular a
Mac, on el sideload no s'instal·la mai de forma persistent. El que funciona
és `visibility="1"`, que **només es pot posar per Open XML**, i és el que
fan les eines de
[`integrations/word-cite-pin/`](../../../integrations/word-cite-pin/):

- **`install.sh`** fixa `Normal.dotm` (la plantilla de la qual Word clona
  cada document nou en blanc): **tot document nou obre el panell sol**
  (herència verificada a Word per a Mac, 2026-07-21). Guarda la còpia
  pre-Gnosi i `--undo` la restaura byte a byte.
- **`pin_taskpane.py DOC.docx`** fixa documents **existents** un a un
  (idempotent, `--dry-run`, `--undo`, `.bak` per defecte). Alternativa
  manual: obrir-hi l'add-in un cop i desar el document.
- El primer cop, Word demana **confiança** per al complement: accepta-la.

Límits coneguts:

- La `<Version>` del manifest viatja dins la referència fixada al document:
  si puges la versió del manifest, repassa els documents amb el script.
- **LibreOffice Writer esborra el fixat en desar** un `.docx` (descarta les
  parts `word/webextensions/`; verificat amb una ida i volta
  `soffice --convert-to docx`). Torna a passar-hi el script. Al LibreOffice
  mateix no li cal res d'això: la seva extensió `.oxt`
  ([`integrations/libreoffice-cite/`](../../../integrations/libreoffice-cite/))
  persisteix sola per disseny — el problema de sessions és exclusiu del
  Word a macOS.

### Windows

1. Crea una carpeta compartida (ex.: `\\localhost\addins`)
2. Copia `manifest.xml` allà
3. A Word: **Fitxer > Opcions > Centre de confiança > Catàlegs de
   confiança** > afegeix `\\localhost\addins` > marca "Mostra al menú"
4. Reinicia Word i ves a **Insereix > Els meus add-ins > COMPARTIT** >
   Gnosi Cite

(A Windows no cal l'instal·lador: el catàleg de confiança compta com a
catàleg de debò i el botó del ribbon hi persisteix sol.)

### Word per a la Web

1. Obre un document a https://word.office.com
2. **Insereix > Add-ins > Carrega el meu add-in > Selecciona fitxer >** `manifest.xml`

## Requeriments del backend Gnosi

- Endpoint `/api/health` accessible
- Endpoints `/api/vault/search-citations`, `/api/vault/format-citation`,
  `/api/vault/format-bibliography` funcionant
- Pandoc instal·lat i al `PATH` del backend (natiu: `brew install pandoc`;
  Docker: ja inclòs a `Dockerfile.backend` des de la Fase 5). Sense pandoc
  els endpoints tornen `{"detail":"pandoc not available"}` i l'add-in
  insereix la clau crua `(ardite2025)` en comptes de `(Ardite, 2025)`
- CSL styles disponibles a `frontend/public/csl/styles/` (refrescats
  setmanalment per `refresh-vendor-files.yml`)

## Producció

Publicar per un **catàleg** és, a més, l'única manera de tenir el botó
**Cites Gnosi** fix a la cinta (els add-ins de catàleg sí que entren a la
caché persistent `AppCommands`; els sideloaded, no). El **panell**, en
canvi, ja persisteix en local amb l'instal·lador — vegeu
[Persistència del panell a macOS](#persistència-del-panell-a-macos).

1. Generar nou GUID per a `<Id>` del manifest amb `uuidgen`
2. Substituir totes les ocurrències de `https://localhost:5173` per la
   URL definitiva (ex.: `https://gnosi.exemple.com`)
3. Publicar al **Microsoft 365 Admin Center > Integrated Apps > Upload
   custom apps** (cal tenant de M365), o a **AppSource** per a distribució
   pública
4. Distribuir per usuari/grup segons necessitat

A Windows, el **catàleg de carpeta compartida** (Centre de confiança >
Catàlegs de confiança) també compta com a catàleg, per això allà el botó
és més estable que amb el sideload de Mac.

Nota (verificat 2026-07-21): abans d'allotjar el taskpane en un host
públic, tingueu present que Chrome 142+ bloqueja les peticions d'un origen
HTTPS públic cap a `localhost` sense la Permissions-Policy
`local-network-access`, que els iframes d'Office no posen
(OfficeDev/office-js#6281). El muntatge actual localhost→localhost no està
afectat; un taskpane públic contra un backend local sí que ho estaria.

## Compatibilitat coneguda

- ✅ Word 2019+ Windows
- ✅ Word 2019+ Mac
- ✅ Word per a la Web (https://word.office.com)
- ⚠ Word 2016: les Content Controls poden fallar; cau al fallback de
  text plain (sense tracking per refresh)
- ❌ Word per a Android: Office Add-ins amb taskpane no estan suportats

## Autenticació (token)

Amb `GNOSI_REQUIRE_AUTH` engegat, el backend rebutja qualsevol petició sense
credencial. L'add-in corre en un webview d'Office amb origen propi, així que
una cookie de sessió no hi arriba: la credencial ha de ser un Personal Access
Token.

1. A Gnosi: Configuració → Tokens d'API → crea'n un (només es mostra un cop).
2. Al panell de l'add-in: «Configuració del token» → enganxa'l → Desa.

Es desa al `localStorage` del webview (clau `gnosi.wordAddin.apiToken`), només
en aquell dispositiu, i el panell no el torna a mostrar mai sencer.

## Troubleshooting

### El botó no surt al ribbon

El botó viu a **Referències > Gnosi > Cites Gnosi**, no a *Inici*. A Mac,
amb sideload, **només hi és si ja has obert l'add-in un cop en aquesta
sessió** (Inici > Complements > Complements de desenvolupador > Gnosi Cite):
vegeu [Com obrir-lo a mà](#com-obrir-lo-a-mà-sense-linstal·lador-cada-sessió-de-word).
Si després d'això segueix sense sortir, comprova-ho en aquest ordre:

```bash
WEF=~/Library/Containers/com.microsoft.Word/Data/Documents/wef
ls "$WEF"                                                    # 1) ha d'haver-hi UN sol .xml
npx office-addin-dev-settings registered                     # 2) ha de sortir UNA línia
npx office-addin-manifest validate "$WEF"/*.xml              # 3) → "The manifest is valid"
curl -sI https://localhost:5173/word-addin/index.html         # 4) → 200 (HTTPS, no HTTP)
```

Si hi ha més d'un manifest amb el mateix `<Id>`, o si Word ja tenia
cachejada aquesta mateixa `<Version>`, no el rellegeix. Reparació
determinista:

```bash
WEF=~/Library/Containers/com.microsoft.Word/Data/Documents/wef
rm -f "$WEF"/*.xml
# puja <Version> al manifest (p. ex. 1.3.0.0 → 1.4.0.0) i copia'l
cp manifest.xml "$WEF"/
```

…i tanca Word **del tot** (Cmd+Q) abans de tornar-lo a obrir. Per confirmar
si Word l'ha processat, el manifest cachejat apareix a
`~/Library/Containers/com.microsoft.Word/Data/Library/Application Support/Microsoft/Office/16.0/Wef/…/Manifests/`
amb el nom `<Id>_<Version>` i la mida del fitxer nou. Que hi sigui vol dir
que el manifest és correcte: si tot i així no hi ha botó permanent, és la
limitació de sideload descrita més amunt, no un error teu.

Buidar les caches de WebKit/Wef a mà **no** cal i no ho arregla.

### El panell no s'obre sol en un document nou

L'herència ve de `Normal.dotm`: comprova `./install.sh --status` (ha de dir
«fixat»). Si Word ha reescrit `Normal.dotm` (pot passar en desar-hi estils
o autotext), torna a executar `./install.sh`. En un document **existent**,
el fixat és per document: `pin_taskpane.py DOC.docx`. I si el document ha
passat pel LibreOffice Writer, el fixat s'ha perdut en desar: torna a
passar-hi el script.

### La icona del ribbon és l'antiga

Word cacheja les icones per URL i no les torna a baixar encara que canviïn
al disc. Les URLs d'icona porten un cache-bust (`icon-32.png?v=3`): si
canvies les icones, puja el sufix (`?v=4`) juntament amb el bump de
`<Version>`.

### "Cal un token" / "Token no vàlid"

La capçalera del panell distingeix els dos casos: no n'hi ha cap desat, o el
que hi ha el rebutja el backend (revocat, o d'una altra instal·lació). En tots
dos casos s'obre sol l'apartat de configuració. Un token vàlid comença per
`gnosi_pat_`.

### "Sense connexió amb Gnosi"

L'add-in fa fetch contra `window.location.origin` (la mateixa URL d'on
es serveix la sidebar). Verifica:
- Gnosi backend respon a `/api/health`
- L'add-in es serveix per `https://` (Word no admet `http://` en hosts
  no localhost)
- El manifest té el domini correcte a `<AppDomains>`

### "Word.run failed"

Pot indicar que el Word host no suporta Content Controls (Web parcial,
Word 2016). El fallback `setSelectedDataAsync` haurà inserit la cita
com a text pla (sense tracking de refresh).
