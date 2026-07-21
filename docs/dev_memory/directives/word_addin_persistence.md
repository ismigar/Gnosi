# Directiva: persistència del Word Add-in "Gnosi Cite"

**Problema**: a macOS, el botó **Cites Gnosi** desapareix del ribbon cada
vegada que es tanca el Word. Cal reobrir l'add-in des de *Complements de
desenvolupador* a cada sessió. A Windows no passa.

**Estat**: diagnosticat (2026-07-21). Cap acció de codi encara. Aquesta
directiva fixa la decisió abans de tocar res.

## Diagnòstic (verificat, no inferit)

Word manté dos búcquets de cau separats sota
`~/Library/Containers/com.microsoft.Word/Data/Library/Application Support/Microsoft/Office/16.0/Wef/`:

- El búcquet amb sufix `_ADAL` (autenticació de compte Microsoft) conté els
  add-ins que vénen d'un catàleg. El fitxer de control es diu, descodificat
  de base64, `EXCatalogMac_Word_ExEntitlementDetails`: *entitlements* de
  botiga lligats al compte.
- Un búcquet separat, sense `_ADAL`, conté els manifests carregats des de
  `~/Library/Containers/com.microsoft.Word/Data/Documents/wef/`.

Només els del primer búcquet s'escriuen a `Wef/AppCommands/17.0/`, que és el
registre que sobreviu a tancar el programa. A la màquina de referència aquell
directori contenia exclusivament entrades `EXCatalog` — Mendeley Cite
(`WA104382081`) i RefWorks (`WA200007520`) — i **cap** rastre de l'`<Id>` de
Gnosi Cite (`5e2c8b9a-1f2d-4b3c-9f8e-7d6c5b4a3e2f`).

**Conclusió**: no és un defecte del nostre manifest. El `VersionOverrides`
és correcte i el botó es registra bé dins la sessió; simplement el sideload
mai arriba al registre persistent. Problema conegut de plataforma:
OfficeDev/office-js#507. El Mendeley persisteix perquè està instal·lat des
de l'Office Store, no perquè el seu manifest sigui millor.

**No perdis temps** revisant el certificat TLS, el `SourceLocation`, el
LaunchAgent del frontend ni la versió del manifest: tot això es va descartar
amb mesures directes i cap n'és la causa.

## Opcions avaluades

### A. Plantilla `.dotm` a la carpeta Startup (mecanisme del Zotero)

Word carrega incondicionalment tot el que hi ha a
`~/Library/Group Containers/UBF8T346G9.Office/User Content.localized/Startup.localized/Word/`
a cada arrencada. És l'única via de persistència real que **no** depèn de
cap catàleg, compte de Microsoft ni allotjament públic. El Zotero ho fa
així i a la màquina de referència ja hi ha el seu `Zotero.dotm` funcionant.

Cost real, però: el Zotero no és només una plantilla. El VBA escriu ordres a
un fitxer-canonada (`.zoteroIntegrationPipe`) i és l'aplicació Zotero qui
respon governant el Word des de fora, amb una biblioteca Objective-C que fa
servir ScriptBridge/AppleScript. Replicar-ho a Gnosi vol dir: plantilla VBA
+ un helper natiu que condueixi el Word per AppleScript + una implementació
completament diferent per a Windows (COM). I es perd el Word per a la Web.

A favor: encaixa amb el local-first i ja tenim precedent d'helper natiu
(`host-open-helper`).

### B. Publicar a AppSource i allotjar el taskpane públicament

Era la hipòtesi inicial ("fer-ho públic"). **Descartada**: no només és cara
(revisió de Microsoft, compte de publicador, hostatge públic), sinó que va
en la direcció equivocada.

