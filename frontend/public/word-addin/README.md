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
cites del document juntes** en una sola crida. La inserció puntual
(quan cliques una entrada al picker) crida `format-citation` singular
per UX immediata, però sense context complet pot ser sub-òptima.

**Per garantir conformitat APA**:
1. Insereix totes les cites que vulguis del document amb el picker
2. Prem **"Actualitza bibliografia"** al peu de la sidebar — aquest botó
   fa una sola crida `format-citations` (plural) amb totes les cites
   detectades, en ordre, incloent duplicats. Pandoc-citeproc decideix
   les desambiguacions correctament i el add-in actualitza tots els
   Content Controls amb el text definitiu
3. Prem **"Insereix bibliografia"** per generar la llista final
4. Si canvies d'estil (APA → Chicago) o de locale, repeteix el pas 2

## Instal·lació en local (sideload)

Word 2016+ permet "sideload" d'un add-in per a dev/testing sense passar
per la Microsoft Store.

### Mac

```bash
mkdir -p ~/Library/Containers/com.microsoft.Word/Data/Documents/wef
cp manifest.xml ~/Library/Containers/com.microsoft.Word/Data/Documents/wef/
```

Després obre Word, ves a **Insereix > Els meus add-ins > Add-ins
desenvolupats** i hi hauria de sortir "Gnosi Cite".

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
