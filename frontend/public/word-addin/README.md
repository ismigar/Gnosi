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
brew install mkcert nss          # un cop
sh/setup-https-dev.sh            # CA + cert a frontend/certs/ (gitignorats)
docker compose restart frontend  # perquè Vite rellegeixi la config i passi a HTTPS
```

`vite.config.js` detecta `frontend/certs/localhost.pem` i activa HTTPS sol.
Comprova-ho: `curl -sI https://localhost:5173/word-addin/index.html` → `200`.
(Si no hi ha certs, Vite segueix en HTTP i no es trenca res.)

## Instal·lació en local (sideload)

Word 2016+ permet "sideload" d'un add-in per a dev/testing sense passar
per la Microsoft Store.

### Mac

```bash
mkdir -p ~/Library/Containers/com.microsoft.Word/Data/Documents/wef
cp manifest.xml ~/Library/Containers/com.microsoft.Word/Data/Documents/wef/
```

Després **tanca Word del tot (Cmd+Q)** i torna'l a obrir amb un document.
On apareix:

- **Al ribbon** (via principal): aquest add-in registra un botó propi via
  `VersionOverrides`. Mira a la pestanya **Inici** un grup **Gnosi** amb el
  botó **Cites Gnosi**. Clica'l → s'obre el panell lateral.
- **Alternativa**: **Insereix > Complements > pestanya «Els meus complements»
  > secció «Complements de desenvolupador» > Gnosi Cite**.

Si no surt cap de les dues coses, el manifest no s'ha carregat: revisa que el
fitxer sigui a `…/Documents/wef/` i que has reiniciat Word del tot.

### Windows

1. Crea una carpeta compartida (ex.: `\\localhost\addins`)
2. Copia `manifest.xml` allà
3. A Word: **Fitxer > Opcions > Centre de confiança > Catàlegs de
   confiança** > afegeix `\\localhost\addins` > marca "Mostra al menú"
4. Reinicia Word i ves a **Insereix > Els meus add-ins > COMPARTIT** >
   Gnosi Cite

### Word per a la Web

1. Obre un document a https://word.office.com
2. **Insereix > Add-ins > Carrega el meu add-in > Selecciona fitxer >** `manifest.xml`

## Requeriments del backend Gnosi

- Endpoint `/api/health` accessible
- Endpoints `/api/vault/search-citations`, `/api/vault/format-citation`,
  `/api/vault/format-bibliography` funcionant
- Pandoc instal·lat al contenidor (`apt-get install pandoc`, ja inclòs
  a `Dockerfile.backend` des de la Fase 5)
- CSL styles disponibles a `frontend/public/csl/styles/` (refrescats
  setmanalment per `refresh-vendor-files.yml`)

## Producció

Per a publicar a l'organització (no només local):

1. Generar nou GUID per a `<Id>` del manifest amb `uuidgen`
2. Substituir totes les ocurrències de `https://localhost:5173` per la
   URL definitiva (ex.: `https://gnosi.exemple.com`)
3. Publicar al **Microsoft 365 Admin Center > Integrated Apps > Upload
   custom apps**
4. Distribuir per usuari/grup segons necessitat

## Compatibilitat coneguda

- ✅ Word 2019+ Windows
- ✅ Word 2019+ Mac
- ✅ Word per a la Web (https://word.office.com)
- ⚠ Word 2016: les Content Controls poden fallar; cau al fallback de
  text plain (sense tracking per refresh)
- ❌ Word per a Android: Office Add-ins amb taskpane no estan suportats

## Troubleshooting

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