Els navegadors estan tancant precisament aquest patró. Chrome 142+ bloqueja
les peticions d'un origen HTTPS públic cap a `localhost` sense la
Permissions-Policy `local-network-access`, i Office incrusta els add-ins en
iframes que no la porten — sense prompt de permís possible
(OfficeDev/office-js#6281, #6174; oberts, a backlog, sense solució oficial).
Afecta específicament els add-ins "hosted on HTTPS domains (not development
servers)" que volen arribar a una aplicació local.

El muntatge actual (taskpane servit des de `https://localhost:5173` cridant
el backend a `localhost:5002`) és localhost→localhost i **no** queda afectat.
Publicar-lo ens mouria del cas sa al cas trencat: canviaríem una molèstia
només-Mac per un risc de ruptura a totes les plataformes.

### C. Desplegament de tenant (M365 Admin Center → Integrated Apps)

**Provada i descartada (2026-07-21).** Dóna persistència tipus `EXCatalog`
sense passar per AppSource, i com que cada client resoldria `localhost`
contra la seva pròpia màquina, en teoria evitaria el problema del punt B.

Però el prerequisit no es compleix i no es pot fer complir: Integrated Apps
només és accessible a un **administrador del tenant**. L'Office de la màquina
de referència està activat amb un compte d'estudiant de la UNED
(`…@alumno.uned.es`), és a dir dins un tenant institucional aliè. No hi ha
via d'administració, i no n'hi haurà.

Queda oberta, doncs, la pregunta tècnica de si Microsoft accepta un
`SourceLocation` a `localhost` en desplegament centralitzat: no s'ha pogut
comprovar perquè cal accés d'administrador a algun tenant.

I encara que es resolgués, **no generalitza**: obligaria cada usuari de
Gnosi a tenir un administrador de tenant disposat a desplegar-ho. Això no és
una via de distribució, és com a molt un apedaçament personal. Per tant C no
era mai una solució de producte — només valia la pena mirar-la perquè era
barata.

### D. Acceptar-ho i reduir la fricció

És l'estat actual. El cost per sessió és reobrir des de *Complements de
desenvolupador*. A Windows no hi ha problema.

### E. Autoopen (`Office.AutoShowTaskpaneWithDocument`) — via barata, a provar primer

Trobada després de decidir A, i **la canvia**. Office permet marcar un
document perquè Word hi reobri sol un panell designat. La clau és una
excepció que ens va de cara: Microsoft va retirar l'autoopen als add-ins de
la Marketplace el 2026-03-02 però **el va mantenir per als carregats per
sideload i els desplegats centralment**. Suportat a Office per a Mac 15.34+.

Muntatge (fet, versió 1.3.0.0): al manifest, el `TaskpaneId` de l'acció del
ribbon passa a ser `Office.AutoShowTaskpaneWithDocument`; a `taskpane.js`,
`Office.onReady` marca el document amb aquesta mateixa clau via
`document.settings` + `saveAsync`.

Límits, que són reals i s'han de dir clar:

- L'etiqueta viatja **dins del document**. Cal desar-lo perquè persisteixi.
- És **per document**, no global: un document nou encara demana una inserció
  manual. No recupera el botó del ribbon.
- Resol, això sí, el cas que fa mal de debò: el document en què estàs
  treballant setmanes seguides.

Si funciona, A deixa de ser urgent i passa a ser una millora opcional.

## Recomanació

Ordre: **provar E abans de construir res**. És un canvi de manifest més deu
línies de JS, ja desplegat, i si funciona cobreix el cas d'ús real.

Descartades B (direcció equivocada) i C (prerequisit inassolible), si E no
basta queda **A o D**.

Sobre A, cal dimensionar-la amb dades que es van confirmar el 2026-07-21 i
que la fan més cara del que semblava:

- **El taskpane actual no es pot reaprofitar.** `Application.TaskPanes` de
  VBA només governa panells natius del Word (`wdTaskPaneFormatting` i
  companyia); no hi ha API de VBA per obrir el panell d'un add-in web. Anar a
  A vol dir reescriure tota la UI de cerca i selecció d'estil en UserForms de
  VBA, i mantenir **dues implementacions** de la mateixa funció per sempre.
- **L'HTTP sí que és fàcil**, i més senzill que al Zotero: `MSXML2.XMLHTTP`
  no existeix al VBA de Mac, però `AppleScriptTask` crida un `.scpt` de
  `~/Library/Application Scripts/com.microsoft.Word/` que pot fer
  `do shell script "curl …"`. El Zotero necessita la capa Objective-C
  només perquè la seva lògica viu fora del Word; nosaltres tindríem el
  model d'objectes del document directament des del VBA.
- Segueix implicant implementació separada per a Windows i renunciar al Word
  per a la Web.

Si aquest cost no es vol assumir, **D** és una posició honesta sempre que la
documentació ho digui clar, que ja ho fa.

### E.1 — resultat: `visibility="0"` no serveix (2026-07-21)

Provat i **fallat**, però el diagnòstic és net i deixa una segona palanca.

El marcatge s'escriu perfectament. El document generat porta
`word/webextensions/webextension1.xml` amb
`store="developer" storeType="Registry"` — el cas sideload documentat — i
`Office.AutoShowTaskpaneWithDocument` a `true`. Word també havia rellegit el
manifest (tenia `5e2c8b9a-…_1.3.0.0` a la cau). Res d'això és el problema.

El problema és que `Office.context.document.settings` sempre escriu
`visibility="0"` a `taskpanes.xml`, i amb `0` la funció està condicionada
que l'add-in ja estigui *instal·lat* al dispositiu ("will only open if the
add-in is already installed"). A macOS un add-in per sideload precisament no
ho està de forma persistent — és el problema original. Circular: l'autoopen
depèn de la mateixa persistència que volem obtenir.

**Palanca restant**: `visibility="1"`. La documentació diu que és el que cal
"if you also require the add-in to be distributed with the document", i que
**només es pot posar per Open XML** — no des d'Office.js. Amb `1`, Word
distribueix l'add-in amb el document i demana confiança un cop.

### E.2 — `visibility="1"` FUNCIONA per document (verificat 2026-07-21)

Confirmat per l'usuari amb un `.docx` reescrit per Open XML: el panell
s'obre sol en obrir el document, també després de Cmd+Q. Verificat en els
dos camins: document que ja havia tingut el add-in (actualitzar parts) i
document verge (injectar les cinc peces).

Eina de producte: `integrations/word-cite-pin/pin_taskpane.py` (stdlib
Python, idempotent, `--undo`, `--dry-run`, `.bak` per defecte; llegeix
`<Id>`/`<Version>` del manifest). El paquet que genera és canònicament
idèntic al que escriu Word, tret de l'`id` de `<we:webextension>`, derivat
del GUID de l'add-in per garantir idempotència (res més el referencia).

**Cua**: la `<Version>` del manifest viatja dins la referència del document.
En pujar la versió del manifest, repassar els documents fixats amb el script.

### E.3 — documents nous: experiment `Normal.dotm` (pendent de verificar)

Un document nou no porta les parts (neixen amb el fitxer), així que E.2 no
el cobreix. Hipòtesi: si `Normal.dotm` — la plantilla global de la qual Word
clona cada document nou en blanc — porta les parts amb `visibility="1"`,
cada document nou neix marcat. Cap documentació ho garanteix; és empíric.

Fet (2026-07-21): `Normal.dotm` fixat amb el mateix script (còpia pristina
guardada com a `~/Desktop/Normal.dotm.original-20260721`). El classificador
de permisos va bloquejar, correctament, escriure dins Group Containers des
de l'agent: l'usuari instal·la la còpia fixada a mà.

**CONFIRMAT (2026-07-21, mateix dia): Word hereta les parts.** Un document
nou en blanc obre el panell sol. El cas "document nou" queda resolt
globalment i el pla B (`Gnosi.dotx` a la galeria) no cal.

Risc residual conegut: si Word reescriu `Normal.dotm` (en desar estils o
autotext) i en poda les parts, es repassa amb el script. A la màquina de
referència `Normal.dotm` portava intacte des de l'abril de 2024, així que
és improbable que passi sovint. `install.sh --status` ho detecta.

### Empaquetat: `install.sh` (2026-07-21)

`integrations/word-cite-pin/install.sh` deixa la instal·lació en una ordre:
manifest → `wef/` + fixar `Normal.dotm` (còpia pre-Gnosi
`Normal.dotm.pre-gnosi`, restaurada byte a byte per `--undo`; `--status`
per diagnòstic). Verificat amb cicle complet contra un `$HOME` fals:
instal·lar, reexecutar (idempotent), status, undo amb restauració
byte-idèntica, flag desconegut → exit 2.

Gotcha de shell que va caçar el test: amb `set -o pipefail`,
`unzip -l | grep -q` pot informar fallada havent-hi coincidència (grep surt
al primer match i unzip mor per SIGPIPE amb 141). La detecció es fa sense
canonada (case sobre la sortida capturada).

### LibreOffice (2026-07-21, verificat)

Dues respostes separades:

- **El problema de sessions NO existeix al LibreOffice.** L'extensió `.oxt`
  (`integrations/libreoffice-cite/`) s'instal·la per Eines → Extensions i
  persisteix per disseny (la UI la registra `Addons.xcu`). Tota la
  maquinària autoopen/`webextensions` és una extensió de Microsoft a
  l'OOXML; al Writer no li cal ni la llegeix.
- **Però el Writer ESBORRA el fixat en desar**: una ida i volta
  `soffice --headless --convert-to docx` sobre un document fixat elimina
  les tres parts `word/webextensions/` i la relació. Un `.docx` fixat que
  s'editi i es desi amb el Writer perd l'autoopen a Word: repassar-lo amb
  `pin_taskpane.py`. Documentat als dos README.

## Prova pendent de E

1. Tanca el Word del tot (Cmd+Q).
2. Obre'l i obre un document **desat** (no un de nou sense desar).
3. Insereix el add-in un cop des de *Complements → Complements de
   desenvolupador → Gnosi Cite*. Desa el document.
4. Cmd+Q i torna a obrir aquell mateix document.

Si el panell surt sol, E funciona. Si no, la traça útil és mirar si el
document conté la part `webextension` amb
`Office.AutoShowTaskpaneWithDocument`: desa'l com a `.docx`, descomprimeix-lo
i mira `word/webextensions/`.

Mentrestant, D amb documentació honesta: el web i el README ja diuen
explícitament que a macOS cal reobrir-lo cada sessió i que és una limitació
del Word (corregit el 2026-07-21; abans afirmaven, falsament, "un cop").

## Restriccions i casos límit apresos

- **No canviïs `<Version>` esperant que Word rellegeixi el manifest sol**:
  Word indexa la cau per `<Id>_<Version>`. Deixar caure un manifest editat
  amb la mateixa versió és una operació nul·la i el botó no apareix mai.
  Cal pujar la versió a cada canvi publicat.
- **No deixis divergir el manifest de `wef/` del que hi ha al repo.** Va
  passar: el desplegat anava per 1.2.0.0 amb `?v=3` a les icones mentre el
  repo es va quedar a 1.1.0.0, i qui instal·lés des de la release s'enduia
  la versió sense les correccions. Edita sempre
  `frontend/public/word-addin/manifest.xml` i copia'l cap a `wef/`, mai al
  revés.
- **El botó viu a `TabReferences`, no a `TabHome`.** Es va moure i el README
  va quedar desactualitzat mesos.
- L'absència de l'`<Id>` a `Wef/AppCommands/17.0/` és el senyal diagnòstic
  ràpid: si no hi és, el botó no persistirà, i cap canvi al manifest ho
  arreglarà.
